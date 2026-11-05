import "server-only";
import { INSTANCE_ID, all, get, run } from "./db";
import type { HelpdeskId } from "./helpdesks";

// Durable background work. Requests queue a job and return; every server instance runs a worker
// that claims jobs with SKIP LOCKED, so each job runs once even with several instances. A
// running job renews its lock; if its instance stops, the lock expires and the job runs again.

export type JobKind =
  | "embed"
  | "agent"
  | "verify"
  | "translate"
  | "audit"
  | "classify"
  | "import"
  | "capture"
  | "support"
  | "helpdesk"
  | "pr"
  | "pr-sweep";

export type Job = {
  id: number;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

export type JobRow = Job & {
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** Failed within the last half hour. */
  recent_failure: boolean;
};

const JOB_ROW = `id, kind, payload, attempts, max_attempts, status, error, created_at, started_at, finished_at,
  (status = 'failed' AND finished_at > now() - interval '30 minutes') AS recent_failure`;

type Handler = (payload: Record<string, unknown>, job: Job) => Promise<void>;

/** Handlers load lazily so this module doesn't import the whole app. */
async function handlerFor(kind: JobKind): Promise<Handler> {
  switch (kind) {
    case "embed":
      return async (p) => (await import("./search")).embedArticle(Number(p.articleId));
    case "agent":
      return async (p) => (await import("./agent")).runThread(Number(p.runId));
    case "verify":
      return async (p) => (await import("./verification")).verifyArticle(Number(p.articleId));
    case "translate":
      return async (p) => (await import("./translations")).translateArticle(Number(p.articleId), String(p.lang));
    case "audit":
      return async () => void (await (await import("./scheduler")).runAudit());
    case "classify":
      return async () => void (await (await import("./analytics")).classifyThemes());
    case "import":
      return async (p) => (await import("./importer")).importHelpCenter(String(p.url), Boolean(p.publish));
    case "capture":
      return async (p, job) => (await import("./capture")).runCaptureJob(p, job.id);
    case "support":
      return async () => void (await (await import("./support")).reviewSupportConversations());
    case "helpdesk":
      return async (p) => void (await (await import("./helpdesks")).syncHelpdesk(p.id as HelpdeskId));
    case "pr":
      return async (p, job) =>
        void (await (await import("./pr-intake")).intakePullRequest({ repo: String(p.repo), number: Number(p.number), source: String(p.source ?? "webhook") }, job));
    case "pr-sweep":
      return async () => void (await (await import("./pr-intake")).sweepMergedPullRequests());
  }
}

/** How many of each kind one instance runs at once. Browsers are heavy, so captures go one at a time. */
const LANES: { kinds: JobKind[]; size: number }[] = [
  { kinds: ["capture"], size: 1 },
  { kinds: ["embed", "translate", "classify", "import", "support", "helpdesk", "pr", "pr-sweep"], size: 2 },
  { kinds: ["agent", "verify", "audit"], size: Number(process.env.AGENT_CONCURRENCY || 2) },
];

const LOCK_SECONDS = 120;

/**
 * Queues a job. With a dedupe key, a second copy isn't queued while one is still waiting (and the
 * result is null), unless `sooner` is set: then the waiting copy just runs at the earlier time.
 */
export async function enqueue(
  kind: JobKind,
  payload: Record<string, unknown> = {},
  opts: { dedupeKey?: string; delaySeconds?: number; maxAttempts?: number; sooner?: boolean } = {},
): Promise<number | null> {
  const row = await get<{ id: number }>(
    `INSERT INTO jobs (kind, payload, dedupe_key, run_after, max_attempts)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5)
     ON CONFLICT (dedupe_key) WHERE status = 'queued' ${opts.sooner ? "DO UPDATE SET run_after = least(jobs.run_after, excluded.run_after)" : "DO NOTHING"}
     RETURNING id`,
    [kind, JSON.stringify(payload), opts.dedupeKey ?? null, opts.delaySeconds ?? 0, opts.maxAttempts ?? 3],
  );
  wake();
  return row?.id ?? null;
}

export async function getJob(id: number): Promise<JobRow | undefined> {
  return get<JobRow>(`SELECT ${JOB_ROW} FROM jobs WHERE id = $1`, [id]);
}

export async function recentJobs(kind?: JobKind, limit = 20): Promise<JobRow[]> {
  return all<JobRow>(`SELECT ${JOB_ROW} FROM jobs ${kind ? "WHERE kind = $2" : ""} ORDER BY id DESC LIMIT $1`, kind ? [limit, kind] : [limit]);
}

export async function jobCounts(): Promise<{ queued: number; running: number; failed24h: number }> {
  return (await get<{ queued: number; running: number; failed24h: number }>(
    `SELECT count(*) FILTER (WHERE status = 'queued') AS queued,
            count(*) FILTER (WHERE status = 'running') AS running,
            count(*) FILTER (WHERE status = 'failed' AND finished_at > now() - interval '1 day') AS failed24h
     FROM jobs`,
  ))!;
}

async function claim(kinds: JobKind[]): Promise<Job | undefined> {
  return get<Job>(
    `UPDATE jobs SET status = 'running', locked_by = $1, locked_until = now() + make_interval(secs => $2),
       attempts = attempts + 1, started_at = now(), error = NULL
     WHERE id = (
       SELECT id FROM jobs WHERE status = 'queued' AND run_after <= now() AND kind = ANY($3)
       ORDER BY run_after, id FOR UPDATE SKIP LOCKED LIMIT 1
     )
     RETURNING id, kind, payload, attempts, max_attempts`,
    [INSTANCE_ID, LOCK_SECONDS, kinds],
  );
}

/** Jobs whose instance stopped mid-run go back in the queue (or fail after their last attempt). */
async function recoverExpired() {
  await run(
    `UPDATE jobs SET status = 'failed', finished_at = now(), locked_by = NULL,
       error = 'Stopped before it finished (the server restarted).'
     WHERE status = 'running' AND locked_until < now()
       AND (attempts >= max_attempts OR (dedupe_key IS NOT NULL AND EXISTS (
         SELECT 1 FROM jobs q WHERE q.dedupe_key = jobs.dedupe_key AND q.status = 'queued')))`,
  );
  await run(
    `UPDATE jobs SET status = 'queued', locked_by = NULL, run_after = now()
     WHERE status = 'running' AND locked_until < now()`,
  );
}

async function execute(job: Job) {
  const heartbeat = setInterval(() => {
    void run("UPDATE jobs SET locked_until = now() + make_interval(secs => $1) WHERE id = $2 AND locked_by = $3", [
      LOCK_SECONDS,
      job.id,
      INSTANCE_ID,
    ]).catch(() => {});
  }, (LOCK_SECONDS / 3) * 1000);
  try {
    await (await handlerFor(job.kind))(job.payload, job);
    await run("UPDATE jobs SET status = 'done', finished_at = now(), locked_by = NULL WHERE id = $1", [job.id]);
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
    console.error(`[jobs] ${job.kind} #${job.id} failed (attempt ${job.attempts}):`, message);
    const retry = job.attempts < job.max_attempts;
    await run(
      `UPDATE jobs SET status = $1, error = $2, locked_by = NULL,
         finished_at = CASE WHEN $1 = 'failed' THEN now() END,
         run_after = now() + make_interval(secs => $3)
       WHERE id = $4`,
      [retry ? "queued" : "failed", message, 30 * 2 ** job.attempts, job.id],
    ).catch(async () => {
      // A newer copy of a deduplicated job is already waiting; this attempt is simply done.
      await run("UPDATE jobs SET status = 'failed', error = $1, finished_at = now(), locked_by = NULL WHERE id = $2", [
        message,
        job.id,
      ]);
    });
  } finally {
    clearInterval(heartbeat);
  }
}

/* The worker loop */

type WorkerState = {
  running: Map<number, number>;
  timer?: NodeJS.Timeout;
  wake?: () => void;
  lastRecovery: number;
  filling: boolean;
  again: boolean;
};

declare global {
  var __autodocsWorker: WorkerState | undefined;
}

function wake() {
  globalThis.__autodocsWorker?.wake?.();
}

/** Starts this instance's worker. Safe to call more than once. */
export function startWorker() {
  if (globalThis.__autodocsWorker || process.env.WORKER_DISABLED === "1") return;
  const state: WorkerState = { running: new Map(LANES.map((_, i) => [i, 0])), lastRecovery: 0, filling: false, again: false };
  globalThis.__autodocsWorker = state;

  // One fill at a time, so a lane never claims more jobs than it has room for.
  const fill = async (): Promise<void> => {
    if (state.filling) {
      state.again = true;
      return;
    }
    state.filling = true;
    try {
      if (Date.now() - state.lastRecovery > 30_000) {
        state.lastRecovery = Date.now();
        await recoverExpired().catch((err) => console.error("[jobs] recovery", err));
      }
      for (const [i, lane] of LANES.entries()) {
        while ((state.running.get(i) ?? 0) < lane.size) {
          const job = await claim(lane.kinds).catch((err) => {
            console.error("[jobs] claim", err);
            return undefined;
          });
          if (!job) break;
          state.running.set(i, (state.running.get(i) ?? 0) + 1);
          void execute(job).finally(() => {
            state.running.set(i, (state.running.get(i) ?? 1) - 1);
            void fill();
          });
        }
      }
    } finally {
      state.filling = false;
      if (state.again) {
        state.again = false;
        void fill();
      }
    }
  };

  let scheduled = false;
  state.wake = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      void fill();
    }, 50);
  };
  state.timer = setInterval(() => void fill(), 3_000);
  void fill();

  // On shutdown (a deploy, or Cloud Run scaling in), stop taking work. Jobs still running here
  // are picked up by another instance once their lock lapses.
  process.once("SIGTERM", () => {
    clearInterval(state.timer);
    state.wake = undefined;
    state.filling = true;
  });
}
