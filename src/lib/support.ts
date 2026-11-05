import "server-only";
import { queueThread, startThread } from "./agent";
import { aiConfigured, generateJSON } from "./ai";
import { articleIndex } from "./articles";
import { all, get, run } from "./db";
import { getIntegration, saveIntegration } from "./integrations";
import { enqueue } from "./jobs";

// The Support Endpoint: a helpdesk sends conversations once they're resolved, and Docs Agent reads them
// for questions the help center doesn't answer (or answers wrongly). Each gap it finds becomes a
// Docs Agent thread drafting the fix, which a teammate reviews like any other draft.

export type SupportConfig = { autoDraft?: boolean };

export type SupportConversation = {
  id: number;
  external_id: string;
  source: string;
  subject: string;
  customer: string;
  resolved_at: string;
  received_at: string;
  reviewed_at: string | null;
  gap_topic: string | null;
  gap_reason: string | null;
  run_id: number | null;
};

const MAX_TRANSCRIPT = 12_000;

export async function supportConfig(): Promise<Required<SupportConfig>> {
  const c = (await getIntegration<SupportConfig>("support"))?.config ?? {};
  return { autoDraft: c.autoDraft ?? true };
}

export async function setAutoDraft(on: boolean) {
  await saveIntegration("support", { config: { autoDraft: on } });
}

type Message = { from?: string; role?: string; author?: string; text?: string; body?: string };

/** Turns the posted conversation into a plain transcript: "Customer: …" / "Support: …". */
export function transcriptOf(body: { transcript?: unknown; messages?: unknown }): string {
  if (typeof body.transcript === "string") return body.transcript.trim().slice(0, MAX_TRANSCRIPT);
  if (!Array.isArray(body.messages)) return "";
  return (body.messages as Message[])
    .map((m) => {
      const who = String(m.from ?? m.role ?? m.author ?? "").toLowerCase();
      const label = /agent|support|admin|staff|teammate|assistant|bot/.test(who) ? "Support" : "Customer";
      return `${label}: ${String(m.text ?? m.body ?? "").trim()}`;
    })
    .filter((l) => !l.endsWith(": "))
    .join("\n\n")
    .slice(0, MAX_TRANSCRIPT);
}

/** The same transcript from messages a helpdesk connection already sorted into customer and support. */
export function transcriptFromMessages(messages: { from: "customer" | "support"; text: string }[]): string {
  return messages
    .filter((m) => m.text.trim())
    .map((m) => `${m.from === "support" ? "Support" : "Customer"}: ${m.text.trim()}`)
    .join("\n\n")
    .slice(0, MAX_TRANSCRIPT);
}

/**
 * Stores (or updates) a conversation and schedules a review a minute later, so a burst is read
 * together. Sending the same conversation again only reads it again if the transcript changed.
 * Returns whether it was new or changed.
 */
export async function ingestConversation(c: { externalId: string; source: string; subject: string; customer: string; transcript: string; resolvedAt?: string }): Promise<boolean> {
  const before = await get<{ transcript: string }>("SELECT transcript FROM support_conversations WHERE external_id = $1", [c.externalId.slice(0, 200)]);
  await run(
    `INSERT INTO support_conversations (external_id, source, subject, customer, transcript, resolved_at)
     VALUES ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()))
     ON CONFLICT (external_id) DO UPDATE SET subject = excluded.subject, customer = excluded.customer, resolved_at = excluded.resolved_at,
       transcript = excluded.transcript,
       received_at = CASE WHEN support_conversations.transcript = excluded.transcript THEN support_conversations.received_at ELSE now() END,
       reviewed_at = CASE WHEN support_conversations.transcript = excluded.transcript THEN support_conversations.reviewed_at END,
       gap_topic = CASE WHEN support_conversations.transcript = excluded.transcript THEN support_conversations.gap_topic END,
       gap_reason = CASE WHEN support_conversations.transcript = excluded.transcript THEN support_conversations.gap_reason END`,
    [c.externalId.slice(0, 200), c.source.slice(0, 60), c.subject.slice(0, 300), c.customer.slice(0, 200), c.transcript, c.resolvedAt || null],
  );
  await saveIntegration("support", { connected: true });
  if (before?.transcript === c.transcript) return false;
  await enqueue("support", {}, { dedupeKey: "support-review", delaySeconds: 60 });
  return true;
}

/** Newest first; `source` narrows it to one helpdesk connection. */
export async function listConversations(limit = 20, source?: string): Promise<SupportConversation[]> {
  return all<SupportConversation>(
    `SELECT id, external_id, source, subject, customer, resolved_at, received_at, reviewed_at, gap_topic, gap_reason, run_id
     FROM support_conversations ${source ? "WHERE source = $2" : ""} ORDER BY received_at DESC LIMIT $1`,
    source ? [limit, source] : [limit],
  );
}

export async function supportStats(source?: string) {
  return (
    (await get<{ total: number; gaps: number; waiting: number }>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE gap_topic IS NOT NULL) AS gaps, count(*) FILTER (WHERE reviewed_at IS NULL) AS waiting
       FROM support_conversations ${source ? "WHERE source = $1" : ""}`,
      source ? [source] : [],
    )) ?? { total: 0, gaps: 0, waiting: 0 }
  );
}

type Review = { conversations: { id: number; gap: boolean; topic: string; reason: string }[] };

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["conversations"],
  properties: {
    conversations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "gap", "topic", "reason"],
        properties: {
          id: { type: "integer" },
          gap: { type: "boolean", description: "True when the help center should have answered this and doesn't, or answers it wrongly." },
          topic: { type: "string", description: "The missing or wrong topic in a few words, the same wording for conversations about the same thing. Empty when gap is false." },
          reason: { type: "string", description: "One sentence: what the customer needed and what the docs lack." },
        },
      },
    },
  },
};

/**
 * Reads unreviewed conversations (25 at a time) against the help center's article list, then
 * starts one Docs Agent thread per distinct gap. Runs as the "support" job.
 */
export async function reviewSupportConversations(): Promise<number> {
  if (!aiConfigured()) return 0;
  const batch = await all<{ id: number; subject: string; transcript: string }>(
    "SELECT id, subject, transcript FROM support_conversations WHERE reviewed_at IS NULL ORDER BY received_at LIMIT 25",
  );
  if (!batch.length) return 0;
  const index = await articleIndex();
  const review = await generateJSON<Review>({
    purpose: "classify",
    effort: "low",
    system: `You review resolved customer support conversations for a product's help center. For each conversation, decide whether it shows a documentation gap: the customer asked something the help center should answer but doesn't, or the help center says something that turned out wrong. Billing disputes, bugs, outages, account-specific requests, and things already covered by an article (check the titles) are not gaps. Use the same topic wording for conversations about the same thing.`,
    prompt: `<help_center_articles>
${index.filter((a) => a.status === "published").map((a) => `${a.id}: ${a.title}`).join("\n") || "(none)"}
</help_center_articles>

${batch.map((c) => `<conversation id="${c.id}">\n<subject>${c.subject}</subject>\n${c.transcript}\n</conversation>`).join("\n\n")}`,
    schema: REVIEW_SCHEMA,
  });

  const byId = new Map(review.conversations.map((r) => [r.id, r]));
  const gaps = new Map<string, { topic: string; reason: string; ids: number[] }>();
  for (const c of batch) {
    const r = byId.get(c.id);
    const topic = r?.gap ? r.topic.trim() : "";
    await run("UPDATE support_conversations SET reviewed_at = now(), gap_topic = $1, gap_reason = $2 WHERE id = $3", [topic || null, topic ? r!.reason : null, c.id]);
    if (topic) {
      const g = gaps.get(topic.toLowerCase()) ?? { topic, reason: r!.reason, ids: [] };
      g.ids.push(c.id);
      gaps.set(topic.toLowerCase(), g);
    }
  }

  const { autoDraft } = await supportConfig();
  let started = 0;
  for (const g of autoDraft ? gaps.values() : []) {
    // A gap already being drafted from earlier conversations takes these as well, instead of a second thread.
    const open = await get<{ run_id: number }>(
      `SELECT s.run_id FROM support_conversations s JOIN agent_runs r ON r.id = s.run_id
       WHERE lower(s.gap_topic) = lower($1) AND r.status IN ('running', 'done') AND s.received_at > now() - interval '14 days' LIMIT 1`,
      [g.topic],
    );
    if (open) {
      await run("UPDATE support_conversations SET run_id = $1 WHERE id = ANY($2::int[])", [open.run_id, g.ids]);
      continue;
    }
    const excerpts = await all<{ subject: string; transcript: string }>("SELECT subject, transcript FROM support_conversations WHERE id = ANY($1::int[]) LIMIT 3", [g.ids]);
    const id = await startThread({
      kind: "task",
      title: `Docs gap: ${g.topic}`.slice(0, 120),
      prompt: `Resolved support conversations show the help center doesn't cover this well: ${g.topic}.
${g.reason}

${excerpts.map((e, i) => `<support_conversation n="${i + 1}" subject="${e.subject.replace(/"/g, "'")}">\n${e.transcript.slice(0, 4000)}\n</support_conversation>`).join("\n\n")}

Write or update the help center so the next customer with this question finds the answer themselves. Use what support told the customer, but check it against the product before writing it down.`,
      ref: `${g.ids.length} support ${g.ids.length === 1 ? "conversation" : "conversations"}`,
    });
    await run("UPDATE support_conversations SET run_id = $1 WHERE id = ANY($2::int[])", [id, g.ids]);
    await queueThread(id);
    started++;
  }
  // More waiting than one batch holds: keep going.
  if ((await supportStats()).waiting > 0) await enqueue("support", {}, { dedupeKey: "support-review", delaySeconds: 5 });
  return started;
}
