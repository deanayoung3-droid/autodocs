import "server-only";
import { all, get, run } from "./db";
import { adminOrigin } from "./integrations";
import { mailerReady, sendMail } from "./mailer";
import { getSettings } from "./settings";

// Telling people Docs Agent is done: an email to whoever started the thread (if they want one), the
// reply to an emailed request (Email Docs Agent), and the list the admin polls for browser notifications.

export type Prefs = { avatar_key: string | null; notify_email: boolean; notify_browser: boolean; notify_address: string };

const DEFAULT_PREFS: Prefs = { avatar_key: null, notify_email: true, notify_browser: false, notify_address: "" };

export async function prefsFor(userId: number): Promise<Prefs> {
  return (await get<Prefs>("SELECT avatar_key, notify_email, notify_browser, notify_address FROM user_prefs WHERE user_id = $1", [userId])) ?? DEFAULT_PREFS;
}

export async function savePrefs(userId: number, patch: Partial<Prefs>) {
  const next = { ...(await prefsFor(userId)), ...patch };
  await run(
    `INSERT INTO user_prefs (user_id, avatar_key, notify_email, notify_browser, notify_address) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET avatar_key = excluded.avatar_key, notify_email = excluded.notify_email,
       notify_browser = excluded.notify_browser, notify_address = excluded.notify_address`,
    [userId, next.avatar_key, next.notify_email, next.notify_browser, next.notify_address],
  );
}

type ThreadRow = { source_title: string; started_by: number | null; email: string | null; reply_to: { email?: string; subject?: string; messageId?: string } | null };

/** Called when a thread finishes or fails. Never throws: a missed email shouldn't fail the work. */
export async function notifyThreadDone(runId: number, outcome: { ok: boolean; summary: string; proposals?: number }) {
  await (await import("./slack-notify")).notifyThreadFinished(runId, outcome).catch((err) => console.warn(`[slack-alerts] thread ${runId}:`, err));
  try {
    const t = await get<ThreadRow>(
      "SELECT r.source_title, r.started_by, u.email, r.reply_to FROM agent_runs r LEFT JOIN users u ON u.id = r.started_by WHERE r.id = $1",
      [runId],
    );
    if (!t || !(await mailerReady())) return;
    const link = `${adminOrigin()}/admin/agent/${runId}`;
    const drafts = outcome.proposals ? `\n\n${outcome.proposals} ${outcome.proposals === 1 ? "draft is" : "drafts are"} ready to review. Nothing is published until someone approves it.` : "";
    const body = outcome.ok ? `${outcome.summary}${drafts}\n\n${link}` : `Docs Agent couldn't finish: ${outcome.summary}\n\n${link}`;

    if (t.started_by !== null) {
      const prefs = await prefsFor(t.started_by);
      const to = prefs.notify_address || t.email;
      if (prefs.notify_email && to) {
        await sendMail({ to, subject: `${outcome.ok ? "Docs Agent finished" : "Docs Agent couldn't finish"}: ${t.source_title}`, text: body });
      }
    }
    // Email Docs Agent: answer the person who emailed the request, in the same email thread.
    if (t.reply_to?.email && (await getSettings()).emailAgentReply) {
      await sendMail({ to: t.reply_to.email, subject: `Re: ${t.reply_to.subject || t.source_title}`, text: body, inReplyTo: t.reply_to.messageId });
    }
  } catch (err) {
    console.warn(`[notify] thread ${runId}: ${err instanceof Error ? err.message : err}`);
  }
}

/** Threads this person started that finished after `since`, for browser notifications. */
export async function finishedSince(userId: number, since: Date) {
  return all<{ id: number; source_title: string; status: string; summary: string | null; finished_at: string }>(
    `SELECT id, source_title, status, summary, finished_at FROM agent_runs
     WHERE started_by = $1 AND finished_at > $2 AND status IN ('done', 'failed') ORDER BY finished_at LIMIT 10`,
    [userId, since],
  );
}
