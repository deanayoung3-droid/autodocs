import "server-only";
import { AI_SETUP_HINT, aiConfigured } from "./ai";
import { getArticle, listArticles } from "./articles";
import { all, get, run } from "./db";
import { researchRepos } from "./github";
import { enqueue } from "./jobs";
import { addProposal, addStep, createThread, failThread, finishThread, rejectProposal, threadProposals } from "./proposals";
import { research } from "./research";

export type VerificationStatus = "queued" | "checking" | "needs_review" | "up_to_date" | "cant_verify";
export type Issue = { claim: string; problem: string; evidence: string };

export type VerificationRow = {
  article_id: number;
  title: string;
  collection_name: string | null;
  status: VerificationStatus | null;
  summary: string | null;
  issues_json: string | null;
  run_id: number | null;
  checked_at: string | null;
};

type VerifyResult = {
  verdict: "accurate" | "inaccurate" | "unverifiable";
  summary: string;
  issues: Issue[];
  fixed_body_markdown: string;
  outdated_quote: string;
};

const SUBMIT = {
  name: "submit_verification",
  description: "Submit your verdict on the article. Call once, at the end.",
  input_schema: {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: ["accurate", "inaccurate", "unverifiable"],
        description: "unverifiable when the claims can't be checked against the code you can read.",
      },
      summary: { type: "string", description: "One or two sentences on the article's accuracy." },
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            claim: { type: "string", description: "What the article says." },
            problem: { type: "string", description: "What's actually true." },
            evidence: { type: "string", description: "File path or other source that shows it." },
          },
          required: ["claim", "problem", "evidence"],
          additionalProperties: false,
        },
      },
      fixed_body_markdown: {
        type: "string",
        description: "When inaccurate: the complete corrected article body. Otherwise empty.",
      },
      outdated_quote: { type: "string", description: "When inaccurate: the first wrong sentence, exactly as written." },
    },
    required: ["verdict", "summary", "issues", "fixed_body_markdown", "outdated_quote"],
    additionalProperties: false,
  },
};

export function issuesOf(row: { issues_json: string | null }): Issue[] {
  try {
    return JSON.parse(row.issues_json ?? "[]");
  } catch {
    return [];
  }
}

const ROW_SELECT = `SELECT a.id AS article_id, a.title, c.name AS collection_name, v.status, v.summary, v.issues_json, v.run_id, v.checked_at`;

/** Every published article with its latest verification state. */
export async function verificationRows(): Promise<VerificationRow[]> {
  return all<VerificationRow>(
    `${ROW_SELECT}
     FROM articles a
     LEFT JOIN collections c ON c.id = a.collection_id
     LEFT JOIN verifications v ON v.article_id = a.id
     WHERE a.status = 'published' AND a.deleted_at IS NULL
     ORDER BY c.position, c.name, a.title`,
  );
}

export async function recentVerifications(limit = 30): Promise<VerificationRow[]> {
  return all<VerificationRow>(
    `${ROW_SELECT}
     FROM verifications v JOIN articles a ON a.id = v.article_id LEFT JOIN collections c ON c.id = a.collection_id
     WHERE v.checked_at IS NOT NULL ORDER BY v.checked_at DESC LIMIT $1`,
    [limit],
  );
}

export async function getVerification(articleId: number) {
  return get<{ status: VerificationStatus; summary: string | null; issues_json: string | null; run_id: number | null; checked_at: string | null }>(
    "SELECT status, summary, issues_json, run_id, checked_at FROM verifications WHERE article_id = $1",
    [articleId],
  );
}

/** Queues articles for checking. Workers take them one job at a time. */
export async function queueVerification(ids: number[] | "all"): Promise<number> {
  const targets = ids === "all" ? (await listArticles({ status: "published" })).map((a) => a.id) : ids;
  for (const id of targets) {
    await run(
      `INSERT INTO verifications (article_id, status, queued_at) VALUES ($1, 'queued', now())
       ON CONFLICT (article_id) DO UPDATE SET status = 'queued', queued_at = now()
       WHERE verifications.status != 'checking'`,
      [id],
    );
    await enqueue("verify", { articleId: id }, { dedupeKey: `verify:${id}`, maxAttempts: 2 });
  }
  return targets.length;
}

/** The published article checked longest ago (or never). For continuous verification. */
export async function stalestArticle(): Promise<number | null> {
  const row = await get<{ id: number }>(
    `SELECT a.id FROM articles a LEFT JOIN verifications v ON v.article_id = a.id
     WHERE a.status = 'published' AND a.deleted_at IS NULL AND coalesce(v.status, '') NOT IN ('queued', 'checking', 'needs_review')
     AND (v.checked_at IS NULL OR v.checked_at < now() - interval '7 days')
     ORDER BY v.checked_at IS NOT NULL, v.checked_at LIMIT 1`,
  );
  return row?.id ?? null;
}

export async function needsReviewCount(): Promise<number> {
  return (
    (await get<{ n: number }>(
      `SELECT count(*) AS n FROM verifications v JOIN articles a ON a.id = v.article_id
       WHERE v.status = 'needs_review' AND a.deleted_at IS NULL`,
    ))?.n ?? 0
  );
}

export async function checksInLastDay(): Promise<number> {
  return (await get<{ n: number }>("SELECT count(*) AS n FROM verifications WHERE checked_at >= now() - interval '1 day'"))?.n ?? 0;
}

async function setResult(articleId: number, status: VerificationStatus, summary: string, issues: Issue[], runId: number | null) {
  await run(
    `INSERT INTO verifications (article_id, status, summary, issues_json, run_id, checked_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (article_id) DO UPDATE SET status = excluded.status, summary = excluded.summary,
       issues_json = excluded.issues_json, run_id = excluded.run_id, checked_at = excluded.checked_at`,
    [articleId, status, summary, JSON.stringify(issues), runId],
  );
}

/** Checks one article against the codebase. Inaccurate articles get a fix proposal in Review. */
export async function verifyArticle(articleId: number): Promise<void> {
  const article = await getArticle(articleId);
  if (!article || article.deleted_at) {
    await run("DELETE FROM verifications WHERE article_id = $1", [articleId]);
    return;
  }
  const repos = await researchRepos();
  if (!repos.length || !aiConfigured()) {
    await setResult(
      articleId,
      "cant_verify",
      !aiConfigured() ? AI_SETUP_HINT : "Connect GitHub in Integrations so articles can be checked against the code.",
      [],
      null,
    );
    return;
  }
  await run("UPDATE verifications SET status = 'checking' WHERE article_id = $1", [articleId]);

  // Research steps go on a thread so the work is visible; it's kept only if there's something to fix.
  const runId = await createThread({ kind: "verify", title: `Fix “${article.title}”`, ref: null });
  try {
    const out = await research<VerifyResult>({
      purpose: "verify",
      system: `You check one help center article against the product's source code. For each concrete claim (labels, steps, settings, limits, permissions, behavior), look for evidence in the code. Report only claims that are actually wrong or missing something important; don't nitpick style. If the code you can read doesn't cover what the article describes, the verdict is unverifiable. When the article is inaccurate, return the complete corrected body, changing only what's wrong.`,
      prompt: `<article id="${article.id}" title="${article.title.replace(/"/g, "'")}">\n${article.body}\n</article>`,
      final: SUBMIT,
      effort: "medium",
      maxTurns: 12,
      onStep: (label) => addStep(runId, label),
    });

    if (out.verdict === "inaccurate" && out.fixed_body_markdown.trim()) {
      await addProposal({
        runId,
        action: "update",
        articleId: article.id,
        collectionId: article.collection_id,
        title: article.title,
        summary: article.summary,
        body: out.fixed_body_markdown.trim(),
        baseBody: article.body,
        reason: out.summary,
        outdatedQuote: out.outdated_quote,
      });
      await finishThread(runId, {
        summary: out.summary,
        confidence: "medium",
        changes: out.issues.map((i) => ({ type: "fixed" as const, text: i.problem })),
      });
      await setResult(articleId, "needs_review", out.summary, out.issues, runId);
    } else {
      await run("DELETE FROM agent_runs WHERE id = $1", [runId]);
      await setResult(articleId, out.verdict === "accurate" ? "up_to_date" : "cant_verify", out.summary, [], null);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failThread(runId, message);
    await setResult(articleId, "cant_verify", `Check failed: ${message}`, [], runId);
  }
}

/** "Not an issue": accept the article as written and close its fix. */
export async function markNotAnIssue(articleId: number) {
  const row = await get<{ run_id: number | null }>("SELECT run_id FROM verifications WHERE article_id = $1", [articleId]);
  if (row?.run_id) {
    for (const p of await threadProposals(row.run_id)) if (p.status === "pending") await rejectProposal(p.id);
  }
  await setResult(articleId, "up_to_date", "Marked as accurate by a teammate.", [], row?.run_id ?? null);
}

/**
 * Work that a stopped instance left half-done: threads no job will finish are marked failed, and
 * checks stuck mid-way go back in the queue.
 */
export async function recoverInterrupted() {
  await run(
    `UPDATE agent_runs SET status = 'failed', error = 'Interrupted by a server restart. Try again.', finished_at = now()
     WHERE status = 'running' AND created_at < now() - interval '2 minutes'
       AND (kind <> 'verify' OR created_at < now() - interval '20 minutes')
       AND NOT EXISTS (
         SELECT 1 FROM jobs j WHERE j.kind = 'agent' AND j.status IN ('queued', 'running')
           AND (j.payload->>'runId')::int = agent_runs.id)`,
  );
  const stuck = await all<{ article_id: number }>(
    `UPDATE verifications SET status = 'queued' WHERE status = 'checking'
       AND NOT EXISTS (
         SELECT 1 FROM jobs j WHERE j.kind = 'verify' AND j.status = 'running'
           AND (j.payload->>'articleId')::int = verifications.article_id)
     RETURNING article_id`,
  );
  // Queued checks that lost their job (say, the queue was cleared) get one again.
  const orphaned = await all<{ article_id: number }>(
    `SELECT v.article_id FROM verifications v WHERE v.status = 'queued'
       AND NOT EXISTS (
         SELECT 1 FROM jobs j WHERE j.kind = 'verify' AND j.status IN ('queued', 'running')
           AND (j.payload->>'articleId')::int = v.article_id)`,
  );
  for (const { article_id } of [...stuck, ...orphaned]) {
    await enqueue("verify", { articleId: article_id }, { dedupeKey: `verify:${article_id}`, maxAttempts: 2 });
  }
}
