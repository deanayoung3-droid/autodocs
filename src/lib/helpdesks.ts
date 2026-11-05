import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import sanitizeHtml from "sanitize-html";
import { all } from "./db";
import { emailAddress, newPartOfEmail } from "./inbox";
import { getIntegration, getSecrets, removeIntegration, saveIntegration } from "./integrations";
import { enqueue } from "./jobs";
import { ingestConversation, transcriptFromMessages } from "./support";

// Helpdesk connections ("Support tooling"): every 15 minutes the team's helpdesk
// is read for conversations resolved since the last read, and each one goes to the Support
// Endpoint's review, which finds doc gaps and drafts the fixes. A helpdesk is an adapter: the
// fields someone pastes (an API key, a subdomain), a check that they work, and a reader.

export const HELPDESK_IDS = [
  "fernand",
  "intercom",
  "helpscout",
  "slack-support",
  "hubspot",
  "pylon",
  "plain",
  "zendesk",
  "missive",
  "crisp",
  "discord",
  "gmail",
  "bolddesk",
] as const;
export type HelpdeskId = (typeof HELPDESK_IDS)[number];

export type HelpdeskField = { name: string; label: string; secret?: boolean; placeholder?: string; hint?: string; options?: { value: string; label: string }[] };

type Creds = Record<string, string>;
type Message = { from: "customer" | "support"; text: string };
type Resolved = { id: string; subject: string; customer: string; resolvedAt: Date; url?: string; messages: Message[] };

type Helpdesk = {
  name: string;
  /** What the helpdesk calls them, and what "resolved" is there: "closed conversations". */
  items: string;
  fields: HelpdeskField[];
  /** Setup steps; [text](url) becomes a link. */
  steps: string[];
  /** Tidies pasted values, e.g. "acme.zendesk.com" → "acme". Throws HelpdeskError when one can't work. */
  clean?: (c: Creds) => Creds;
  check: (c: Creds) => Promise<{ account: string; extra?: Creds }>;
  read: (c: Creds, since: Date) => Promise<Resolved[]>;
};

/** A failure worth showing as is: wrong credentials, a missing permission, a rate limit. */
export class HelpdeskError extends Error {}

const SYNC_EVERY_MS = 15 * 60_000;
const FIRST_LOOKBACK_DAYS = 7;
const MAX_PER_SYNC = 100;
// Each read starts a little before the last one began, so nothing resolved mid-read is missed.
// Conversations read twice are only reviewed again if they changed.
const OVERLAP_MS = 5 * 60_000;

/* Plumbing */

/** The helpdesk's API address. HELPDESK_API_URL points every helpdesk at a stand-in, for testing. */
function api(id: HelpdeskId, real: string): string {
  const test = process.env.HELPDESK_API_URL?.replace(/\/$/, "");
  return test ? `${test}/${id}` : real;
}

async function request<T>(name: string, url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new HelpdeskError(`Couldn't reach ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status === 401 || res.status === 403) throw new HelpdeskError(`${name} didn't accept the credentials (${res.status}). Check them and save again.`);
  if (res.status === 429) throw new HelpdeskError(`${name} is limiting how fast it can be read. The next sync picks up where this one stopped.`);
  if (!res.ok) throw new HelpdeskError(`${name} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

function htmlText(html: string): string {
  const spaced = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n");
  return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const firstLine = (s: string) => s.split("\n").find((l) => l.trim())?.trim().slice(0, 90) ?? "";
const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const isoSeconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
const byTime = <T extends { at: number }>(list: T[]) => [...list].sort((a, b) => a.at - b.at);

/* The helpdesks */

type IntercomAuthor = { type?: string; name?: string | null; email?: string | null };
type IntercomConversation = {
  id: string;
  title?: string | null;
  updated_at: number;
  statistics?: { last_close_at?: number | null } | null;
  source?: { subject?: string; body?: string; author?: IntercomAuthor };
  conversation_parts?: { conversation_parts?: { part_type: string; body?: string | null; author?: IntercomAuthor }[] };
};

const intercomBase = (c: Creds) =>
  api("intercom", c.region === "eu" ? "https://api.eu.intercom.io" : c.region === "au" ? "https://api.au.intercom.io" : "https://api.intercom.io");
const intercomHeaders = (c: Creds) => ({ Authorization: `Bearer ${c.token}`, Accept: "application/json", "Content-Type": "application/json", "Intercom-Version": "2.11" });

type ZendeskTicket = { id: number; subject: string; requester_id: number; updated_at: string };
type ZendeskUser = { id: number; email?: string; name?: string; role?: string };

const zendeskBase = (c: Creds) => api("zendesk", `https://${c.subdomain}.zendesk.com`);
const zendeskAuth = (c: Creds) => ({ Authorization: basic(`${c.email}/token`, c.token), Accept: "application/json" });

async function helpScoutToken(c: Creds): Promise<string> {
  const r = await request<{ access_token: string }>("Help Scout", `${api("helpscout", "https://api.helpscout.net")}/v2/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: c.appId, client_secret: c.appSecret }),
  });
  return r.access_token;
}

type HelpScoutConversation = {
  id: number;
  subject?: string;
  closedAt?: string | null;
  userUpdatedAt?: string;
  primaryCustomer?: { email?: string; first?: string; last?: string };
  _embedded?: { threads?: { type: string; body?: string; createdAt: string; createdBy?: { type?: string } }[] };
};

const slackBase = () => api("slack-support", "https://slack.com/api");
async function slack<T>(c: Creds, method: string, params: Record<string, string>): Promise<T> {
  const r = await request<T & { ok: boolean; error?: string }>("Slack", `${slackBase()}/${method}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${c.token}` },
  });
  if (!r.ok) {
    if (r.error === "invalid_auth" || r.error === "not_authed") throw new HelpdeskError("Slack didn't accept the token. Use the Bot User OAuth Token (xoxb-…).");
    if (r.error === "channel_not_found" || r.error === "not_in_channel") throw new HelpdeskError("The app can't see that channel. Invite it to the channel, then save again.");
    if (r.error === "missing_scope") throw new HelpdeskError("The Slack app is missing a scope. Add channels:history and channels:read, reinstall it, and save again.");
    throw new HelpdeskError(`Slack: ${r.error ?? "unknown error"}`);
  }
  return r;
}
type SlackMessage = { ts: string; user?: string; bot_id?: string; text?: string; reply_count?: number; latest_reply?: string; reactions?: { name: string }[] };
const DONE_REACTIONS = new Set(["white_check_mark", "heavy_check_mark", "ballot_box_with_check", "done"]);

const hubspotBase = () => api("hubspot", "https://api.hubapi.com");
type HubSpotMessage = {
  type: string;
  text?: string;
  richText?: string;
  subject?: string;
  direction?: string;
  createdAt: string;
  senders?: { name?: string; deliveryIdentifier?: { value?: string } }[];
};

const pylonBase = (c: Creds) => api("pylon", c.region === "eu" ? "https://api.eu.usepylon.com" : "https://api.usepylon.com");
type PylonIssue = { id: string; title?: string; state: string; link?: string; requester?: { email?: string } | null; updated_at?: string; resolution_time?: string | null };

async function plainQuery<T>(c: Creds, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await request<{ data?: T; errors?: { message: string }[] }>("Plain", `${api("plain", "https://core-api.uk.plain.com")}/graphql/v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (r.errors?.length) throw new HelpdeskError(`Plain: ${r.errors[0].message}`);
  return r.data as T;
}
type PlainPage<N> = { edges: { node: N }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

const missiveBase = () => `${api("missive", "https://public.missiveapp.com")}/v1`;
const missiveHeaders = (c: Creds) => ({ Authorization: `Bearer ${c.token}` });

const crispBase = () => `${api("crisp", "https://api.crisp.chat")}/v1`;
const crispHeaders = (c: Creds) => ({ Authorization: basic(c.identifier, c.key), "X-Crisp-Tier": "plugin" });

const discordBase = () => api("discord", "https://discord.com/api/v10");
type DiscordMessage = { author: { id: string; username: string; global_name?: string | null; bot?: boolean }; content: string; timestamp: string };

const fernandBase = () => api("fernand", "https://api.getfernand.com");

const boldDeskBase = (c: Creds) => `${api("bolddesk", `https://${c.domain}`)}/api/v1`;
type BoldDeskList = { result?: Record<string, unknown>[]; data?: Record<string, unknown>[] };
const field = (o: Record<string, unknown>, ...keys: string[]) => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== "");

const HELPDESKS: Record<HelpdeskId, Helpdesk> = {
  fernand: {
    name: "Fernand",
    items: "closed conversations",
    fields: [{ name: "token", label: "API key", secret: true }],
    steps: ["In Fernand, open Settings → Integrations → API Key and create a key.", "Paste it below."],
    async check(c) {
      await request("Fernand", `${fernandBase()}/conversations?limit=3`, { headers: { "X-API-Key": c.token } });
      return { account: "Fernand" };
    },
    async read(c, since) {
      const found: { id: number; subject?: string; last_updated: string }[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 3; page++) {
        const q = new URLSearchParams({ search: "is:closed", order: "newest", limit: "100", ...(cursor ? { cursor } : {}) });
        const r: { data: { id: number; subject?: string; last_updated: string }[]; cursor: string | null } = await request("Fernand", `${fernandBase()}/conversations?${q}`, {
          headers: { "X-API-Key": c.token },
        });
        found.push(...r.data.filter((x) => new Date(x.last_updated) >= since));
        cursor = r.cursor;
        if (!cursor) break;
      }
      const out: Resolved[] = [];
      for (const conv of found.slice(0, MAX_PER_SYNC)) {
        const r = await request<{ data: { type: string; message?: string; way?: string; timestamp: string }[] }>(
          "Fernand",
          `${fernandBase()}/conversations/${conv.id}/messages?limit=100`,
          { headers: { "X-API-Key": c.token } },
        );
        const messages = byTime(r.data.filter((m) => m.type === "MESSAGE").map((m) => ({ at: Date.parse(m.timestamp), from: m.way === "OUT" ? ("support" as const) : ("customer" as const), text: newPartOfEmail(htmlText(m.message ?? "")) })));
        out.push({ id: String(conv.id), subject: conv.subject ?? "", customer: "", resolvedAt: new Date(conv.last_updated), messages });
      }
      return out;
    },
  },

  intercom: {
    name: "Intercom",
    items: "closed conversations",
    fields: [
      {
        name: "region",
        label: "Data region",
        options: [
          { value: "us", label: "United States" },
          { value: "eu", label: "Europe" },
          { value: "au", label: "Australia" },
        ],
      },
      { name: "token", label: "Access token", secret: true, placeholder: "dG9rOj…" },
    ],
    steps: [
      "In Intercom, open [Settings → Integrations → Developer Hub](https://app.intercom.com/a/apps/_/developer-hub) and create an app for your workspace.",
      "Open the app's Authentication page and copy its Access token. Reading conversations is all it needs.",
      "Paste it below and choose where your workspace's data is hosted.",
    ],
    async check(c) {
      const me = await request<{ app?: { name?: string; id_code?: string } }>("Intercom", `${intercomBase(c)}/me`, { headers: intercomHeaders(c) });
      return { account: me.app?.name || "Intercom", extra: { appId: me.app?.id_code ?? "" } };
    },
    async read(c, since) {
      const ids: string[] = [];
      let after: string | undefined;
      for (let page = 0; page < 4 && ids.length < MAX_PER_SYNC; page++) {
        const r: { conversations: { id: string }[]; pages?: { next?: { starting_after?: string } | null } } = await request("Intercom", `${intercomBase(c)}/conversations/search`, {
          method: "POST",
          headers: intercomHeaders(c),
          body: JSON.stringify({
            query: {
              operator: "AND",
              value: [
                { field: "state", operator: "=", value: "closed" },
                { field: "updated_at", operator: ">", value: unix(since) },
              ],
            },
            pagination: { per_page: 50, ...(after ? { starting_after: after } : {}) },
          }),
        });
        ids.push(...r.conversations.map((x) => String(x.id)));
        after = r.pages?.next?.starting_after;
        if (!after) break;
      }
      const who = (a?: IntercomAuthor): Message["from"] => (["admin", "bot", "team"].includes(a?.type ?? "") ? "support" : "customer");
      const out: Resolved[] = [];
      for (const id of ids.slice(0, MAX_PER_SYNC)) {
        const conv = await request<IntercomConversation>("Intercom", `${intercomBase(c)}/conversations/${id}?display_as=plaintext`, { headers: intercomHeaders(c) });
        const messages: Message[] = [];
        if (conv.source?.body) messages.push({ from: who(conv.source.author), text: htmlText(conv.source.body) });
        for (const p of conv.conversation_parts?.conversation_parts ?? []) {
          if (p.body && p.part_type !== "note") messages.push({ from: who(p.author), text: htmlText(p.body) });
        }
        out.push({
          id,
          subject: htmlText(conv.title || conv.source?.subject || ""),
          customer: conv.source?.author?.email || conv.source?.author?.name || "",
          resolvedAt: new Date(1000 * (conv.statistics?.last_close_at || conv.updated_at)),
          url: c.appId ? `https://app.intercom.com/a/inbox/${c.appId}/inbox/conversation/${id}` : undefined,
          messages,
        });
      }
      return out;
    },
  },

  helpscout: {
    name: "Help Scout",
    items: "closed conversations",
    fields: [
      { name: "appId", label: "App ID" },
      { name: "appSecret", label: "App Secret", secret: true },
    ],
    steps: [
      "In Help Scout, open [Your Profile → My Apps](https://secure.helpscout.net/users/apps) and create an app. Any redirection URL works; it isn't used.",
      "Copy the App ID and App Secret. The app reads the mailboxes you can see.",
      "Paste them below.",
    ],
    async check(c) {
      const token = await helpScoutToken(c);
      const r = await request<{ _embedded?: { mailboxes?: { name: string }[] } }>("Help Scout", `${api("helpscout", "https://api.helpscout.net")}/v2/mailboxes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const names = r._embedded?.mailboxes?.map((m) => m.name) ?? [];
      return { account: names.length ? names.join(", ") : "Help Scout" };
    },
    async read(c, since) {
      const token = await helpScoutToken(c);
      const out: Resolved[] = [];
      for (let page = 1; page <= 3 && out.length < MAX_PER_SYNC; page++) {
        const q = new URLSearchParams({ status: "closed", modifiedSince: isoSeconds(since), embed: "threads", sortField: "modifiedAt", sortOrder: "desc", page: String(page) });
        const r = await request<{ _embedded?: { conversations?: HelpScoutConversation[] }; page?: { totalPages?: number } }>(
          "Help Scout",
          `${api("helpscout", "https://api.helpscout.net")}/v2/conversations?${q}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        for (const conv of r._embedded?.conversations ?? []) {
          const messages = byTime(
            (conv._embedded?.threads ?? [])
              .filter((t) => ["customer", "message", "reply", "chat"].includes(t.type))
              .map((t) => ({
                at: Date.parse(t.createdAt),
                from: t.type === "customer" || (t.type === "chat" && t.createdBy?.type === "customer") ? ("customer" as const) : ("support" as const),
                text: newPartOfEmail(htmlText(t.body ?? "")),
              })),
          );
          out.push({
            id: String(conv.id),
            subject: conv.subject ?? "",
            customer: conv.primaryCustomer?.email ?? "",
            resolvedAt: new Date(conv.closedAt || conv.userUpdatedAt || Date.now()),
            url: `https://secure.helpscout.net/conversation/${conv.id}`,
            messages,
          });
        }
        if (page >= (r.page?.totalPages ?? 1)) break;
      }
      return out;
    },
  },

  "slack-support": {
    name: "Slack",
    items: "resolved support threads",
    fields: [
      { name: "token", label: "Bot User OAuth Token", secret: true, placeholder: "xoxb-…" },
      { name: "channel", label: "Support channel ID", placeholder: "C0123ABCDEF", hint: "In Slack, open the channel's details; the ID is at the bottom." },
    ],
    steps: [
      "In your Slack app at [api.slack.com/apps](https://api.slack.com/apps), open OAuth & Permissions and add the bot scopes channels:history and channels:read (groups:history and groups:read for a private channel).",
      "Reinstall the app to your workspace and copy the Bot User OAuth Token.",
      "Invite the app to your support channel, then copy the channel's ID from its details.",
      "Paste both below. A thread counts as resolved once it gets a ✅ or has been quiet for a day.",
    ],
    clean: (c) => ({ ...c, channel: c.channel.toUpperCase() }),
    async check(c) {
      const auth = await slack<{ team: string; url: string }>(c, "auth.test", {});
      const info = await slack<{ channel: { name: string } }>(c, "conversations.info", { channel: c.channel });
      return { account: `#${info.channel.name} in ${auth.team}`, extra: { teamUrl: auth.url } };
    },
    async read(c, since) {
      const now = Date.now();
      const history = await slack<{ messages: SlackMessage[] }>(c, "conversations.history", { channel: c.channel, oldest: String(unix(since) - 30 * 86_400), limit: "200" });
      const threads = history.messages.filter((m) => {
        if (!m.reply_count || !m.latest_reply) return false;
        const last = Number(m.latest_reply) * 1000;
        const quiet = last + 86_400_000;
        const checked = m.reactions?.some((r) => DONE_REACTIONS.has(r.name));
        return (quiet >= since.getTime() && quiet <= now) || (checked && last >= since.getTime());
      });
      const out: Resolved[] = [];
      for (const parent of threads.slice(0, MAX_PER_SYNC)) {
        const r = await slack<{ messages: SlackMessage[] }>(c, "conversations.replies", { channel: c.channel, ts: parent.ts, limit: "200" });
        const messages = r.messages.map((m) => ({ from: m.user === parent.user && !m.bot_id ? ("customer" as const) : ("support" as const), text: m.text ?? "" }));
        out.push({
          id: `${c.channel}-${parent.ts}`,
          subject: firstLine(parent.text ?? ""),
          customer: parent.user ? `Slack user ${parent.user}` : "",
          resolvedAt: new Date(Number(parent.latest_reply) * 1000),
          url: c.teamUrl ? `${c.teamUrl.replace(/\/?$/, "/")}archives/${c.channel}/p${parent.ts.replace(".", "")}` : undefined,
          messages,
        });
      }
      return out;
    },
  },

  hubspot: {
    name: "HubSpot",
    items: "closed conversations",
    fields: [{ name: "token", label: "Private app access token", secret: true, placeholder: "pat-na1-…" }],
    steps: [
      "In HubSpot, open [Settings → Integrations → Private Apps](https://app.hubspot.com/private-apps/) and create a private app.",
      "On Scopes, add conversations.read. Create the app and copy its access token.",
      "Paste it below.",
    ],
    async check(c) {
      const r = await request<{ portalId?: number }>("HubSpot", `${hubspotBase()}/account-info/v3/details`, { headers: { Authorization: `Bearer ${c.token}` } });
      return { account: r.portalId ? `HubSpot account ${r.portalId}` : "HubSpot", extra: { portalId: String(r.portalId ?? "") } };
    },
    async read(c, since) {
      const closed: { id: string; closedAt?: string; latestMessageTimestamp?: string }[] = [];
      let after: string | undefined;
      for (let page = 0; page < 3 && closed.length < MAX_PER_SYNC; page++) {
        const q = new URLSearchParams({ sort: "latestMessageTimestamp", latestMessageTimestampAfter: since.toISOString(), limit: "100", ...(after ? { after } : {}) });
        const r: { results: { id: string; status: string; spam?: boolean; closedAt?: string; latestMessageTimestamp?: string }[]; paging?: { next?: { after?: string } } } = await request(
          "HubSpot",
          `${hubspotBase()}/conversations/v3/conversations/threads?${q}`,
          { headers: { Authorization: `Bearer ${c.token}` } },
        );
        closed.push(...r.results.filter((t) => t.status === "CLOSED" && !t.spam));
        after = r.paging?.next?.after;
        if (!after) break;
      }
      const out: Resolved[] = [];
      for (const t of closed.slice(0, MAX_PER_SYNC)) {
        const r = await request<{ results: HubSpotMessage[] }>("HubSpot", `${hubspotBase()}/conversations/v3/conversations/threads/${t.id}/messages?limit=100`, {
          headers: { Authorization: `Bearer ${c.token}` },
        });
        const list = byTime(r.results.filter((m) => m.type === "MESSAGE").map((m) => ({ ...m, at: Date.parse(m.createdAt) })));
        const firstIn = list.find((m) => m.direction === "INCOMING");
        out.push({
          id: t.id,
          subject: list.find((m) => m.subject)?.subject ?? "",
          customer: firstIn?.senders?.[0]?.deliveryIdentifier?.value || firstIn?.senders?.[0]?.name || "",
          resolvedAt: new Date(t.closedAt || t.latestMessageTimestamp || Date.now()),
          url: c.portalId ? `https://app.hubspot.com/live-messages/${c.portalId}/inbox/${t.id}` : undefined,
          messages: list.map((m) => ({ from: m.direction === "INCOMING" ? "customer" : "support", text: newPartOfEmail(m.text || htmlText(m.richText ?? "")) })),
        });
      }
      return out;
    },
  },

  pylon: {
    name: "Pylon",
    items: "closed issues",
    fields: [
      {
        name: "region",
        label: "Region",
        options: [
          { value: "us", label: "United States" },
          { value: "eu", label: "Europe" },
        ],
      },
      { name: "token", label: "API token", secret: true },
    ],
    steps: ["In Pylon, an admin opens [Settings → API Tokens](https://app.usepylon.com/settings/api-tokens) and creates a token.", "Paste it below and choose your Pylon region."],
    async check(c) {
      const r = await request<{ data?: { name?: string; email?: string } }>("Pylon", `${pylonBase(c)}/me`, { headers: { Authorization: `Bearer ${c.token}` } });
      return { account: r.data?.name || r.data?.email || "Pylon" };
    },
    async read(c, since) {
      // Pylon lists issues by when they were opened; anything closed recently was opened in the last 60 days or so.
      const q = new URLSearchParams({ start_time: isoSeconds(new Date(Date.now() - 60 * 86_400_000)), end_time: isoSeconds(new Date(Date.now() + 60_000)), limit: "1000" });
      const r = await request<{ data: PylonIssue[] }>("Pylon", `${pylonBase(c)}/issues?${q}`, { headers: { Authorization: `Bearer ${c.token}` } });
      const closed = r.data.filter((i) => i.state === "closed" && new Date(i.resolution_time || i.updated_at || 0) >= since).slice(0, MAX_PER_SYNC);
      const out: Resolved[] = [];
      for (const issue of closed) {
        const m = await request<{ data: { message_html?: string; is_private?: boolean; timestamp: string; author?: { contact?: unknown; user?: unknown } | null }[] }>(
          "Pylon",
          `${pylonBase(c)}/issues/${issue.id}/messages`,
          { headers: { Authorization: `Bearer ${c.token}` } },
        );
        out.push({
          id: issue.id,
          subject: issue.title ?? "",
          customer: issue.requester?.email ?? "",
          resolvedAt: new Date(issue.resolution_time || issue.updated_at || Date.now()),
          url: issue.link,
          messages: m.data.filter((x) => !x.is_private).map((x) => ({ from: x.author?.user && !x.author.contact ? "support" : "customer", text: newPartOfEmail(htmlText(x.message_html ?? "")) })),
        });
      }
      return out;
    },
  },

  plain: {
    name: "Plain",
    items: "done threads",
    fields: [{ name: "token", label: "API key", secret: true, placeholder: "plainApiKey_…" }],
    steps: [
      "In Plain, open Settings → Machine users and add one for AutoDocs.",
      "Give it an API key that can read threads, customers, and timelines, and copy the key.",
      "Paste it below.",
    ],
    async check(c) {
      const r = await plainQuery<{ myWorkspace: { id: string; name: string } }>(c, "query { myWorkspace { id name } }");
      return { account: r.myWorkspace.name, extra: { workspaceId: r.myWorkspace.id } };
    },
    async read(c, since) {
      type Thread = { id: string; title: string; updatedAt: { iso8601: string }; customer?: { fullName?: string; email?: { email?: string } } };
      const done: Thread[] = [];
      let after: string | null = null;
      for (let page = 0; page < 4 && done.length < MAX_PER_SYNC; page++) {
        const r: { threads: PlainPage<Thread> } = await plainQuery(
          c,
          `query Done($after: String) {
            threads(filters: { statuses: [DONE] }, first: 50, after: $after) {
              edges { node { id title updatedAt { iso8601 } customer { fullName email { email } } } }
              pageInfo { hasNextPage endCursor }
            }
          }`,
          { after },
        );
        done.push(...r.threads.edges.map((e) => e.node).filter((t) => new Date(t.updatedAt.iso8601) >= since));
        if (!r.threads.pageInfo.hasNextPage) break;
        after = r.threads.pageInfo.endCursor;
      }
      const out: Resolved[] = [];
      for (const t of done.slice(0, MAX_PER_SYNC)) {
        const messages: Message[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 3; page++) {
          const r: { thread: { timelineEntries: PlainPage<{ llmText: string | null; actor?: { __typename?: string } }> } } = await plainQuery(
            c,
            `query Timeline($id: ID!, $after: String) {
              thread(threadId: $id) {
                timelineEntries(first: 50, after: $after) {
                  edges { node { llmText actor { __typename } } }
                  pageInfo { hasNextPage endCursor }
                }
              }
            }`,
            { id: t.id, after: cursor },
          );
          for (const { node } of r.thread.timelineEntries.edges) {
            if (node.llmText) messages.push({ from: node.actor?.__typename === "CustomerActor" ? "customer" : "support", text: node.llmText });
          }
          if (!r.thread.timelineEntries.pageInfo.hasNextPage) break;
          cursor = r.thread.timelineEntries.pageInfo.endCursor;
        }
        out.push({
          id: t.id,
          subject: t.title,
          customer: t.customer?.email?.email || t.customer?.fullName || "",
          resolvedAt: new Date(t.updatedAt.iso8601),
          url: c.workspaceId ? `https://app.plain.com/workspace/${c.workspaceId}/thread/${t.id}/` : undefined,
          messages,
        });
      }
      return out;
    },
  },

  zendesk: {
    name: "Zendesk",
    items: "solved tickets",
    fields: [
      { name: "subdomain", label: "Zendesk subdomain", placeholder: "yourcompany", hint: "The part before .zendesk.com." },
      { name: "email", label: "Agent email", placeholder: "you@yourcompany.com", hint: "Tickets are read as this agent or admin." },
      { name: "token", label: "API token", secret: true },
    ],
    steps: [
      "In Zendesk, open Admin Center → Apps and integrations → APIs → [Zendesk API](https://support.zendesk.com/hc/en-us/articles/4408889192858) and turn on Token access.",
      "Add an API token and copy it.",
      "Paste it below with your subdomain and the email of an agent or admin.",
    ],
    clean(c) {
      const subdomain = c.subdomain.replace(/^https?:\/\//, "").replace(/\.zendesk\.com.*$/, "").toLowerCase();
      if (!/^[a-z0-9-]+$/.test(subdomain)) throw new HelpdeskError("Enter the subdomain only, like yourcompany for yourcompany.zendesk.com.");
      return { ...c, subdomain };
    },
    async check(c) {
      const r = await request<{ user?: ZendeskUser }>("Zendesk", `${zendeskBase(c)}/api/v2/users/me.json`, { headers: zendeskAuth(c) });
      if (!r.user?.id || r.user.role === "end-user") throw new HelpdeskError("Zendesk signed in as a customer, not an agent. Use an agent's or admin's email with the token.");
      return { account: `${c.subdomain}.zendesk.com` };
    },
    async read(c, since) {
      const tickets: ZendeskTicket[] = [];
      let url: string | null = `${zendeskBase(c)}/api/v2/search.json?${new URLSearchParams({
        query: `type:ticket status>=solved updated>${isoSeconds(since)}`,
        sort_by: "updated_at",
        sort_order: "desc",
        per_page: "100",
      })}`;
      for (let page = 0; url && page < 2; page++) {
        const r: { results: ZendeskTicket[]; next_page: string | null } = await request("Zendesk", url, { headers: zendeskAuth(c) });
        tickets.push(...r.results);
        url = r.next_page;
      }
      const out: Resolved[] = [];
      for (const t of tickets.slice(0, MAX_PER_SYNC)) {
        const r = await request<{ comments: { author_id: number; plain_body?: string; body?: string; public: boolean }[]; users?: ZendeskUser[] }>(
          "Zendesk",
          `${zendeskBase(c)}/api/v2/tickets/${t.id}/comments.json?include=users`,
          { headers: zendeskAuth(c) },
        );
        const users = new Map((r.users ?? []).map((u) => [u.id, u]));
        out.push({
          id: String(t.id),
          subject: t.subject,
          customer: users.get(t.requester_id)?.email ?? "",
          resolvedAt: new Date(t.updated_at),
          url: `https://${c.subdomain}.zendesk.com/agent/tickets/${t.id}`,
          messages: r.comments
            .filter((m) => m.public)
            .map((m) => ({
              from: m.author_id === t.requester_id || users.get(m.author_id)?.role === "end-user" ? "customer" : "support",
              text: newPartOfEmail(m.plain_body ?? htmlText(m.body ?? "")),
            })),
        });
      }
      return out;
    },
  },

  missive: {
    name: "Missive",
    items: "closed conversations",
    fields: [{ name: "token", label: "API token", secret: true, placeholder: "missive_pat-…" }],
    steps: ["In Missive, open Preferences → API and create a token.", "Paste it below. AutoDocs reads the closed conversations that token's user can see."],
    async check(c) {
      const r = await request<{ organizations?: { name: string }[] }>("Missive", `${missiveBase()}/organizations`, { headers: missiveHeaders(c) });
      return { account: r.organizations?.map((o) => o.name).join(", ") || "Missive" };
    },
    async read(c, since) {
      type Conv = { id: string; subject?: string | null; latest_message_subject?: string | null; last_activity_at: number; web_url?: string };
      const closed: Conv[] = [];
      let until: number | undefined;
      for (let page = 0; page < 4; page++) {
        const q = new URLSearchParams({ closed: "true", limit: "50", ...(until ? { until: String(until) } : {}) });
        const r: { conversations: Conv[] } = await request("Missive", `${missiveBase()}/conversations?${q}`, { headers: missiveHeaders(c) });
        const recent = r.conversations.filter((x) => x.last_activity_at >= unix(since));
        closed.push(...recent);
        if (r.conversations.length < 50 || recent.length < r.conversations.length) break;
        until = r.conversations[r.conversations.length - 1].last_activity_at;
      }
      const out: Resolved[] = [];
      for (const conv of closed.slice(0, MAX_PER_SYNC)) {
        const list = await request<{ messages: { id: string; preview?: string; delivered_at: number; from_field?: { name?: string; address?: string } }[] }>(
          "Missive",
          `${missiveBase()}/conversations/${conv.id}/messages?limit=10`,
          { headers: missiveHeaders(c) },
        );
        const ordered = byTime(list.messages.map((m) => ({ ...m, at: m.delivered_at })));
        const customer = ordered[0]?.from_field?.address?.toLowerCase() ?? "";
        const messages: Message[] = [];
        for (const m of ordered) {
          const full = await request<{ messages?: { body?: string } | { body?: string }[] }>("Missive", `${missiveBase()}/messages/${m.id}`, { headers: missiveHeaders(c) });
          const body = Array.isArray(full.messages) ? full.messages[0]?.body : full.messages?.body;
          messages.push({ from: m.from_field?.address?.toLowerCase() === customer ? "customer" : "support", text: newPartOfEmail(body ? htmlText(body) : (m.preview ?? "")) });
        }
        out.push({
          id: conv.id,
          subject: conv.subject || conv.latest_message_subject || "",
          customer,
          resolvedAt: new Date(conv.last_activity_at * 1000),
          url: conv.web_url,
          messages,
        });
      }
      return out;
    },
  },

  crisp: {
    name: "Crisp",
    items: "resolved conversations",
    fields: [
      { name: "websiteId", label: "Website ID", placeholder: "8c842203-7ed8-4e29-a608-7cf78a7d2fcc", hint: "Settings → Workspace Settings → Setup & Integrations." },
      { name: "identifier", label: "Token identifier" },
      { name: "key", label: "Token key", secret: true },
    ],
    steps: [
      "In the [Crisp Marketplace](https://marketplace.crisp.chat/), create a private plugin and request a production token with the website:conversation:sessions and website:conversation:messages read scopes.",
      "Install the plugin on your website and copy the token's identifier and key.",
      "Paste them below with your website ID.",
    ],
    async check(c) {
      const r = await request<{ data?: { name?: string } }>("Crisp", `${crispBase()}/website/${encodeURIComponent(c.websiteId)}`, { headers: crispHeaders(c) });
      return { account: r.data?.name || "Crisp" };
    },
    async read(c, since) {
      type Conv = { session_id: string; updated_at: number; meta?: { nickname?: string; email?: string; subject?: string } };
      const resolved: Conv[] = [];
      for (let page = 1; page <= 4; page++) {
        const r: { data: Conv[] } = await request("Crisp", `${crispBase()}/website/${encodeURIComponent(c.websiteId)}/conversations/${page}?filter_resolved=1&per_page=50`, {
          headers: crispHeaders(c),
        });
        const recent = r.data.filter((x) => x.updated_at >= since.getTime());
        resolved.push(...recent);
        if (r.data.length < 50 || recent.length < r.data.length) break;
      }
      const out: Resolved[] = [];
      for (const conv of resolved.slice(0, MAX_PER_SYNC)) {
        const r = await request<{ data: { from: string; type: string; content: unknown; timestamp: number }[] }>(
          "Crisp",
          `${crispBase()}/website/${encodeURIComponent(c.websiteId)}/conversation/${conv.session_id}/messages`,
          { headers: crispHeaders(c) },
        );
        const messages = byTime(
          r.data
            .filter((m) => m.type === "text" && typeof m.content === "string")
            .map((m) => ({ at: m.timestamp, from: m.from === "operator" ? ("support" as const) : ("customer" as const), text: String(m.content) })),
        );
        out.push({
          id: conv.session_id,
          subject: conv.meta?.subject ?? "",
          customer: conv.meta?.email || conv.meta?.nickname || "",
          resolvedAt: new Date(conv.updated_at),
          url: `https://app.crisp.chat/website/${c.websiteId}/inbox/${conv.session_id}/`,
          messages,
        });
      }
      return out;
    },
  },

  discord: {
    name: "Discord",
    items: "closed forum posts",
    fields: [
      { name: "token", label: "Bot token", secret: true },
      { name: "channel", label: "Support forum channel ID", placeholder: "1234567890123456789", hint: "With Developer Mode on, right-click the channel → Copy Channel ID." },
    ],
    steps: [
      "In the [Discord Developer Portal](https://discord.com/developers/applications), create an application, add a bot, and turn on Message Content Intent.",
      "Invite the bot to your server with permission to view channels and read message history.",
      "Copy the bot token and your support forum's channel ID, and paste them below. Closed (archived) posts count as resolved.",
    ],
    clean(c) {
      if (!/^\d{15,22}$/.test(c.channel)) throw new HelpdeskError("The channel ID is a long number. Turn on Developer Mode, then right-click the channel → Copy Channel ID.");
      return c;
    },
    async check(c) {
      const r = await request<{ name: string; guild_id?: string }>("Discord", `${discordBase()}/channels/${c.channel}`, { headers: { Authorization: `Bot ${c.token}` } });
      return { account: `#${r.name}`, extra: { guildId: r.guild_id ?? "" } };
    },
    async read(c, since) {
      type Thread = { id: string; name: string; owner_id: string; thread_metadata?: { archive_timestamp?: string } };
      const closed: Thread[] = [];
      let before: string | undefined;
      for (let page = 0; page < 4; page++) {
        const q = new URLSearchParams({ limit: "50", ...(before ? { before } : {}) });
        const r: { threads: Thread[]; has_more: boolean } = await request("Discord", `${discordBase()}/channels/${c.channel}/threads/archived/public?${q}`, {
          headers: { Authorization: `Bot ${c.token}` },
        });
        const recent = r.threads.filter((t) => new Date(t.thread_metadata?.archive_timestamp ?? 0) >= since);
        closed.push(...recent);
        if (!r.has_more || recent.length < r.threads.length || !r.threads.length) break;
        before = r.threads[r.threads.length - 1].thread_metadata?.archive_timestamp;
      }
      const out: Resolved[] = [];
      for (const t of closed.slice(0, MAX_PER_SYNC)) {
        const list = await request<DiscordMessage[]>("Discord", `${discordBase()}/channels/${t.id}/messages?limit=100`, { headers: { Authorization: `Bot ${c.token}` } });
        const ordered = byTime(list.map((m) => ({ ...m, at: Date.parse(m.timestamp) })));
        const owner = ordered.find((m) => m.author.id === t.owner_id)?.author;
        out.push({
          id: t.id,
          subject: t.name,
          customer: owner ? owner.global_name || owner.username : "",
          resolvedAt: new Date(t.thread_metadata?.archive_timestamp ?? Date.now()),
          url: c.guildId ? `https://discord.com/channels/${c.guildId}/${t.id}` : undefined,
          messages: ordered.map((m) => ({ from: m.author.id === t.owner_id ? "customer" : "support", text: m.content })),
        });
      }
      return out;
    },
  },

  gmail: {
    name: "Gmail",
    items: "answered email threads",
    fields: [
      { name: "email", label: "Support address", placeholder: "support@yourcompany.com" },
      { name: "password", label: "App password", secret: true, placeholder: "16 characters", hint: "Not the account's normal password." },
    ],
    steps: [
      "Sign in as the support mailbox's Google account, turn on [2-Step Verification](https://myaccount.google.com/security), and create an [app password](https://myaccount.google.com/apppasswords) named AutoDocs.",
      "Paste the address and app password below. In Google Workspace, an admin may need to allow IMAP and app passwords.",
      "A thread counts as resolved once your team replied last and the customer hasn't written back for a day.",
    ],
    clean(c) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) throw new HelpdeskError("Enter the support mailbox's full email address.");
      return { ...c, email: c.email.toLowerCase(), password: c.password.replace(/\s+/g, "") };
    },
    async check(c) {
      const exists = await withGmail(c, async (client, box) => (await client.mailboxOpen(box, { readOnly: true })).exists);
      return { account: `${c.email} · ${exists.toLocaleString("en-US")} emails` };
    },
    async read(c, since) {
      const support = c.email;
      const ours = (from: string) => from === support || from.split("@")[1] === support.split("@")[1];
      return withGmail(c, async (client, box) => {
        await client.mailboxOpen(box, { readOnly: true });
        // A thread resolves a day after the team's last reply, so look a little further back than that.
        const uids = (await client.search({ since: new Date(since.getTime() - 3 * 86_400_000) }, { uid: true })) || [];
        const latest = new Map<string, { at: number; from: string }>();
        for await (const m of client.fetch(uids.slice(-500), { envelope: true, internalDate: true, threadId: true }, { uid: true })) {
          if (!m.threadId) continue;
          const at = m.internalDate ? new Date(m.internalDate).getTime() : 0;
          const prev = latest.get(m.threadId);
          if (!prev || at > prev.at) latest.set(m.threadId, { at, from: (m.envelope?.from?.[0]?.address ?? "").toLowerCase() });
        }
        const now = Date.now();
        const due = [...latest].filter(([, last]) => ours(last.from) && last.at + 86_400_000 >= since.getTime() && last.at + 86_400_000 <= now);
        const out: Resolved[] = [];
        for (const [threadId, last] of due.slice(0, MAX_PER_SYNC)) {
          const ids = (await client.search({ threadId }, { uid: true })) || [];
          const parsed: { at: number; from: string; subject: string; text: string }[] = [];
          for await (const m of client.fetch(ids.slice(-30), { source: true, internalDate: true }, { uid: true })) {
            if (!m.source) continue;
            const p = await simpleParser(m.source);
            parsed.push({
              at: m.internalDate ? new Date(m.internalDate).getTime() : (p.date?.getTime() ?? 0),
              from: emailAddress(p.from?.text ?? ""),
              subject: p.subject ?? "",
              text: newPartOfEmail(p.text || htmlText(typeof p.html === "string" ? p.html : "")),
            });
          }
          const ordered = byTime(parsed);
          const customer = ordered.find((m) => !ours(m.from))?.from;
          if (!customer) continue; // Only the team wrote: an outgoing email, not a support conversation.
          out.push({
            id: threadId,
            subject: ordered[0]?.subject ?? "",
            customer,
            resolvedAt: new Date(last.at + 86_400_000),
            url: `https://mail.google.com/mail/u/0/#all/${BigInt(threadId).toString(16)}`,
            messages: ordered.map((m) => ({ from: ours(m.from) ? "support" : "customer", text: m.text })),
          });
        }
        return out;
      });
    },
  },

  bolddesk: {
    name: "BoldDesk",
    items: "closed tickets",
    fields: [
      { name: "domain", label: "BoldDesk address", placeholder: "yourcompany.bolddesk.com" },
      { name: "token", label: "API key", secret: true },
    ],
    steps: ["In BoldDesk, open your profile → API Keys and create a key.", "Paste it below with your BoldDesk address."],
    clean(c) {
      const domain = c.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new HelpdeskError("Enter your BoldDesk address, like yourcompany.bolddesk.com.");
      return { ...c, domain };
    },
    async check(c) {
      await request("BoldDesk", `${boldDeskBase(c)}/tickets?Page=1&PerPage=1`, { headers: { "x-api-key": c.token } });
      return { account: c.domain };
    },
    async read(c, since) {
      const closed: Record<string, unknown>[] = [];
      for (let page = 1; page <= 3; page++) {
        const r = await request<BoldDeskList>("BoldDesk", `${boldDeskBase(c)}/tickets?Page=${page}&PerPage=100&OrderBy=lastModifiedOn%20desc`, { headers: { "x-api-key": c.token } });
        const list = r.result ?? r.data ?? [];
        const recent = list.filter((t) => new Date(String(field(t, "lastModifiedOn", "lastUpdatedOn", "closedOn") ?? 0)) >= since);
        closed.push(
          ...recent.filter((t) => {
            const status = field(t, "status") as { description?: string } | string | undefined;
            const name = typeof status === "string" ? status : (status?.description ?? String(field(t, "statusName") ?? ""));
            return Boolean(field(t, "closedOn")) || /closed|resolved/i.test(name);
          }),
        );
        if (list.length < 100 || recent.length < list.length) break;
      }
      const out: Resolved[] = [];
      for (const t of closed.slice(0, MAX_PER_SYNC)) {
        const id = String(field(t, "ticketId", "id"));
        const r = await request<BoldDeskList>("BoldDesk", `${boldDeskBase(c)}/tickets/${id}/public-messages?Page=1&PerPage=100`, { headers: { "x-api-key": c.token } });
        const messages = byTime(
          (r.result ?? r.data ?? []).map((m) => ({
            at: Date.parse(String(field(m, "createdOn", "updatedOn") ?? 0)),
            from: field(m, "isAgent") === true || field(m, "isUpdatedByCustomer", "IsUpdatedByCustomer") === false ? ("support" as const) : ("customer" as const),
            text: newPartOfEmail(htmlText(String(field(m, "description", "content", "message") ?? ""))),
          })),
        );
        const requester = field(t, "requestedBy", "requester") as { emailId?: string; email?: string; displayName?: string } | undefined;
        out.push({
          id,
          subject: String(field(t, "title", "subject") ?? ""),
          customer: requester?.emailId || requester?.email || requester?.displayName || "",
          resolvedAt: new Date(String(field(t, "closedOn", "lastModifiedOn") ?? Date.now())),
          url: `https://${c.domain}/agent/tickets/${id}`,
          messages,
        });
      }
      return out;
    },
  },
};

/** Opens the support mailbox's "All Mail" folder (its name depends on the account's language). */
async function withGmail<T>(c: Creds, fn: (client: ImapFlow, box: string) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: process.env.HELPDESK_IMAP_HOST || "imap.gmail.com",
    port: Number(process.env.HELPDESK_IMAP_PORT || 993),
    secure: true,
    auth: { user: c.email, pass: c.password },
    logger: false,
  });
  try {
    await client.connect();
  } catch (err) {
    const text = err instanceof Error ? `${err.message} ${(err as { responseText?: string }).responseText ?? ""}` : String(err);
    if (/auth|credentials|password/i.test(text)) throw new HelpdeskError("Gmail didn't accept the address and app password. Create a new app password and try again.");
    throw new HelpdeskError(`Couldn't reach Gmail: ${text.trim()}`);
  }
  try {
    const box = (await client.list()).find((b) => b.specialUse === "\\All")?.path ?? "INBOX";
    return await fn(client, box);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/* What the pages and the scheduler use */

export type HelpdeskInfo = Omit<Helpdesk, "check" | "read" | "clean"> & { id: HelpdeskId };

export function isHelpdesk(id: string): id is HelpdeskId {
  return (HELPDESK_IDS as readonly string[]).includes(id);
}

export function helpdeskInfo(id: HelpdeskId): HelpdeskInfo {
  const { name, items, fields, steps } = HELPDESKS[id];
  return { id, name, items, fields, steps };
}

type HelpdeskConfig = {
  values?: Creds;
  account?: string;
  extra?: Creds;
  cursor?: string;
  lastSyncAt?: string;
  lastCount?: number;
  lastError?: string;
};

export type HelpdeskState = HelpdeskConfig & { connected: boolean; connectedAt: string | null; label: string; description: string };

export async function helpdeskState(id: HelpdeskId): Promise<HelpdeskState> {
  const row = await getIntegration<HelpdeskConfig>(id);
  return { ...(row?.config ?? {}), connected: Boolean(row?.connected_at), connectedAt: row?.connected_at ?? null, label: row?.label ?? "", description: row?.description ?? "" };
}

/** Every connected helpdesk's state, for the integrations list. */
export async function connectedHelpdesks(): Promise<Map<HelpdeskId, HelpdeskState>> {
  const rows = await all<{ kind: HelpdeskId; config: HelpdeskConfig; connected_at: string; label: string; description: string }>(
    "SELECT kind, config, connected_at, label, description FROM integrations WHERE kind = ANY($1) AND connected_at IS NOT NULL",
    [HELPDESK_IDS],
  );
  return new Map(rows.map((r) => [r.kind, { ...r.config, connected: true, connectedAt: r.connected_at, label: r.label, description: r.description }]));
}

/**
 * Checks the credentials with the helpdesk, then saves them and starts the first read. A blank
 * secret keeps the saved one, so other fields can change without pasting the key again.
 */
export async function connectHelpdesk(id: HelpdeskId, input: Creds): Promise<string> {
  const def = HELPDESKS[id];
  const saved = (await getSecrets<Creds>(id)) ?? {};
  const values: Creds = {};
  const secrets: Creds = {};
  for (const f of def.fields) {
    const v = (input[f.name] ?? "").trim().slice(0, 500);
    if (f.secret) secrets[f.name] = v || saved[f.name] || "";
    else values[f.name] = v || f.options?.[0]?.value || "";
    if (!(f.secret ? secrets : values)[f.name]) throw new HelpdeskError(`Enter the ${f.label.charAt(0).toLowerCase()}${f.label.slice(1)}.`);
  }
  const creds = def.clean ? def.clean({ ...values, ...secrets }) : { ...values, ...secrets };
  for (const f of def.fields) (f.secret ? secrets : values)[f.name] = creds[f.name];
  const { account, extra } = await def.check(creds);
  await saveIntegration(id, { config: { values, account, extra: extra ?? {}, lastError: "" }, secrets, connected: true });
  await enqueue("helpdesk", { id }, { dedupeKey: `helpdesk:${id}`, sooner: true });
  return account;
}

export async function disconnectHelpdesk(id: HelpdeskId) {
  // Conversations already read stay, with any gaps found and drafts started.
  await removeIntegration(id);
}

/** Reads conversations resolved since the last read and hands them to the review. Runs as the "helpdesk" job. */
export async function syncHelpdesk(id: HelpdeskId): Promise<number> {
  const state = await helpdeskState(id);
  const secrets = await getSecrets<Creds>(id);
  if (!state.connected || !secrets) return 0;
  const started = new Date();
  const since = state.cursor ? new Date(state.cursor) : new Date(started.getTime() - FIRST_LOOKBACK_DAYS * 86_400_000);
  try {
    const found = (await HELPDESKS[id].read({ ...state.values, ...state.extra, ...secrets }, since))
      .filter((c) => c.messages.some((m) => m.from === "customer" && m.text.trim()))
      .sort((a, b) => a.resolvedAt.getTime() - b.resolvedAt.getTime())
      .slice(0, MAX_PER_SYNC);
    let changed = 0;
    for (const c of found) {
      changed += Number(
        await ingestConversation({
          externalId: `${id}:${c.id}`,
          source: id,
          subject: c.subject.trim() || firstLine(c.messages.find((m) => m.from === "customer")?.text ?? ""),
          customer: c.customer,
          transcript: transcriptFromMessages(c.messages),
          resolvedAt: c.resolvedAt.toISOString(),
        }),
      );
    }
    // A full batch may have left some behind: continue from the last one read instead of from now.
    const cursor = found.length === MAX_PER_SYNC ? found[found.length - 1].resolvedAt : new Date(started.getTime() - OVERLAP_MS);
    await saveIntegration(id, { config: { cursor: cursor.toISOString(), lastSyncAt: started.toISOString(), lastCount: changed, lastError: "" } });
    return changed;
  } catch (err) {
    const message = err instanceof HelpdeskError ? err.message : `The last sync failed: ${err instanceof Error ? err.message : String(err)}`;
    await saveIntegration(id, { config: { lastSyncAt: started.toISOString(), lastError: message.slice(0, 400) } });
    return 0;
  }
}

/** Connected helpdesks not read in the last 15 minutes. */
export async function helpdesksDue(): Promise<HelpdeskId[]> {
  const now = Date.now();
  return [...(await connectedHelpdesks())].filter(([, s]) => !s.lastSyncAt || now - new Date(s.lastSyncAt).getTime() >= SYNC_EVERY_MS).map(([id]) => id);
}
