import "server-only";
import { get, run } from "./db";
import { getSecrets, saveIntegration } from "./integrations";

// Slack's /docs slash command. The signing secret proves a request came from your Slack app; it's
// saved (sealed) from the Slack page, or set as SLACK_SIGNING_SECRET. When the thread a command
// started finishes, the result is posted back to the person who ran it.

export async function slackSigningSecret(): Promise<string | null> {
  return (await getSecrets<{ signingSecret?: string }>("slack"))?.signingSecret || process.env.SLACK_SIGNING_SECRET || null;
}

export async function slackSecretSource(): Promise<"saved" | "environment" | null> {
  if ((await getSecrets<{ signingSecret?: string }>("slack"))?.signingSecret) return "saved";
  return process.env.SLACK_SIGNING_SECRET ? "environment" : null;
}

export async function saveSlackSigningSecret(secret: string) {
  await saveIntegration("slack", { secrets: { signingSecret: secret }, connected: true });
}

export async function removeSlackSigningSecret() {
  await saveIntegration("slack", { secrets: null, connected: false });
}

/** Remembers the command's response URL so the result can be posted when the thread finishes. */
export async function replyInSlack(runId: number, responseUrl: string) {
  await run("UPDATE agent_runs SET reply_to = coalesce(reply_to, '{}'::jsonb) || $1::jsonb WHERE id = $2", [JSON.stringify({ slackResponseUrl: responseUrl }), runId]);
}

/** For a thread started from Slack: posts the result to the person who asked (Slack keeps the URL for 30 minutes). */
export async function slackReporter(runId: number, origin: string) {
  const row = await get<{ url: string | null }>("SELECT reply_to->>'slackResponseUrl' AS url FROM agent_runs WHERE id = $1", [runId]);
  const url = row?.url;
  if (!url || !/^https:\/\/hooks\.slack\.com\//.test(url)) return null;
  const link = `${origin}/admin/agent/${runId}`;
  const post = (text: string) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }) }).catch(
      (err) => console.warn(`[slack] thread ${runId}: ${err instanceof Error ? err.message : err}`),
    );
  return {
    finished: (summary: string, count: number) =>
      post(`${summary}${count ? `\n${count} ${count === 1 ? "draft is" : "drafts are"} ready to review: <${link}|review them>` : `\n<${link}|Open the thread>`}`),
    failed: (message: string) => post(`Docs Agent couldn't finish: ${message}\n<${link}|Open the thread>`),
  };
}
