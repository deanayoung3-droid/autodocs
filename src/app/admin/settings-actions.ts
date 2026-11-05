"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin, requireManager, requireOwner, SESSION_COOKIE } from "@/lib/auth";
import { all, run, tx } from "@/lib/db";
import { createExtensionToken, revokeExtensionToken } from "@/lib/extension";
import { aiConfigured, generateJSON } from "@/lib/ai";
import { reachableFromInternet } from "@/lib/integrations";
import { enqueue } from "@/lib/jobs";
import { getSettings, updateSettings, type HeaderLink, type Settings } from "@/lib/settings";
import { LANGUAGES } from "@/lib/translations";
import { emailAgentKey, removeSmtp, saveSmtp, sendMail, stopEmailAgent, verifySmtp } from "@/lib/mailer";
import { prefsFor, savePrefs } from "@/lib/notify";
import { parsePathRules } from "@/lib/pr-intake";
import { deleteFile, newKey, putFile, sniffImage } from "@/lib/storage";
import { authenticate, canManage, deleteUser, setName, setPassword } from "@/lib/users";
import type { PanelState } from "./platform-actions";

/** "Label | URL" lines, as the header and footer link fields take them. */
function linkLines(value: string, where: string): Parsed {
  const links: HeaderLink[] = [];
  for (const line of value.split("\n")) {
    if (!line.trim()) continue;
    const [label, url] = line.split("|").map((s) => s.trim());
    if (!label || !url || !/^(https?:\/\/|\/|mailto:)/i.test(url)) {
      return { error: `${where} link "${line}" should look like: Label | https://example.com` };
    }
    links.push({ label, url });
  }
  return { value: links.slice(0, 6) };
}

const text = (form: FormData, key: string, max: number) => String(form.get(key) ?? "").trim().slice(0, max);
const checked = (form: FormData, key: string) => form.get(key) === "on";
const oneOf = <T extends string>(v: string, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

type Parsed = { value: unknown } | { error: string };

/** How each setting is read from a form. A panel lists the keys it owns in a hidden `_fields` input. */
const FIELDS: { [K in keyof Settings]?: (form: FormData) => Parsed } = {
  brandName: (f) => {
    const v = text(f, "brandName", 60);
    return v ? { value: v } : { error: "Enter a name." };
  },
  accent: (f) => {
    const v = text(f, "accent", 7).toLowerCase();
    return /^#[0-9a-f]{6}$/.test(v) ? { value: v } : { error: "Accent color must be a hex value like #7f56d9." };
  },
  logoUrl: (f) => {
    const v = text(f, "logoUrl", 500);
    return !v || /^(https?:\/\/|\/)/i.test(v) ? { value: v } : { error: "The logo must be a URL starting with https:// or /." };
  },
  supportUrl: (f) => {
    const v = text(f, "supportUrl", 500);
    return !v || /^(https?:\/\/|mailto:)/i.test(v) ? { value: v } : { error: "The contact link must start with https:// or mailto:." };
  },
  headerLinks: (f) => linkLines(text(f, "headerLinks", 2000), "Header"),
  footerLinks: (f) => linkLines(text(f, "footerLinks", 2000), "Footer"),
  showPoweredBy: (f) => ({ value: checked(f, "showPoweredBy") }),
  helpColorScheme: (f: FormData) => ({ value: oneOf(text(f, "helpColorScheme", 10), ["system", "light", "dark"] as const, "system") }),
  aiAnswers: (f) => ({ value: checked(f, "aiAnswers") }),
  contentActions: (f) => ({ value: checked(f, "contentActions") }),
  seoTitle: (f) => ({ value: text(f, "seoTitle", 120) }),
  seoDescription: (f) => ({ value: text(f, "seoDescription", 300) }),
  customHead: (f) => ({ value: text(f, "customHead", 20_000) }),
  customCss: (f) => ({ value: text(f, "customCss", 20_000) }),
  customJs: (f) => ({ value: text(f, "customJs", 20_000) }),
  languages: (f) => ({ value: f.getAll("languages").map(String).filter((l) => LANGUAGES[l]).slice(0, 8) }),
  costPerTicket: (f) => {
    const v = Number(f.get("costPerTicket"));
    return Number.isFinite(v) && v >= 0 && v <= 1000 ? { value: v } : { error: "Cost per ticket must be between 0 and 1000." };
  },
  githubRepo: (f) => {
    const v = text(f, "githubRepo", 200).replace(/^https?:\/\/github\.com\//i, "").replace(/\/$/, "");
    return !v || /^[\w.-]+\/[\w.-]+$/.test(v) ? { value: v } : { error: "Enter the repository as owner/name." };
  },
  autoScreenPRs: (f) => ({ value: checked(f, "autoScreenPRs") }),
  prSensitivity: (f) => ({ value: oneOf(String(f.get("prSensitivity")), ["strict", "balanced", "eager"] as const, "balanced") }),
  prPathRules: (f) => {
    const v = text(f, "prPathRules", 4000);
    const { errors } = parsePathRules(v);
    return errors.length ? { error: errors[0] } : { value: v };
  },
  agentGuidance: (f) => ({ value: text(f, "agentGuidance", 4000) }),
  auditFrequency: (f) => ({ value: oneOf(String(f.get("auditFrequency")), ["off", "weekly", "biweekly", "monthly"] as const, "off") }),
  continuousVerification: (f) => ({ value: checked(f, "continuousVerification") }),
  verifyPerDay: (f) => {
    const v = Math.round(Number(f.get("verifyPerDay")));
    return Number.isFinite(v) && v >= 1 && v <= 200 ? { value: v } : { error: "Checks per day must be between 1 and 200." };
  },
};

const lines = (f: FormData, key: string, maxItems: number, maxLen: number) =>
  [...new Set(text(f, key, 20_000).split("\n").map((l) => l.trim().slice(0, maxLen)).filter(Boolean))].slice(0, maxItems);



Object.assign(FIELDS, {
  websiteUrl: (f: FormData) => {
    const v = text(f, "websiteUrl", 300);
    return !v || /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v) ? { value: v } : { error: "Enter your website's address, like https://example.com." };
  },
  aboutCompany: (f: FormData) => ({ value: text(f, "aboutCompany", 6000) }),
  researchGuidance: (f: FormData) => ({ value: text(f, "researchGuidance", 4000) }),
  assistantTone: (f: FormData) => ({ value: oneOf(text(f, "assistantTone", 20), ["friendly", "professional", "plainspoken", "playful"] as const, "friendly") }),
  assistantEmoji: (f: FormData) => ({ value: checked(f, "assistantEmoji") }),
  assistantOwnWords: (f: FormData) => ({ value: checked(f, "assistantOwnWords") }),
  assistantLength: (f: FormData) => ({ value: oneOf(text(f, "assistantLength", 20), ["concise", "standard", "thorough"] as const, "standard") }),
  assistantScreenshots: (f: FormData) => ({ value: checked(f, "assistantScreenshots") }),
  assistantInstructions: (f: FormData) => ({ value: text(f, "assistantInstructions", 4000) }),
  assistantOffLimits: (f: FormData) => ({ value: lines(f, "assistantOffLimits", 20, 200) }),
  assistantHandoffTriggers: (f: FormData) => {
    const v = lines(f, "assistantHandoffTriggers", 11, 200);
    return v.length > 10 ? { error: "Keep it to 10 handoff triggers." } : { value: v };
  },
  emailAgentExternal: (f: FormData) => ({ value: checked(f, "emailAgentExternal") }),
  emailAgentReply: (f: FormData) => ({ value: checked(f, "emailAgentReply") }),
} satisfies { [K in keyof Settings]?: (form: FormData) => Parsed });

/** Saves only the settings a panel owns, so panels never overwrite each other. */
export async function savePanelAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  if (!canManage(await requireAdmin())) return { error: "Only admins and owners can change settings." };
  const keys = String(form.get("_fields") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k): k is keyof Settings => k in FIELDS);
  if (keys.length === 0) return { error: "Nothing to save." };
  const patch: Partial<Settings> = {};
  for (const key of keys) {
    const parsed = FIELDS[key]!(form);
    if ("error" in parsed) return { error: parsed.error };
    (patch as Record<string, unknown>)[key] = parsed.value;
  }
  await updateSettings(patch);
  revalidatePath("/", "layout");
  return { ok: String(form.get("_saved") || "Saved.") };
}

/* AI models */

/** OpenAI model ids look like "gpt-6.1-sol" or "gpt-6.1-sol-2026-09-01". Empty means the default. */
const MODEL_ID = /^[a-z0-9][a-z0-9.\-]{1,60}$/;

export async function chooseModelsAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  if (!canManage(await requireAdmin())) return { error: "Only admins and owners can change the AI models." };
  const aiModel = text(form, "aiModel", 64);
  const answerModel = text(form, "answerModel", 64);
  for (const m of [aiModel, answerModel]) {
    if (m && !MODEL_ID.test(m)) return { error: `"${m}" doesn't look like an OpenAI model id.` };
  }
  await updateSettings({ aiModel, answerModel });
  revalidatePath("/admin/settings/ai");
  return { ok: "Models saved. New requests use them right away." };
}

/** Re-indexes every article for AI search (only sections whose text changed are re-embedded). */
export async function reindexAction() {
  await requireManager();
  for (const { id } of await all<{ id: number }>("SELECT id FROM articles WHERE deleted_at IS NULL")) {
    await enqueue("embed", { articleId: id }, { dedupeKey: `embed:${id}` });
  }
  redirect("/admin/settings/ai");
}

/* Profile */

export async function saveProfileAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  const user = await requireAdmin();
  if (user.id === 0) return { error: "The built-in owner signs in with ADMIN_PASSWORD. Add yourself under Team to get a profile." };
  const name = text(form, "name", 80);
  if (!name) return { error: "Enter your name." };
  await setName(user.id, name);
  revalidatePath("/admin", "layout");
  return { ok: "Profile saved." };
}

/* About you */

async function pageText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoDocsBot/1.0)" }, redirect: "follow" });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return "";
  const html = (await res.text()).slice(0, 1_000_000);
  const meta = [...html.matchAll(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)/gi)].map((m) => m[1]);
  const body = html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return [...meta, body].join("\n").slice(0, 12_000);
}

/** Reads the company's website and writes what Docs Agent should know about the company. Replaces the current text. */
export async function regenerateAboutAction(): Promise<PanelState> {
  await requireManager();
  const { websiteUrl, brandName } = await getSettings();
  if (!websiteUrl) return { error: "Add your website's address in Settings → General first." };
  if (!reachableFromInternet(websiteUrl)) return { error: "Docs Agent can only read a public website." };
  if (!aiConfigured()) return { error: "Add an OpenAI API key on the server first." };
  let text = "";
  try {
    const home = await pageText(websiteUrl);
    const about = await pageText(new URL("/about", websiteUrl).href).catch(() => "");
    text = `${home}\n\n${about}`.trim();
  } catch {
    return { error: `Couldn't open ${websiteUrl}. Check the address in Settings → General.` };
  }
  if (text.length < 200) return { error: `${websiteUrl} didn't have enough readable text to learn from.` };
  const out = await generateJSON<{ profile: string }>({
    purpose: "classify",
    effort: "low",
    system: `From a company's website, write what a documentation writer should know about it: what the product is, who uses it, the main things customers do with it, and the words the company uses for its core objects. 120 to 220 words, plain sentences, no marketing language. Use only what the page says.`,
    prompt: `Company: ${brandName}\n\n<website>\n${text}\n</website>`,
    schema: { type: "object", additionalProperties: false, required: ["profile"], properties: { profile: { type: "string" } } },
  });
  const profile = typeof out.profile === "string" ? out.profile.trim() : "";
  if (profile.length < 40) return { error: "Docs Agent couldn't write a useful summary from the website. Write it yourself above." };
  await updateSettings({ aboutCompany: profile.slice(0, 6000) });
  revalidatePath("/admin/settings/about");
  return { ok: "Rewritten from your website. Edit anything Docs Agent got wrong." };
}

/* Account: notifications, security, photo */

export async function saveNotificationsAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  const user = await requireAdmin();
  const address = text(form, "notifyAddress", 200).toLowerCase();
  if (address && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return { error: "Enter a valid email address, or leave it empty." };
  const notifyEmail = checked(form, "notifyEmail");
  if (notifyEmail && !address && !user.email) return { error: "Add the address to email, since the built-in owner has none." };
  await savePrefs(user.id, { notify_email: notifyEmail, notify_browser: checked(form, "notifyBrowser"), notify_address: address });
  revalidatePath("/admin", "layout");
  return { ok: "Notification settings saved." };
}

export async function changePasswordAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  const user = await requireAdmin();
  if (user.id === 0) return { error: "The built-in owner's password is ADMIN_PASSWORD on the server. Change it there." };
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (!(await authenticate(user.email, current))) return { error: "Your current password isn't right." };
  if (next.length < 15) return { error: "Use at least 15 characters for the new password." };
  if (next !== String(form.get("confirm") ?? "")) return { error: "The new passwords don't match." };
  if (next === current) return { error: "Choose a password you haven't been using." };
  await setPassword(user.id, next);
  return { ok: "Password changed." };
}

export async function uploadAvatarAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  const user = await requireAdmin();
  const file = form.get("photo");
  if (!(file instanceof File) || !file.size) return { error: "Choose an image." };
  if (file.size > 2 * 1024 * 1024) return { error: "Use an image under 2 MB." };
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = sniffImage(buf);
  if (!ext) return { error: "Use a PNG, JPEG, WebP, or GIF image." };
  const key = newKey("avatars", ext);
  await putFile(key, buf);
  const old = (await prefsFor(user.id)).avatar_key;
  await savePrefs(user.id, { avatar_key: key });
  if (old) await deleteFile(old).catch(() => undefined);
  revalidatePath("/admin", "layout");
  return { ok: "Photo updated." };
}

export async function removeAvatarAction() {
  const user = await requireAdmin();
  const old = (await prefsFor(user.id)).avatar_key;
  await savePrefs(user.id, { avatar_key: null });
  if (old) await deleteFile(old).catch(() => undefined);
  revalidatePath("/admin", "layout");
}

/** Removes your own account. The built-in owner can't be removed; it comes from ADMIN_PASSWORD. */
export async function deleteAccountAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  const user = await requireAdmin();
  if (user.id === 0) return { error: "The built-in owner can't be deleted. Remove ADMIN_PASSWORD from the server to turn it off." };
  if (text(form, "confirm", 100).toLowerCase() !== user.email.toLowerCase()) return { error: "Type your email address to confirm." };
  const old = (await prefsFor(user.id)).avatar_key;
  await deleteUser(user.id);
  if (old) await deleteFile(old).catch(() => undefined);
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

/* General: the workspace icon */

export async function uploadWorkspaceIconAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const file = form.get("icon");
  if (!(file instanceof File) || !file.size) return { error: "Choose an image." };
  if (file.size > 2 * 1024 * 1024) return { error: "Use an image under 2 MB." };
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = sniffImage(buf);
  if (!ext) return { error: "Use a PNG, JPEG, WebP, or GIF image." };
  const key = newKey("workspace", ext);
  await putFile(key, buf);
  const old = (await getSettings()).workspaceIcon;
  await updateSettings({ workspaceIcon: key });
  if (old) await deleteFile(old).catch(() => undefined);
  revalidatePath("/", "layout");
  return { ok: "Workspace icon updated." };
}

/* Email delivery */

export async function saveSmtpAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const host = text(form, "host", 200);
  const port = Number(text(form, "port", 5)) || 587;
  const user = text(form, "user", 200);
  const from = text(form, "from", 200);
  const password = String(form.get("password") ?? "");
  if (!/^[a-z0-9.-]+$/i.test(host)) return { error: "Enter the SMTP server, like smtp.gmail.com or smtp.sendgrid.net." };
  if (!/@/.test(from)) return { error: "Enter the From address, like Docs Agent <docs@yourcompany.com>." };
  try {
    await verifySmtp({ host, port, user, from }, password);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ENOTFOUND|EAI_AGAIN/.test(message)) return { error: `Couldn't find an SMTP server at ${host}.` };
    if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(message)) return { error: `${host} didn't answer on port ${port}. Usually it's 587 or 465.` };
    if (/auth|login|credential|535/i.test(message)) return { error: "The server rejected the username or password." };
    return { error: `Couldn't connect: ${message}` };
  }
  await saveSmtp({ host, port, user, from }, password);
  revalidatePath("/admin/settings/email");
  return { ok: "Connected. Send yourself a test email to be sure." };
}

export async function removeSmtpAction() {
  await requireManager();
  await removeSmtp();
  revalidatePath("/admin/settings/email");
}

export async function sendTestEmailAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const to = text(form, "to", 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { error: "Enter an address to send the test to." };
  try {
    await sendMail({ to, subject: "Test email from Docs Agent", text: "This is a test. Email delivery works: Docs Agent can tell your team when tasks finish and reply to emailed requests." });
  } catch (err) {
    return { error: `Couldn't send: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: `Sent to ${to}. Check the inbox (and spam).` };
}

/* Email Docs Agent */

export async function startEmailAgentAction() {
  await requireManager();
  await emailAgentKey(true);
  revalidatePath("/admin/settings/email-agent");
}

export async function stopEmailAgentAction() {
  await requireManager();
  await stopEmailAgent();
  revalidatePath("/admin/settings/email-agent");
}

/* Danger zone */

/** Deletes every article, section, Docs Agent thread, screenshot, and analytics record. Settings, the team, and integrations stay. */
export async function deleteWorkspaceContentAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireOwner();
  const { brandName } = await getSettings();
  if (text(form, "confirm", 100) !== brandName) return { error: `Type ${brandName} exactly to confirm.` };
  const files = await all<{ key: string }>("SELECT raw_key AS key FROM screenshots UNION ALL SELECT image_key FROM screenshots");
  await tx(async () => {
    for (const table of [
      "proposals",
      "thread_messages",
      "agent_steps",
      "linear_sessions",
      "support_conversations",
      "agent_runs",
      "verifications",
      "translations",
      "collection_translations",
      "revisions",
      "article_chunks",
      "redirects",
      "articles",
      "collections",
      "screenshots",
      "queries",
      "ai_conversations",
      "page_views",
      "widget_events",
    ]) {
      await run(`DELETE FROM ${table}`);
    }
  });
  for (const f of files) if (f.key) await deleteFile(f.key).catch(() => undefined);
  revalidatePath("/", "layout");
  return { ok: "Deleted. The help center is empty; settings, the team, and integrations are unchanged." };
}

/* Chrome extension */

/** A sign-in for the extension in this browser. The page hands the token straight to the extension. */
export async function connectExtensionAction(browser: string): Promise<{ id: number; token: string }> {
  const user = await requireAdmin();
  return createExtensionToken(user.id, browser);
}

export async function disconnectExtensionAction(id: number) {
  const user = await requireAdmin();
  await revokeExtensionToken(user.id, id);
  revalidatePath("/admin/settings/extension");
}
