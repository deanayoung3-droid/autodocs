"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createKey, revokeKey } from "@/lib/apikeys";
import { requireAdmin, requireManager } from "@/lib/auth";
import { run } from "@/lib/db";
import { addWebhook, deleteWebhook, EVENTS } from "@/lib/events";
import { enqueue } from "@/lib/jobs";
import { disconnectApp } from "@/lib/oauth";
import { updateSettings } from "@/lib/settings";
import { LANGUAGES, staleTranslations } from "@/lib/translations";
import { createInvitation, emailInvitation, INVITE_DAYS, invitationUrl, pendingInvitations, renewInvitation, revokeInvitation } from "@/lib/invitations";
import { adminOrigin } from "@/lib/integrations";
import { mailerReady, sendMail } from "@/lib/mailer";
import { PRODUCT_NAME } from "@/lib/product";
import { asRole, deleteUser, findUserByEmail, getUser, hashSecret, passwordResetToken, roleLabel, setRole } from "@/lib/users";
import { newKey, putFile, sniffImage } from "@/lib/storage";
import { sanitizeWidget } from "@/lib/widget-config";
import { createWidget, deleteWidget, getWidget, updateWidget } from "@/lib/widgets";

export type PanelState = { error?: string; ok?: string; secret?: string } | undefined;

const text = (form: FormData, key: string, max = 10_000) => String(form.get(key) ?? "").trim().slice(0, max);


/* Help center */

export async function saveHelpCenterAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const cost = Number(form.get("costPerTicket"));
  if (!Number.isFinite(cost) || cost < 0 || cost > 1000) return { error: "Cost per ticket must be between 0 and 1000." };
  await updateSettings({
    aiAnswers: form.get("aiAnswers") === "on",
    contentActions: form.get("contentActions") === "on",
    seoTitle: text(form, "seoTitle", 120),
    seoDescription: text(form, "seoDescription", 300),
    customCss: text(form, "customCss", 20_000),
    customJs: text(form, "customJs", 20_000),
    languages: form.getAll("languages").map(String).filter((l) => LANGUAGES[l]).slice(0, 8),
    costPerTicket: cost,
  });
  return { ok: "Help center settings saved." };
}

export async function addRedirectAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const from = text(form, "from", 300);
  const to = text(form, "to", 500);
  if (!from.startsWith("/help/")) return { error: "The old path must start with /help/." };
  if (!/^(\/|https?:\/\/)/.test(to)) return { error: "Send it to a path like /help/new-article or a full URL." };
  await run("INSERT INTO redirects (from_path, to_path) VALUES ($1, $2) ON CONFLICT (from_path) DO UPDATE SET to_path = excluded.to_path", [
    from.replace(/\/$/, ""),
    to,
  ]);
  revalidatePath("/admin", "layout");
  return { ok: `Redirecting ${from}.` };
}

export async function deleteRedirectAction(form: FormData) {
  await requireManager();
  await run("DELETE FROM redirects WHERE id = $1", [Number(form.get("id"))]);
  redirect("/admin/help-center/customize?panel=redirects");
}

export async function translateNowAction() {
  await requireManager();
  for (const t of await staleTranslations(200)) {
    await enqueue("translate", t, { dedupeKey: `translate:${t.articleId}:${t.lang}` });
  }
  redirect("/admin/help-center/translate?translating=1");
}

/* Access */

export async function saveAccessAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const visibility = form.get("siteVisibility") === "private" ? "private" : "public";
  const password = text(form, "readerPassword", 200);
  if (password && password.length < 8) return { error: "Use at least 8 characters for the reader password." };
  // One per line: addresses, or whole domains as @firm.com.
  const allow = String(form.get("readerEmailAllow") ?? "")
    .split(/[\s,;]+/)
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  const bad = allow.find((a) => !/^@?[^@\s]+\.[^@\s]+$/.test(a) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a));
  if (bad) return { error: `"${bad}" isn't an email address or a domain like @firm.com.` };
  await updateSettings({
    siteVisibility: visibility,
    ...(form.has("readerEmailAllow") ? { readerEmailAllow: [...new Set(allow)].slice(0, 200) } : {}),
    ...(form.get("clearPassword") === "on" ? { readerPasswordHash: "" } : password ? { readerPasswordHash: hashSecret(password) } : {}),
  });
  return { ok: "Access settings saved." };
}

/* Team */

const TEAM = "/admin/settings/team";

/** The address this request came in on, for links when the server has no PUBLIC_URL. */
async function here() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

/** Invites someone by email. The link is shown too, for sending another way (or when email isn't set up). */
export async function inviteAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  const me = await requireManager();
  const email = text(form, "email", 200).toLowerCase();
  const role = asRole(form.get("role"));
  if (role === "owner" && me.role !== "owner") return { error: "Only owners can invite another owner." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address." };
  if (await findUserByEmail(email)) return { error: "Someone with that email is already on the team." };
  const link = invitationUrl(await createInvitation(email, role, me), await here());
  const sent = await emailInvitation(email, role, me.name, link).catch((err) => {
    console.error("[invite] couldn't send:", err);
    return false;
  });
  revalidatePath(TEAM);
  return sent
    ? { ok: `Invited ${email}. They'll get an email with a link to join; it works for ${INVITE_DAYS} days. You can also send this link yourself:`, secret: link }
    : {
        ok: `Invited ${email}. Email isn't set up yet (Settings → Email delivery), so send them this link. It works for ${INVITE_DAYS} days.`,
        secret: link,
      };
}

/** A new link for a pending invitation (emailed again when email is set up). The old link stops working. */
export async function invitationLinkAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  const me = await requireManager();
  const id = Number(form.get("id"));
  const pending = (await pendingInvitations()).find((i) => i.id === id);
  if (!pending) return { error: "That invitation was already accepted or revoked." };
  if (pending.role === "owner" && me.role !== "owner") return { error: "Only owners can manage an invitation to be an owner." };
  const renewed = await renewInvitation(id);
  if (!renewed) return { error: "That invitation was already accepted or revoked." };
  const link = invitationUrl(renewed.token, await here());
  const sent = await emailInvitation(pending.email, pending.role, me.name, link).catch(() => false);
  revalidatePath(TEAM);
  return { ok: sent ? `Emailed ${pending.email} a new link. The old one no longer works.` : "New link. The old one no longer works.", secret: link };
}

export async function revokeInvitationAction(form: FormData) {
  const me = await requireManager();
  const id = Number(form.get("id"));
  const pending = (await pendingInvitations()).find((i) => i.id === id);
  if (pending?.role === "owner" && me.role !== "owner") redirect(`${TEAM}?error=owner`);
  await revokeInvitation(id);
  redirect(TEAM);
}

/** A one-hour link for a teammate to choose a new password, emailed to them when email is set up. */
export async function resetLinkAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  const me = await requireManager();
  const target = await getUser(Number(form.get("id")));
  if (!target || target.id === 0) return { error: "That person isn't on the team anymore." };
  if (target.id === me.id) return { error: "Change your own password in Settings → Profile." };
  if (target.role === "owner" && me.role !== "owner") return { error: "Only owners can reset an owner's password." };
  const link = `${adminOrigin(await here())}/login/reset?token=${encodeURIComponent(await passwordResetToken(target))}`;
  let sent = false;
  if (await mailerReady()) {
    sent = await sendMail({
      to: target.email,
      subject: `Reset your ${PRODUCT_NAME} password`,
      text: `${me.name} sent you a link to choose a new password for ${target.email}:\n${link}\n\nThe link works for an hour.`,
    }).then(
      () => true,
      () => false,
    );
  }
  return { ok: sent ? `Emailed ${target.name} a reset link. It works for an hour; here it is too:` : `Send ${target.name} this link. It works for an hour.`, secret: link };
}

export async function removeUserAction(form: FormData) {
  const me = await requireManager();
  const target = await getUser(Number(form.get("id")));
  if (!target || target.id === 0) redirect("/admin/settings/team");
  if (target.role === "owner" && me.role !== "owner") redirect("/admin/settings/team?error=owner");
  await deleteUser(target.id);
  redirect("/admin/settings/team");
}

export async function setRoleAction(form: FormData) {
  const me = await requireManager();
  const target = await getUser(Number(form.get("id")));
  const role = asRole(form.get("role"));
  if (!target || target.id === 0) redirect("/admin/settings/team");
  // Admins manage admins and contributors; only owners touch owners.
  if ((role === "owner" || target.role === "owner") && me.role !== "owner") redirect("/admin/settings/team?error=owner");
  await setRole(target.id, role);
  redirect(`/admin/settings/team?changed=${encodeURIComponent(`${target.name} is now ${roleLabel(role).toLowerCase()}`)}`);
}

/* Developers */

export async function createApiKeyAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const name = text(form, "name", 80);
  if (!name) return { error: "Name the key after what will use it." };
  const { key } = await createKey(name);
  revalidatePath("/admin", "layout");
  return { ok: "Key created. Copy it now; it won't be shown again.", secret: key };
}

export async function revokeApiKeyAction(form: FormData) {
  await requireManager();
  await revokeKey(Number(form.get("id")));
  redirect("/admin/settings/api");
}

export async function addWebhookAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const url = text(form, "url", 500);
  if (!/^https?:\/\//.test(url)) return { error: "Enter a URL starting with https://." };
  const events = form.getAll("events").map(String).filter((e) => (EVENTS as readonly string[]).includes(e));
  const hook = await addWebhook(url, events);
  revalidatePath("/admin", "layout");
  return { ok: "Webhook added. Use this secret to verify the X-AutoDocs-Signature header.", secret: hook.secret };
}

export async function deleteWebhookAction(form: FormData) {
  await requireManager();
  await deleteWebhook(Number(form.get("id")));
  redirect("/admin/settings/webhooks");
}

export async function importSiteAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const url = text(form, "url", 500);
  try {
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error();
  } catch {
    return { error: "Enter the help center's address, like https://docs.example.com, or its sitemap.xml." };
  }
  const queued = await enqueue("import", { url, publish: form.get("publish") === "on" }, { dedupeKey: "import", maxAttempts: 1 });
  if (!queued) return { error: "An import is already waiting to start." };
  revalidatePath("/admin/settings/data");
  return { ok: "Import started. Progress appears below." };
}

/* Widgets */

export async function createWidgetAction() {
  await requireManager();
  const id = await createWidget("New widget");
  redirect(`/admin/widgets/${id}/customize`);
}

/** Saves everything the customizer changed. The settings are cleaned up field by field before saving. */
export async function saveWidgetSettingsAction(id: number, name: string, settings: unknown): Promise<PanelState> {
  await requireManager();
  const w = await getWidget(id);
  if (!w) return { error: "This widget no longer exists." };
  const clean = sanitizeWidget(settings);
  if (clean.contactMethod === "form" && !clean.contactEmail) return { error: "Add the email address contact form messages go to (Contact panel)." };
  await updateWidget(id, name.trim().slice(0, 60) || w.name, clean);
  revalidatePath("/admin/widgets");
  return { ok: "Saved. The widget updates on your site right away." };
}

/** Uploads the widget's logo or header image; the customizer keeps the returned key until Save. */
export async function uploadWidgetImageAction(form: FormData): Promise<{ key?: string; error?: string }> {
  await requireManager();
  const file = form.get("image");
  if (!(file instanceof File) || !file.size) return { error: "Choose an image." };
  if (file.size > 3 * 1024 * 1024) return { error: "Use an image under 3 MB." };
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = sniffImage(buf);
  if (!ext) return { error: "Use a PNG, JPEG, WebP, or GIF image." };
  const key = newKey("widget", ext);
  await putFile(key, buf);
  return { key };
}

export async function deleteWidgetAction(form: FormData) {
  await requireManager();
  await deleteWidget(Number(form.get("id")));
  redirect("/admin/widgets");
}

/** Signs an OAuth-connected app (Claude, ChatGPT) out of this person's account. */
export async function disconnectAppAction(id: number) {
  const user = await requireAdmin();
  await disconnectApp(user.id, id);
  revalidatePath("/admin/mcp");
}
