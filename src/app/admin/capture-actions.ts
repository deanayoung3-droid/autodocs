"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { aiConfigured } from "@/lib/ai";
import { requireManager } from "@/lib/auth";
import { deleteDashboard, deleteScreenshot, forgetSession, getDashboard, saveCaptureLogin, saveDashboard } from "@/lib/capture";
import { removeImapSettings, rotateForwardingKey, saveImapSettings, stopForwarding, testImap } from "@/lib/inbox";
import { enqueue } from "@/lib/jobs";
import type { PanelState } from "./platform-actions";

const PAGE = "/admin/integrations/dashboard";
const text = (form: FormData, key: string, max: number) => String(form.get(key) ?? "").trim().slice(0, max);

export async function saveDashboardAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const name = text(form, "name", 80) || "Product";
  const url = text(form, "url", 500);
  try {
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error();
  } catch {
    return { error: "Enter the address where sign-in starts, like https://app.example.com." };
  }
  const loginSteps = text(form, "loginSteps", 4000);
  // Passwords belong under Test account (sealed), not in steps stored as plain text.
  if (/pass(word)?\s*[:=]?\s*["“]?(?!\{\{)[^\s"”]{6,}/i.test(loginSteps) && !loginSteps.includes("{{password}}")) {
    return { error: "Don't put the password in the steps. Write {{password}} and save the password under Test account." };
  }
  await saveDashboard({ id: Number(form.get("id")) || undefined, name, url, loginSteps });
  revalidatePath(PAGE);
  return { ok: "Dashboard saved. Test the sign-in next." };
}

export async function testDashboardAction(form: FormData) {
  await requireManager();
  const id = Number(form.get("id"));
  if (!(await getDashboard(id))) redirect(PAGE);
  await enqueue("capture", { test: true, dashboardId: id }, { dedupeKey: `capture-test:${id}`, maxAttempts: 1 });
  redirect(`${PAGE}?testing=${id}`);
}

export async function forgetSessionAction(form: FormData) {
  await requireManager();
  await forgetSession(Number(form.get("id")));
  redirect(PAGE);
}

export async function deleteDashboardAction(form: FormData) {
  await requireManager();
  await deleteDashboard(Number(form.get("id")));
  redirect(PAGE);
}

export async function captureAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  if (!aiConfigured()) return { error: "Screenshots need an OpenAI API key on the server (Settings → AI)." };
  const dashboardId = Number(form.get("dashboard"));
  if (!(await getDashboard(dashboardId))) return { error: "Choose a dashboard." };
  const goal = text(form, "goal", 500);
  const highlight = text(form, "highlight", 300);
  if (goal.length < 4) return { error: "Describe the screen to capture, like “The Cases list”." };
  await enqueue("capture", { dashboardId, goal, highlight }, { maxAttempts: 2 });
  revalidatePath(PAGE);
  return { ok: "Capturing. It shows up below, usually within a minute." };
}

export async function retakeAction(form: FormData) {
  await requireManager();
  const id = Number(form.get("id"));
  await enqueue("capture", { screenshotId: id }, { dedupeKey: `retake:${id}`, maxAttempts: 2 });
  redirect(`${PAGE}?retaking=${id}`);
}

export async function deleteScreenshotAction(form: FormData) {
  await requireManager();
  await deleteScreenshot(Number(form.get("id")));
  redirect(PAGE);
}

/** Reads the test account's mailbox over IMAP. Connects first, so a wrong password is caught here. */
export async function saveCaptureLoginAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const email = text(form, "email", 200);
  const password = String(form.get("password") ?? "").slice(0, 500);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter the test account's email address." };
  await saveCaptureLogin(email, password, form.get("clearPassword") === "on");
  revalidatePath(PAGE);
  return { ok: "Saved. Test the sign-in below to check it." };
}

export async function saveImapAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireManager();
  const host = text(form, "host", 200);
  const user = text(form, "user", 200);
  const password = String(form.get("password") ?? "");
  const port = Number(text(form, "port", 5)) || 993;
  const mailbox = text(form, "mailbox", 100) || "INBOX";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return { error: "Enter the mail server, like imap.gmail.com." };
  if (!user) return { error: "Enter the mailbox's username, usually the test account's email." };
  try {
    const count = await testImap({ host, port, user, mailbox }, password);
    await saveImapSettings({ host, port, user, mailbox }, password);
    revalidatePath(PAGE);
    return { ok: `Connected. ${mailbox} has ${count} ${count === 1 ? "message" : "messages"}.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ENOTFOUND|EAI_AGAIN/.test(message)) return { error: `Couldn't find a mail server at ${host}. Check the address.` };
    if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(message)) return { error: `${host} didn't answer on port ${port}. Check the port (usually 993).` };
    if (/auth|login|credential|password/i.test(message)) return { error: "The mail server rejected the username or password. For Gmail, use an app password." };
    return { error: `Couldn't connect: ${message}` };
  }
}

export async function removeImapAction() {
  await requireManager();
  await removeImapSettings();
  revalidatePath(PAGE);
}

export async function startForwardingAction() {
  await requireManager();
  await rotateForwardingKey();
  revalidatePath(PAGE);
}

export async function stopForwardingAction() {
  await requireManager();
  await stopForwarding();
  revalidatePath(PAGE);
}
