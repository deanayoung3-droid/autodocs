import "server-only";
import { runThread, startThread } from "./agent";
import { aiConfigured } from "./ai";
import { getInsights } from "./analytics";
import { listArticles, purgeExpiredArticles } from "./articles";
import { acquireLease, all, get } from "./db";
import { parseSqlDate } from "./format";
import { listMergedPullRequests, researchRepos } from "./github";
import { helpdesksDue } from "./helpdesks";
import { enqueue, startWorker } from "./jobs";
import { getSettings, updateSettings } from "./settings";
import { staleTranslations } from "./translations";
import { checksInLastDay, queueVerification, recoverInterrupted, stalestArticle } from "./verification";

const AUDIT_DAYS = { weekly: 7, biweekly: 14, monthly: 30 } as const;

declare global {
  var __autodocsScheduler: NodeJS.Timeout | undefined;
}

/** Starts this instance's job worker and the once-a-minute planner. Safe to call more than once. */
export function startScheduler() {
  if (globalThis.__autodocsScheduler) return;
  startWorker();
  globalThis.__autodocsScheduler = setInterval(() => void tick(), 60_000);
  setTimeout(() => void tick(), 10_000);
}

/**
 * Decides what background work is due and queues it. Only the instance holding the lease plans;
 * every instance's worker then shares the jobs.
 */
export async function tick() {
  try {
    if (!(await acquireLease("scheduler", 55))) return;
    await purgeExpiredArticles();
    await recoverInterrupted();
    await seedOnFirstStart();
    if (!aiConfigured()) return;

    const s = await getSettings();
    if (auditDue(s.auditFrequency, s.lastAuditAt)) {
      await updateSettings({ lastAuditAt: new Date().toISOString() });
      await enqueue("audit", { since: s.lastAuditAt }, { dedupeKey: "audit", maxAttempts: 1 });
    }
    // Merged pull requests the webhook missed are caught up every 30 minutes.
    if (s.autoScreenPRs && (await acquireLease("pr-sweep", 30 * 60))) {
      await enqueue("pr-sweep", {}, { dedupeKey: "pr-sweep", maxAttempts: 1 });
    }
    // Helpdesks are read every 15 minutes for newly resolved conversations.
    for (const id of await helpdesksDue()) await enqueue("helpdesk", { id }, { dedupeKey: `helpdesk:${id}` });
    for (const t of await staleTranslations(10)) {
      await enqueue("translate", t, { dedupeKey: `translate:${t.articleId}:${t.lang}` });
    }
    if (await acquireLease("classify-themes", 60 * 60)) {
      await enqueue("classify", {}, { dedupeKey: "classify", maxAttempts: 1 });
    }
    if (s.continuousVerification && (await checksInLastDay()) < s.verifyPerDay) {
      const next = await stalestArticle();
      if (next) await queueVerification([next]);
    }
    // Articles that never got their search sections (say, imported before a key was added).
    const unindexed = await all<{ id: number }>(
      `SELECT a.id FROM articles a WHERE a.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM article_chunks c WHERE c.article_id = a.id AND c.embedding IS NOT NULL)
       ORDER BY a.id LIMIT 50`,
    );
    for (const { id } of unindexed) await enqueue("embed", { articleId: id }, { dedupeKey: `embed:${id}` });
  } catch (err) {
    console.error("[scheduler]", err);
  }
}

const hostOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).host.toLowerCase() : "";
  } catch {
    return "";
  }
};

/**
 * A new install fills itself from the help center it replaces (SEED_IMPORT_URL, which
 * deploy/gcp/setup.sh sets to the public domain): articles, sections, images, and redirects from the
 * old addresses. Once, only into an empty help center, and never from its own address (after the
 * switch-over, the public domain is this server).
 */
async function seedOnFirstStart() {
  const from = process.env.SEED_IMPORT_URL;
  if (!from || (await getSettings()).seededFrom) return;
  if (hostOf(from) === hostOf(process.env.PUBLIC_URL)) return;
  await updateSettings({ seededFrom: from });
  const existing = await get<{ n: number }>("SELECT count(*)::int AS n FROM articles");
  if (existing && existing.n > 0) return;
  console.log(`[seed] importing the help center from ${from}`);
  await enqueue("import", { url: from, publish: true }, { dedupeKey: "import", maxAttempts: 3 });
}

function auditDue(freq: string, last: string): boolean {
  if (!(freq in AUDIT_DAYS)) return false;
  const days = AUDIT_DAYS[freq as keyof typeof AUDIT_DAYS];
  return !last || Date.now() - new Date(last).getTime() >= days * 86_400_000;
}

/** Gathers signals from the help center and recent product changes, then asks the agent what to fix. */
export async function runAudit(): Promise<number> {
  const s = await getSettings();
  if (!s.lastAuditAt) await updateSettings({ lastAuditAt: new Date().toISOString() });
  const since = new Date(Date.now() - (AUDIT_DAYS[s.auditFrequency as keyof typeof AUDIT_DAYS] ?? 30) * 86_400_000);
  const insights = await getInsights();

  const lines: string[] = [];
  for (const repo of await researchRepos()) {
    try {
      const merged = await listMergedPullRequests(repo, since);
      lines.push(...merged.map((p) => `- ${repo}#${p.number} ${p.title}`));
    } catch (err) {
      lines.push(`(Couldn't list ${repo} pull requests: ${err instanceof Error ? err.message : err})`);
    }
  }
  const prs = lines.join("\n");
  const stale = (await listArticles({ status: "published" }))
    .filter((a) => Date.now() - parseSqlDate(a.updated_at).getTime() > 180 * 86_400_000)
    .slice(0, 20)
    .map((a) => `- ${a.id} ${a.title} (last updated ${a.updated_at.slice(0, 10)})`)
    .join("\n");

  const prompt = `Audit the help center and propose the most valuable fixes and new articles (at most 5).

Questions customers asked that the help center couldn't answer (last 30 days):
${insights.unanswered.map((q) => `- "${q.text}" (${q.count}×)`).join("\n") || "(none)"}

Articles readers marked not helpful:
${insights.leastHelpful.map((a) => `- ${a.id} ${a.title} (${a.helpful_no} of ${a.helpful_yes + a.helpful_no})`).join("\n") || "(none)"}

Pull requests merged since the last audit:
${prs || "(GitHub not connected or none merged)"}

Articles not updated in 6 months:
${stale || "(none)"}`;

  const id = await startThread({ kind: "audit", title: "Help center audit", prompt });
  await runThread(id);
  return id;
}
