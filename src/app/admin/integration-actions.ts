"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { disconnectGitHub, listBranches, setProductionBranch, setRepositoryIncluded, syncRepositories } from "@/lib/github-app";
import { connectHelpdesk, disconnectHelpdesk, HELPDESK_IDS, HelpdeskError, helpdeskInfo, isHelpdesk, type HelpdeskId } from "@/lib/helpdesks";
import { saveIntegrationDetails, type IntegrationKind } from "@/lib/integrations";
import { enqueue } from "@/lib/jobs";
import { disconnectLinear, saveLinearCredentials } from "@/lib/linear";
import { removeSlackSigningSecret, saveSlackSigningSecret } from "@/lib/slack";
import {
  addSlackPerson,
  channelLabel,
  removeSlackAlerts,
  removeSlackPerson,
  saveSlackAlerts,
  sendSlackPersonTest,
  sendSlackTest,
  SLACK_TOPICS,
  slackAlerts,
  validSlackWebhook,
  type SlackTopic,
} from "@/lib/slack-notify";
import { setAutoDraft } from "@/lib/support";
import type { PanelState } from "./platform-actions";

const KINDS: IntegrationKind[] = ["github", "linear", "slack", "support", ...HELPDESK_IDS];

/** Label and internal description on a connection's page. */
export async function saveConnectionDetailsAction(kind: IntegrationKind, field: "label" | "description", value: string): Promise<PanelState> {
  await requireManager();
  if (!KINDS.includes(kind)) return { error: "Unknown integration." };
  const { getIntegration } = await import("@/lib/integrations");
  const current = await getIntegration(kind);
  const label = field === "label" ? value.trim().slice(0, 60) : (current?.label ?? "");
  const description = field === "description" ? value.trim().slice(0, 500) : (current?.description ?? "");
  await saveIntegrationDetails(kind, label, description);
  revalidatePath(isHelpdesk(kind) ? helpdeskPath(kind) : `/admin/integrations/${kind}`);
  return { ok: "Saved." };
}

export async function setRepositoryIncludedAction(id: number, included: boolean) {
  await requireManager();
  await setRepositoryIncluded(id, included);
  revalidatePath("/admin/integrations/github");
}

export async function setProductionBranchAction(id: number, branch: string | null) {
  await requireManager();
  await setProductionBranch(id, branch);
  revalidatePath("/admin/integrations/github");
}

export async function listBranchesAction(fullName: string): Promise<string[]> {
  await requireManager();
  return listBranches(fullName);
}

export async function refreshRepositoriesAction() {
  await requireManager();
  await syncRepositories();
  revalidatePath("/admin/integrations/github");
}

export async function disconnectGitHubAction() {
  await requireManager();
  await disconnectGitHub();
  redirect("/admin/integrations/github?disconnected=1");
}

/** The Linear OAuth application's credentials, pasted from Linear's settings. Blank secrets keep the saved ones. */
export async function saveLinearCredentialsAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const field = (k: string) => String(form.get(k) ?? "").trim().slice(0, 200);
  const clientId = field("clientId");
  if (!/^[A-Za-z0-9_-]{8,}$/.test(clientId)) return { error: "Paste the client ID from your Linear app's settings." };
  await saveLinearCredentials({ clientId, clientSecret: field("clientSecret"), webhookSecret: field("webhookSecret") });
  revalidatePath("/admin/integrations/linear");
  return { ok: "Saved. Now connect Linear." };
}

export async function disconnectLinearAction() {
  await requireManager();
  await disconnectLinear();
  redirect("/admin/integrations/linear?disconnected=1");
}

export async function setSupportAutoDraftAction(on: boolean) {
  await requireManager();
  await setAutoDraft(on);
  revalidatePath("/admin/integrations", "layout");
}

export async function reviewSupportNowAction() {
  await requireManager();
  await enqueue("support", {}, { dedupeKey: "support-review", sooner: true });
  revalidatePath("/admin/integrations", "layout");
}

/** The Slack app's signing secret (Basic Information → App Credentials). */
export async function saveSlackSecretAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const secret = String(form.get("signingSecret") ?? "").trim();
  if (!/^[a-f0-9]{32}$/i.test(secret)) return { error: "Paste the signing secret from your Slack app's Basic Information page: 32 letters and digits." };
  await saveSlackSigningSecret(secret);
  revalidatePath("/admin/integrations/slack");
  return { ok: "Saved. Try /docs in Slack." };
}

export async function removeSlackAction() {
  await requireManager();
  await removeSlackSigningSecret();
  redirect("/admin/integrations/slack?disconnected=1");
}

/** Notifications: the channel's Incoming Webhook and which topics go there. A new URL is tested at once. */
export async function saveSlackAlertsAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const url = String(form.get("webhookUrl") ?? "").trim();
  if (url && !validSlackWebhook(url)) {
    return { error: "Paste the Incoming Webhook URL from your Slack app. It starts with https://hooks.slack.com/services/." };
  }
  if (!url && !(await slackAlerts()).url) return { error: "Paste the channel's webhook URL first." };
  const topics = Object.fromEntries(SLACK_TOPICS.map((t) => [t.key, form.get(`topic_${t.key}`) === "on"])) as Record<SlackTopic, boolean>;
  await saveSlackAlerts({ webhookUrl: url || undefined, topics, channel: channelLabel(String(form.get("channel") ?? "")) });
  revalidatePath("/admin/integrations/slack");
  if (!url) return { ok: "Saved." };
  const test = await sendSlackTest();
  return test.ok ? { ok: "Connected. A test message is in the channel." } : { error: `Saved, but Slack didn't accept a test message: ${test.error}` };
}

export async function testSlackAlertsAction(): Promise<PanelState> {
  await requireManager();
  const test = await sendSlackTest();
  return test.ok ? { ok: "Sent. Check the channel." } : { error: `Slack didn't accept it: ${test.error}` };
}

export async function removeSlackAlertsAction() {
  await requireManager();
  await removeSlackAlerts();
  redirect("/admin/integrations/slack?alertsOff=1");
}

/** Adds a teammate who gets updates in their own Slack DMs, then sends them a hello there. */
export async function addSlackPersonAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const name = String(form.get("name") ?? "").trim().slice(0, 60);
  const url = String(form.get("webhookUrl") ?? "").trim();
  if (!name) return { error: "Enter the person's name." };
  if (!validSlackWebhook(url)) return { error: "Paste the Incoming Webhook URL for their DM. It starts with https://hooks.slack.com/services/." };
  const topics = Object.fromEntries(SLACK_TOPICS.map((t) => [t.key, form.get(`topic_${t.key}`) === "on"])) as Record<SlackTopic, boolean>;
  const id = await addSlackPerson({ name, webhookUrl: url, topics });
  revalidatePath("/admin/integrations/slack");
  const test = await sendSlackPersonTest(id);
  return test.ok ? { ok: `Added. ${name} has a hello in their Slack DMs.` } : { error: `Added, but Slack didn't accept a test message: ${test.error}` };
}

export async function testSlackPersonAction(id: string): Promise<PanelState> {
  await requireManager();
  const test = await sendSlackPersonTest(id);
  return test.ok ? { ok: "Sent. Check their DMs." } : { error: `Slack didn't accept it: ${test.error}` };
}

export async function removeSlackPersonAction(id: string) {
  await requireManager();
  await removeSlackPerson(id);
  revalidatePath("/admin/integrations/slack");
}

/** Where a helpdesk's connection lives: Slack's support channel sits on the Slack page. */
const helpdeskPath = (id: HelpdeskId) => (id === "slack-support" ? "/admin/integrations/slack" : `/admin/integrations/helpdesk/${id}`);

/** Checks a helpdesk's credentials with the helpdesk, saves them, and starts the first read. */
export async function saveHelpdeskAction(id: string, _prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  if (!isHelpdesk(id)) return { error: "Unknown helpdesk." };
  const input = Object.fromEntries(helpdeskInfo(id).fields.map((f) => [f.name, String(form.get(f.name) ?? "")]));
  try {
    const account = await connectHelpdesk(id, input);
    revalidatePath(helpdeskPath(id));
    return { ok: `Connected to ${account}. Reading ${helpdeskInfo(id).items} from the last week now.` };
  } catch (err) {
    if (err instanceof HelpdeskError) return { error: err.message };
    throw err;
  }
}

export async function syncHelpdeskNowAction(id: string) {
  await requireManager();
  if (!isHelpdesk(id)) return;
  await enqueue("helpdesk", { id }, { dedupeKey: `helpdesk:${id}`, sooner: true });
  revalidatePath(helpdeskPath(id));
}

export async function disconnectHelpdeskAction(id: string) {
  await requireManager();
  if (!isHelpdesk(id)) return;
  await disconnectHelpdesk(id);
  redirect(id === "slack-support" ? "/admin/integrations/slack?stopped=1" : `${helpdeskPath(id)}?disconnected=1`);
}
