import "server-only";
import { all, get, insert, run, tx } from "./db";
import { createArticle, getArticle, updateArticle } from "./articles";
import { emit } from "./events";

export type ThreadKind = "pr" | "diff" | "notes" | "task" | "audit" | "verify" | "bulk";
export type ThreadStatus = "running" | "done" | "failed" | "dismissed";
export type Change = { type: "added" | "changed" | "fixed" | "removed"; text: string };

export type Thread = {
  id: number;
  kind: ThreadKind;
  source_ref: string | null;
  source_title: string;
  source_url: string | null;
  source_author: string | null;
  prompt: string | null;
  status: ThreadStatus;
  summary: string | null;
  confidence: "high" | "medium" | "low" | null;
  changes_json: string | null;
  /** How Docs Agent sorted a merged pull request (pr-intake.ts TriageRecord), when it did. */
  triage_json: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  dismissed_at: string | null;
  proposal_count: number;
  pending_count: number;
};

export type ProposalStatus = "pending" | "approved" | "rejected" | "superseded";

export type Proposal = {
  id: number;
  run_id: number;
  action: "create" | "update";
  article_id: number | null;
  collection_id: number | null;
  title: string;
  summary: string;
  body: string;
  base_body: string | null;
  reason: string;
  outdated_quote: string | null;
  status: ProposalStatus;
  created_at: string;
  decided_at: string | null;
};

export type ProposalRow = Proposal & {
  run_kind: ThreadKind;
  run_ref: string | null;
  run_title: string;
  run_url: string | null;
  article_title: string | null;
};

const THREAD_SELECT = `SELECT r.*,
  (SELECT count(*) FROM proposals p WHERE p.run_id = r.id AND p.status != 'superseded') AS proposal_count,
  (SELECT count(*) FROM proposals p WHERE p.run_id = r.id AND p.status = 'pending') AS pending_count
  FROM agent_runs r`;

export async function createThread(t: {
  kind: ThreadKind;
  title: string;
  ref?: string | null;
  url?: string | null;
  author?: string | null;
  prompt?: string | null;
  status?: ThreadStatus;
  /** The teammate who asked, so they hear when it's done. */
  startedBy?: number | null;
}): Promise<number> {
  return insert(
    `INSERT INTO agent_runs (kind, source_title, source_ref, source_url, source_author, prompt, status, started_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [t.kind, t.title.slice(0, 200) || "Untitled task", t.ref ?? null, t.url ?? null, t.author ?? null, t.prompt ?? null, t.status ?? "running", t.startedBy ?? null],
  );
}

export async function setThreadTriage(id: number, triage: unknown) {
  await run("UPDATE agent_runs SET triage_json = $1 WHERE id = $2", [JSON.stringify(triage), id]);
}

export async function setThreadRunning(id: number) {
  await run("UPDATE agent_runs SET status = 'running', error = NULL, finished_at = NULL WHERE id = $1", [id]);
}

export async function renameThread(id: number, title: string) {
  if (title.trim()) await run("UPDATE agent_runs SET source_title = $1 WHERE id = $2", [title.trim().slice(0, 200), id]);
}

export async function finishThread(id: number, r: { summary: string; confidence?: string | null; changes?: Change[] }) {
  await run(
    `UPDATE agent_runs SET status = 'done', summary = $1, confidence = $2, changes_json = $3, finished_at = now()
     WHERE id = $4`,
    [r.summary, r.confidence ?? null, JSON.stringify(r.changes ?? []), id],
  );
}

export async function failThread(id: number, error: string) {
  await run("UPDATE agent_runs SET status = 'failed', error = $1, finished_at = now() WHERE id = $2", [error, id]);
}

/** "Not relevant": closes the thread and rejects whatever it proposed. */
export async function dismissThread(id: number) {
  await tx(async () => {
    await run("UPDATE agent_runs SET status = 'dismissed', dismissed_at = now() WHERE id = $1", [id]);
    await run("UPDATE proposals SET status = 'rejected', decided_at = now() WHERE run_id = $1 AND status = 'pending'", [id]);
  });
}

export async function listThreads(opts: { q?: string; limit?: number } = {}): Promise<Thread[]> {
  const q = opts.q?.trim();
  return q
    ? await all<Thread>(
        `${THREAD_SELECT} WHERE r.source_title ILIKE $1 OR r.prompt ILIKE $1 OR r.source_ref ILIKE $1
         ORDER BY r.id DESC LIMIT $2`,
        [`%${q.replace(/[\\%_]/g, "\\$&")}%`, opts.limit ?? 100],
      )
    : await all<Thread>(`${THREAD_SELECT} ORDER BY r.id DESC LIMIT $1`, [opts.limit ?? 100]);
}

export async function getThread(id: number): Promise<Thread | undefined> {
  if (!Number.isInteger(id)) return undefined;
  return get<Thread>(`${THREAD_SELECT} WHERE r.id = $1`, [id]);
}

export function threadChanges(t: Thread): Change[] {
  try {
    return JSON.parse(t.changes_json ?? "[]");
  } catch {
    return [];
  }
}

export async function addMessage(runId: number, role: "user" | "agent", content: string) {
  await run("INSERT INTO thread_messages (run_id, role, content) VALUES ($1, $2, $3)", [runId, role, content]);
}

export async function listMessages(runId: number): Promise<{ id: number; role: "user" | "agent"; content: string; created_at: string }[]> {
  return all("SELECT id, role, content, created_at FROM thread_messages WHERE run_id = $1 ORDER BY id", [runId]);
}

export async function addStep(runId: number, label: string) {
  await run("INSERT INTO agent_steps (run_id, label) VALUES ($1, $2)", [runId, label.slice(0, 300)]);
}

export async function listSteps(runId: number): Promise<{ id: number; label: string; created_at: string }[]> {
  return all("SELECT id, label, created_at FROM agent_steps WHERE run_id = $1 ORDER BY id", [runId]);
}

export async function addProposal(p: {
  runId: number;
  action: "create" | "update";
  articleId: number | null;
  collectionId: number | null;
  title: string;
  summary: string;
  body: string;
  baseBody: string | null;
  reason: string;
  outdatedQuote?: string | null;
}): Promise<number> {
  const id = await insert(
    `INSERT INTO proposals (run_id, action, article_id, collection_id, title, summary, body, base_body, reason, outdated_quote)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [p.runId, p.action, p.articleId, p.collectionId, p.title, p.summary, p.body, p.baseBody, p.reason, p.outdatedQuote || null],
  );
  emit("proposal.created", { id, run_id: p.runId, action: p.action, article_id: p.articleId, title: p.title });
  return id;
}

/** A revision replaces the thread's open proposals. */
export async function supersedePending(runId: number) {
  await run("UPDATE proposals SET status = 'superseded' WHERE run_id = $1 AND status = 'pending'", [runId]);
}

const ROW_SELECT = `SELECT p.*, r.kind AS run_kind, r.source_ref AS run_ref, r.source_title AS run_title,
  r.source_url AS run_url, a.title AS article_title
  FROM proposals p
  JOIN agent_runs r ON r.id = p.run_id
  LEFT JOIN articles a ON a.id = p.article_id`;

export async function pendingProposals(): Promise<ProposalRow[]> {
  return all<ProposalRow>(`${ROW_SELECT} WHERE p.status = 'pending' ORDER BY p.run_id DESC, p.id`);
}

export async function threadProposals(runId: number): Promise<ProposalRow[]> {
  return all<ProposalRow>(`${ROW_SELECT} WHERE p.run_id = $1 AND p.status != 'superseded' ORDER BY p.id`, [runId]);
}

export async function pendingCount(): Promise<number> {
  return (await get<{ n: number }>("SELECT count(*) AS n FROM proposals WHERE status = 'pending'"))?.n ?? 0;
}

export async function getProposal(id: number): Promise<ProposalRow | undefined> {
  if (!Number.isInteger(id)) return undefined;
  return get<ProposalRow>(`${ROW_SELECT} WHERE p.id = $1`, [id]);
}

/** Applies a proposal (with any edits made during review). Returns the article id. */
export async function approveProposal(
  id: number,
  edits: { title: string; summary: string; body: string; collectionId: number | null },
): Promise<number> {
  const { articleId, updated } = await tx(async () => {
    // Lock the proposal so two reviewers approving at once can't both apply it.
    const locked = await get<{ status: string }>("SELECT status FROM proposals WHERE id = $1 FOR UPDATE", [id]);
    const p = await getProposal(id);
    if (!p || !locked || locked.status !== "pending") throw new Error("This proposal was already handled.");
    let articleId: number;
    const note = `Docs Agent: ${p.run_title}`;
    const existing = p.action === "update" && p.article_id ? await getArticle(p.article_id) : undefined;
    if (existing && !existing.deleted_at) {
      await updateArticle(
        existing.id,
        { title: edits.title, summary: edits.summary, body: edits.body, collectionId: existing.collection_id },
        "agent",
        note,
      );
      articleId = existing.id;
    } else {
      // A new article, or an update whose article was deleted after the proposal was made.
      articleId = await createArticle(
        { title: edits.title, summary: edits.summary, body: edits.body, collectionId: edits.collectionId },
        "published",
        "agent",
        note,
      );
    }
    await run("UPDATE proposals SET status = 'approved', decided_at = now() WHERE id = $1", [id]);
    // Publishing the fix that verification proposed resolves the article's flag.
    await run(
      `UPDATE verifications SET status = 'up_to_date', summary = 'Fix published from review.', checked_at = now()
       WHERE article_id = $1 AND status = 'needs_review' AND run_id = $2`,
      [articleId, p.run_id],
    );
    return { articleId, updated: Boolean(existing && !existing.deleted_at) };
  });
  const published = await getArticle(articleId);
  if (published) emit(updated ? "article.updated" : "article.published", { id: published.id, slug: published.slug, title: published.title });
  return articleId;
}

/** Approves every open proposal in a thread exactly as proposed. Returns how many were applied. */
export async function approveAllInThread(runId: number): Promise<number> {
  const open = (await threadProposals(runId)).filter((p) => p.status === "pending");
  await tx(async () => {
    for (const p of open) {
      await approveProposal(p.id, { title: p.title, summary: p.summary, body: p.body, collectionId: p.collection_id });
    }
  });
  return open.length;
}

export async function rejectProposal(id: number) {
  await run("UPDATE proposals SET status = 'rejected', decided_at = now() WHERE id = $1 AND status = 'pending'", [id]);
}
