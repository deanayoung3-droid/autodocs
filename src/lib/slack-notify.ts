import "server-only";
import { randomUUID } from "node:crypto";
import { get } from "./db";
import type { EventName } from "./events";
import { adminOrigin, getIntegration, getSecrets, publicOrigin, saveIntegration } from "./integrations";
import { AGENT_NAME, PRODUCT_NAME } from "./product";

// Notifications in a Slack channel, through an Incoming Webhook (a URL Slack gives you for one
// channel). Separate from the /docs command (slack.ts), which has its own app secret. The webhook
// URL is sealed like any credential; SLACK_WEBHOOK_URL on the server works too.

export type SlackTopic = "drafts" | "published" | "skipped" | "failures" | "escalations" | "contact";

export const SLACK_TOPICS: { key: SlackTopic; label: string; hint: string; on: boolean }[] = [
  { key: "drafts", label: "Drafts ready for review", hint: `${AGENT_NAME} drafted article changes, from a pull request or a task.`, on: true },
  { key: "published", label: "Articles published", hint: "A draft was approved, or an article was published through the API.", on: true },
  { key: "skipped", label: "Pull requests that need no docs", hint: `${AGENT_NAME} sorted a merged pull request and decided customers won't notice it.`, on: false },
  { key: "failures", label: "Problems", hint: `${AGENT_NAME} couldn't finish a task or sort a pull request.`, on: true },
  { key: "escalations", label: "Readers asking for a person", hint: "A help center or widget conversation was handed off.", on: true },
  { key: "contact", label: "Contact form messages", hint: "Someone sent a message from the widget.", on: true },
];

type Config = { topics?: Partial<Record<SlackTopic, boolean>>; channel?: string };

/** "docs" or "#docs" → "#docs"; anything that isn't a channel name ("Alex's DM") stays as written. */
export function channelLabel(raw: string): string {
  const c = raw.trim().slice(0, 80);
  if (!c || c === "#") return "";
  return /^#?[a-z0-9][a-z0-9._-]*$/i.test(c) ? `#${c.replace(/^#/, "")}` : c.replace(/^#/, "");
}

export async function slackAlerts() {
  const [meta, secrets] = await Promise.all([getIntegration<Config>("slack-alerts"), getSecrets<{ webhookUrl?: string }>("slack-alerts")]);
  const saved = secrets?.webhookUrl || "";
  const url = saved || process.env.SLACK_WEBHOOK_URL || "";
  const topics = Object.fromEntries(SLACK_TOPICS.map((t) => [t.key, meta?.config.topics?.[t.key] ?? t.on])) as Record<SlackTopic, boolean>;
  return { url, source: saved ? ("saved" as const) : url ? ("environment" as const) : null, topics, channel: channelLabel(meta?.config.channel ?? "") };
}

export function validSlackWebhook(url: string): boolean {
  return /^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+$/.test(url);
}

export async function saveSlackAlerts(p: { webhookUrl?: string; topics?: Record<SlackTopic, boolean>; channel?: string }) {
  await saveIntegration("slack-alerts", {
    config: { ...(p.topics ? { topics: p.topics } : {}), ...(p.channel !== undefined ? { channel: p.channel } : {}) },
    ...(p.webhookUrl ? { secrets: { webhookUrl: p.webhookUrl }, connected: true } : {}),
  });
}

export async function removeSlackAlerts() {
  await saveIntegration("slack-alerts", { secrets: null, connected: false });
}

// Direct messages: a teammate who wants these updates in their own Slack DMs adds a webhook that
// posts to their DM, and picks what they hear about. They live apart from the channel ("slack-dms"),
// so turning the channel off never removes anyone's DMs. Each webhook URL is sealed.

type Person = { id: string; name: string; topics?: Partial<Record<SlackTopic, boolean>> };
const topicsOf = (t?: Partial<Record<SlackTopic, boolean>>) =>
  Object.fromEntries(SLACK_TOPICS.map((x) => [x.key, t?.[x.key] ?? x.on])) as Record<SlackTopic, boolean>;

async function peopleRecord() {
  const [meta, secrets] = await Promise.all([getIntegration<{ people?: Person[] }>("slack-dms"), getSecrets<Record<string, string>>("slack-dms")]);
  return { people: meta?.config.people ?? [], secrets: secrets ?? {} };
}

/** Teammates who get DMs, with what each hears about. URLs stay on the server. */
export async function slackPeople(): Promise<{ id: string; name: string; topics: Record<SlackTopic, boolean> }[]> {
  const { people, secrets } = await peopleRecord();
  return people.filter((p) => secrets[p.id]).map((p) => ({ id: p.id, name: p.name, topics: topicsOf(p.topics) }));
}

export async function addSlackPerson(p: { name: string; webhookUrl: string; topics: Record<SlackTopic, boolean> }): Promise<string> {
  const { people, secrets } = await peopleRecord();
  const id = randomUUID().slice(0, 8);
  await saveIntegration("slack-dms", {
    config: { people: [...people, { id, name: p.name, topics: p.topics }] },
    secrets: { ...secrets, [id]: p.webhookUrl },
    connected: true,
  });
  return id;
}

export async function removeSlackPerson(id: string) {
  const { people, secrets } = await peopleRecord();
  const rest = people.filter((p) => p.id !== id);
  const keep = Object.fromEntries(Object.entries(secrets).filter(([k]) => k !== id));
  await saveIntegration("slack-dms", { config: { people: rest }, secrets: keep, connected: rest.length > 0 });
}

export async function sendSlackPersonTest(id: string): Promise<{ ok: boolean; error?: string }> {
  const { people, secrets } = await peopleRecord();
  const p = people.find((x) => x.id === id);
  if (!p || !secrets[id]) return { ok: false, error: "That person isn't set up." };
  return deliver(secrets[id], `:wave: Hi ${esc(p.name)}, ${AGENT_NAME} will send your ${PRODUCT_NAME} updates here.`);
}

/** Escapes text for Slack's mrkdwn. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const link = (url: string, text: string) => `<${url}|${esc(text)}>`;
const quote = (s: string) =>
  esc(s.trim().slice(0, 600))
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

async function deliver(url: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `Slack answered ${res.status}: ${(await res.text()).slice(0, 120)}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Posts to the channel and to each teammate's DM that has this topic on. Never throws: a missed
 * Slack message shouldn't fail the work it reports on.
 */
async function send(topic: SlackTopic, text: string) {
  const [channel, { people, secrets }] = await Promise.all([slackAlerts(), peopleRecord()]);
  const targets = [
    ...(channel.url && channel.topics[topic] ? [{ who: "channel", url: channel.url }] : []),
    ...people.filter((p) => secrets[p.id] && topicsOf(p.topics)[topic]).map((p) => ({ who: p.name, url: secrets[p.id] })),
  ];
  await Promise.all(
    targets.map(async (t) => {
      const r = await deliver(t.url, text).catch((err) => ({ ok: false, error: String(err) }));
      if (!r.ok) console.warn(`[slack-alerts] ${topic} → ${t.who}: ${r.error}`);
    }),
  );
}

export async function sendSlackTest(): Promise<{ ok: boolean; error?: string }> {
  const s = await slackAlerts();
  if (!s.url) return { ok: false, error: "No channel is connected." };
  return deliver(s.url, `:wave: ${AGENT_NAME} is connected. ${PRODUCT_NAME} will post here.`);
}

/** A thread finished or failed (notify.ts calls this for every thread). */
export async function notifyThreadFinished(runId: number, outcome: { ok: boolean; summary: string; proposals?: number }) {
  const t = await get<{ kind: string; source_title: string; source_ref: string | null; source_url: string | null }>(
    "SELECT kind, source_title, source_ref, source_url FROM agent_runs WHERE id = $1",
    [runId],
  );
  if (!t) return;
  const thread = `${adminOrigin()}/admin/agent/${runId}`;
  const from =
    t.kind === "pr" && t.source_ref
      ? ` from ${t.source_url ? link(t.source_url, `${t.source_ref} ${t.source_title}`) : esc(t.source_ref)}`
      : `: ${esc(t.source_title)}`;
  if (!outcome.ok) {
    await send("failures", `:warning: *${AGENT_NAME} couldn't finish*${from}\n${quote(outcome.summary)}\n${link(thread, "Open the thread")}`);
  } else if (outcome.proposals) {
    const n = outcome.proposals;
    await send("drafts", `:memo: *${AGENT_NAME} drafted ${n} ${n === 1 ? "change" : "changes"}*${from}\n${quote(outcome.summary)}\n${link(thread, "Review the drafts")}`);
  }
}

export async function notifyPullRequestSkipped(p: { runId: number; ref: string; title: string; url: string; summary: string }) {
  await send(
    "skipped",
    `:white_check_mark: *No docs needed* for ${link(p.url, `${p.ref} ${p.title}`)}\n${quote(p.summary)}\n${link(`${adminOrigin()}/admin/agent/${p.runId}`, "Why")}`,
  );
}

/** Events (events.ts) that also go to Slack. */
export async function notifyEvent(event: EventName, data: Record<string, unknown>) {
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : "");
  switch (event) {
    case "article.published":
    case "article.updated": {
      const verb = event === "article.published" ? "Published" : "Updated";
      await send("published", `:books: *${verb}:* ${link(`${publicOrigin()}/help/${str("slug")}`, str("title") || "an article")}`);
      break;
    }
    case "conversation.escalation_requested":
      await send(
        "escalations",
        `:raising_hand: *A reader asked for a person*${data.widget ? " in the widget" : " in the help center"}\n${quote(str("question"))}\n${link(`${adminOrigin()}/admin/analytics`, "See conversations")}`,
      );
      break;
    case "contact.submitted":
      await send("contact", `:envelope: *Message from ${esc(str("name") || "a reader")}*${str("email") ? ` (${esc(str("email"))})` : ""}\n${quote(str("message"))}`);
      break;
  }
}
