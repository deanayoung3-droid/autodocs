import "server-only";
import crypto from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { all, get, run } from "./db";
import { getIntegration, getSecrets, saveIntegration } from "./integrations";

// The screenshot agent's mailbox. Some products sign in with a one-time code or a link sent
// by email, so the test account's email has to land somewhere the agent can read. Two ways in:
// - IMAP: the test account is a real mailbox (a Google Workspace user, say) read over IMAP.
// - Forwarding: any email service that can POST incoming mail to a URL (SendGrid Inbound Parse,
//   Mailgun routes, Postmark, a Cloudflare Email Worker) sends it to /api/inbox/<key>.
// Either way messages are kept in inbox_messages, which "Browse received emails" shows.

export type ImapSettings = { host: string; port: number; user: string; mailbox: string };
type InboxSecrets = { imapPassword?: string; webhookKey?: string };
type InboxConfig = { imap?: Partial<ImapSettings> };

export type InboxMessage = {
  id: number;
  to_address: string;
  from_address: string;
  subject: string;
  text_body: string;
  html_body: string;
  received_at: string;
};

async function settings(): Promise<{ imap: ImapSettings | null; secrets: InboxSecrets }> {
  const [meta, secrets] = await Promise.all([getIntegration<InboxConfig>("inbox"), getSecrets<InboxSecrets>("inbox")]);
  const imap = meta?.config.imap;
  const complete = imap?.host && imap.user && secrets?.imapPassword;
  return { imap: complete ? { host: imap.host!, port: imap.port || 993, user: imap.user!, mailbox: imap.mailbox || "INBOX" } : null, secrets: secrets ?? {} };
}

/** What the Dashboard page shows about the mailbox. */
export async function inboxStatus() {
  const s = await settings();
  const last = await get<{ received_at: string }>("SELECT received_at FROM inbox_messages ORDER BY received_at DESC LIMIT 1");
  return { imap: s.imap, forwardingKey: s.secrets.webhookKey ?? null, lastReceived: last?.received_at ?? null };
}

/** True when the agent has somewhere to read sign-in emails from. */
export async function inboxReady(): Promise<boolean> {
  const s = await settings();
  return Boolean(s.imap || s.secrets.webhookKey);
}

export async function saveImapSettings(imap: ImapSettings, password: string) {
  const { secrets } = await settings();
  await saveIntegration("inbox", { config: { imap }, secrets: { ...secrets, imapPassword: password || secrets.imapPassword } });
}

export async function removeImapSettings() {
  const { secrets } = await settings();
  await saveIntegration("inbox", { config: { imap: {} }, secrets: { webhookKey: secrets.webhookKey } });
}

/** Turns on forwarding, or replaces its key (the old address stops working). */
export async function rotateForwardingKey(): Promise<string> {
  const { secrets } = await settings();
  const key = crypto.randomBytes(18).toString("base64url");
  await saveIntegration("inbox", { secrets: { ...secrets, webhookKey: key } });
  return key;
}

export async function stopForwarding() {
  const { secrets } = await settings();
  await saveIntegration("inbox", { secrets: { imapPassword: secrets.imapPassword } });
}

export async function forwardingKeyMatches(key: string): Promise<boolean> {
  const { secrets } = await settings();
  if (!secrets.webhookKey) return false;
  const a = Buffer.from(secrets.webhookKey);
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function receiveEmail(m: { messageId?: string | null; to: string; from: string; subject: string; text: string; html: string; receivedAt?: Date }) {
  await run(
    `INSERT INTO inbox_messages (message_id, to_address, from_address, subject, text_body, html_body, received_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (message_id) DO NOTHING`,
    [m.messageId || null, m.to.slice(0, 500), m.from.slice(0, 500), m.subject.slice(0, 500), m.text.slice(0, 200_000), m.html.slice(0, 500_000), m.receivedAt ?? new Date()],
  );
  // Sign-in codes are only useful for minutes; keep two weeks for "Browse received emails".
  await run("DELETE FROM inbox_messages WHERE received_at < now() - interval '14 days'");
}

const addressText = (a: ParsedMail["to"] | ParsedMail["from"]) => (Array.isArray(a) ? a.map((x) => x.text).join(", ") : (a?.text ?? ""));

/** Stores a raw MIME message (from IMAP). */
export async function receiveRaw(source: Buffer | string, receivedAt?: Date) {
  const m = await fromMime(source);
  await receiveEmail({ ...m, receivedAt: receivedAt ?? m.receivedAt });
}

export type InboundEmail = { messageId: string | null; to: string; from: string; subject: string; text: string; html: string; receivedAt?: Date };

const str = (v: unknown) => (typeof v === "string" ? v : "");

async function fromMime(source: Buffer | string): Promise<InboundEmail> {
  const m = await simpleParser(source);
  return {
    messageId: m.messageId ?? null,
    to: addressText(m.to),
    from: addressText(m.from),
    subject: m.subject ?? "",
    text: m.text ?? "",
    html: typeof m.html === "string" ? m.html : "",
    receivedAt: m.date,
  };
}

/**
 * Reads an email forwarded by an email service, in whichever common shape it arrives: Postmark or
 * plain JSON, SendGrid Inbound Parse and Mailgun form posts (parsed or raw MIME), or raw MIME.
 */
export async function readInbound(req: Request): Promise<InboundEmail | null> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const b = (await req.json()) as Record<string, unknown>;
    if (typeof b.raw === "string") return fromMime(Buffer.from(b.raw, b.encoding === "base64" ? "base64" : "utf8"));
    return {
      messageId: str(b.MessageID) || str(b.messageId) || str(b.message_id) || null,
      to: str(b.To) || str(b.to),
      from: str(b.From) || str(b.from),
      subject: str(b.Subject) || str(b.subject),
      text: str(b.TextBody) || str(b.text),
      html: str(b.HtmlBody) || str(b.html),
    };
  }
  if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
    const f = await req.formData();
    const field = (...names: string[]) => names.map((n) => f.get(n)).find((v) => typeof v === "string" && v) as string | undefined;
    const raw = field("email", "body-mime");
    if (raw) return fromMime(raw);
    return {
      messageId: field("Message-Id", "message-id") ?? null,
      to: field("to", "recipient") ?? "",
      from: field("from", "sender") ?? "",
      subject: field("subject") ?? "",
      text: field("text", "body-plain", "stripped-text") ?? "",
      html: field("html", "body-html") ?? "",
    };
  }
  const raw = Buffer.from(await req.arrayBuffer());
  return raw.length ? fromMime(raw) : null;
}

/** The bare address in "Dana <dana@example.com>". */
export function emailAddress(from: string): string {
  return (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
}

/** The new part of an email: drops quoted replies and signatures. */
export function newPartOfEmail(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const end = lines.findIndex((l) => /^On .+wrote:\s*$/.test(l.trim()) || /^-{2,}\s*$/.test(l.trim()) || /^>/.test(l) || /^From: /.test(l));
  return (end >= 0 ? lines.slice(0, end) : lines).join("\n").trim().slice(0, 20_000);
}

function imapClient(imap: ImapSettings, password: string) {
  return new ImapFlow({ host: imap.host, port: imap.port, secure: imap.port !== 143, auth: { user: imap.user, pass: password }, logger: false });
}

/** Connects with the given settings and reports how many messages the mailbox holds. */
export async function testImap(imap: ImapSettings, password?: string): Promise<number> {
  const pass = password || (await settings()).secrets.imapPassword;
  if (!pass) throw new Error("Enter the mailbox password.");
  const client = imapClient(imap, pass);
  await client.connect();
  try {
    const box = await client.mailboxOpen(imap.mailbox || "INBOX", { readOnly: true });
    return box.exists;
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/** Copies messages that arrived since `since` from the IMAP mailbox into the inbox. */
export async function pollImap(since: Date): Promise<number> {
  const { imap, secrets } = await settings();
  if (!imap || !secrets.imapPassword) return 0;
  const client = imapClient(imap, secrets.imapPassword);
  await client.connect();
  let count = 0;
  try {
    await client.mailboxOpen(imap.mailbox, { readOnly: true });
    // IMAP's SINCE is day-granular, so filter precisely on the arrival time.
    const uids = (await client.search({ since: new Date(since.getTime() - 24 * 3600_000) }, { uid: true })) || [];
    if (uids.length) {
      for await (const msg of client.fetch(uids.slice(-20), { source: true, internalDate: true }, { uid: true })) {
        const at = msg.internalDate ? new Date(msg.internalDate) : new Date();
        if (at < since || !msg.source) continue;
        await receiveRaw(msg.source, at);
        count++;
      }
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return count;
}

export async function listEmails(limit = 25): Promise<InboxMessage[]> {
  return all<InboxMessage>(
    "SELECT id, to_address, from_address, subject, left(text_body, 4000) AS text_body, '' AS html_body, received_at FROM inbox_messages ORDER BY received_at DESC LIMIT $1",
    [limit],
  );
}

/* Reading a sign-in email */

const CODE_WORDS = /(code|passcode|pass code|one[- ]time|verification|verify|otp|pin|security|login|sign[- ]?in)/i;

function plainText(m: Pick<InboxMessage, "text_body" | "html_body">): string {
  if (m.text_body.trim()) return m.text_body;
  return m.html_body
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|h\d|li)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** The one-time code in a sign-in email: digits (4–8, maybe split "123 456") or a short letters-and-digits code. */
export function findCode(m: Pick<InboxMessage, "subject" | "text_body" | "html_body">): string | null {
  const text = `${m.subject}\n${plainText(m)}`;
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  // A line that is only the code, the usual layout.
  for (const l of lines) {
    const digits = l.match(/^(\d{3}[ -]?\d{3}|\d{4,8})$/);
    if (digits) return digits[1].replace(/[ -]/g, "");
  }
  // A code right after a word like "code" or "verification".
  const near = text.match(new RegExp(`${CODE_WORDS.source}[^\\n\\d]{0,60}?\\b(\\d{3}[ -]?\\d{3}|\\d{4,8})\\b`, "i"));
  if (near) return near[2].replace(/[ -]/g, "");
  for (const l of lines) {
    const alnum = l.match(/^([A-Z0-9]{3,4}-?[A-Z0-9]{3,4})$/);
    if (alnum && /\d/.test(alnum[1]) && /[A-Z]/.test(alnum[1])) return alnum[1];
  }
  return null;
}

/** The sign-in link in an email (a "magic link"), never an unsubscribe or preferences link. */
export function findLink(m: Pick<InboxMessage, "text_body" | "html_body">): string | null {
  const hrefs = [...m.html_body.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((x) => x[1].replace(/&amp;/g, "&"));
  const bare = [...m.text_body.matchAll(/https:\/\/[^\s<>"')]+/g)].map((x) => x[0]);
  const links = [...hrefs, ...bare].filter((u) => u.startsWith("https://") && !/unsubscribe|preferences|privacy|terms|help|support/i.test(u));
  return links.find((u) => /(sign|log)[-_]?in|magic|verify|confirm|auth|token|session|callback/i.test(u)) ?? null;
}

/**
 * Waits for a sign-in email that arrived after `since` and has a code (or a link, when asked).
 * Polls the IMAP mailbox if one is set up; forwarded mail arrives on its own.
 */
export async function waitForSignInEmail(since: Date, want: "code" | "link", timeoutMs = 90_000): Promise<{ code: string | null; link: string | null; subject: string }> {
  const after = new Date(since.getTime() - 15_000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await pollImap(after).catch((err) => console.warn(`[inbox] IMAP: ${err instanceof Error ? err.message : err}`));
    const recent = await all<InboxMessage>(
      "SELECT id, to_address, from_address, subject, text_body, html_body, received_at FROM inbox_messages WHERE received_at >= $1 ORDER BY received_at DESC LIMIT 5",
      [after],
    );
    for (const m of recent) {
      const code = findCode(m);
      const link = findLink(m);
      if ((want === "code" && code) || (want === "link" && link)) return { code, link, subject: m.subject };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`No sign-in email with a ${want} arrived within ${Math.round(timeoutMs / 1000)} seconds. Check the login email on the Dashboard page.`);
}
