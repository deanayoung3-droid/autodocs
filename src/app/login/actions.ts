"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, createSessionToken, currentUser, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";
import { adminOrigin } from "@/lib/integrations";
import { findInvitation, markAccepted } from "@/lib/invitations";
import { mailerReady, sendMail } from "@/lib/mailer";
import { PRODUCT_NAME } from "@/lib/product";
import { updateSettings } from "@/lib/settings";
import {
  authenticate,
  createUser,
  findUserByEmail,
  ownerExists,
  ownerSetupCodeMatches,
  passwordResetToken,
  setPassword,
  userFromResetToken,
} from "@/lib/users";

type FormState = { error?: string; ok?: string } | undefined;

// Failed sign-ins in the last 15 minutes, per account from one address and per account overall,
// so guessing stops quickly without one stranger being able to lock the owner out for long.
const failures = new Map<string, number[]>();
const WINDOW_MS = 15 * 60_000;
const recentFailures = (key: string) => (failures.get(key) ?? []).filter((t) => Date.now() - t < WINDOW_MS);

async function clientAddress() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function startSession(userId: number) {
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    // Secure only behind HTTPS, so signing in over plain http on the LAN still works.
    secure: (await headers()).get("x-forwarded-proto") === "https",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

/** The same rule as changing a password in Profile. */
function passwordProblem(form: FormData): string | null {
  const password = String(form.get("password") ?? "");
  if (password.length < 15) return "Use at least 15 characters for your password.";
  if (password !== String(form.get("confirm") ?? "")) return "The passwords don't match.";
  return null;
}

const text = (form: FormData, key: string, max: number) => String(form.get(key) ?? "").trim().slice(0, max);

export async function signInAction(_prev: FormState, form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const who = email.toLowerCase() || "owner";
  const keys = [`${who}|${await clientAddress()}`, who];
  if (recentFailures(keys[0]).length >= 10 || recentFailures(keys[1]).length >= 50) {
    return { error: "Too many wrong tries. Wait 15 minutes, then try again." };
  }
  // Teammates sign in with email and password; the owner can also use ADMIN_PASSWORD alone.
  const userId = email ? (await authenticate(email, password))?.id : (await checkPassword(password)) ? 0 : undefined;
  if (userId === undefined) {
    if (failures.size > 5000) failures.clear();
    for (const k of keys) failures.set(k, [...recentFailures(k), Date.now()]);
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return { error: email ? "That email and password don't match." : "That password isn't right." };
  }
  failures.delete(keys[0]);
  await startSession(userId);
  // Signed in with the setup password and nobody owns the workspace yet: make that account first.
  if (userId === 0 && !(await ownerExists())) redirect("/welcome");
  const next = String(form.get("next") ?? "");
  // Back where they came from: the admin, or an app asking to connect over OAuth.
  redirect(next.startsWith("/admin") || next.startsWith("/oauth/authorize?") ? next : "/admin");
}

// Reset emails asked for in the last 15 minutes, per address and per sender.
const resetRequests = new Map<string, number[]>();

export async function forgotPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email", 200).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter the email you sign in with." };
  if (!(await mailerReady())) {
    return { error: "This workspace can't send email yet. Ask an owner or admin for a reset link from Settings → Team." };
  }
  const answer = { ok: "If that email has an account here, a link to reset its password is on its way. It works for an hour." };
  const keys = [email, `ip:${await clientAddress()}`];
  const recent = (k: string) => (resetRequests.get(k) ?? []).filter((t) => Date.now() - t < WINDOW_MS);
  if (recent(keys[0]).length >= 3 || recent(keys[1]).length >= 10) return answer;
  if (resetRequests.size > 5000) resetRequests.clear();
  for (const k of keys) resetRequests.set(k, [...recent(k), Date.now()]);
  // The same answer either way, so the form can't be used to find out who has an account.
  const user = await findUserByEmail(email);
  if (user) {
    const h = await headers();
    const here = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    const link = `${adminOrigin(here)}/login/reset?token=${encodeURIComponent(await passwordResetToken(user))}`;
    await sendMail({
      to: user.email,
      subject: `Reset your ${PRODUCT_NAME} password`,
      text: `Someone asked to reset the password for ${user.email}. To choose a new one, open:\n${link}\n\nThe link works for an hour. If you didn't ask, ignore this email; your password stays the same.`,
    }).catch((err) => console.error("[reset] couldn't send:", err));
  }
  return answer;
}

export async function resetPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await userFromResetToken(String(form.get("token") ?? ""));
  if (!user) return { error: "This link has expired or was already used. Ask for a new one." };
  const problem = passwordProblem(form);
  if (problem) return { error: problem };
  await setPassword(user.id, String(form.get("password")));
  await startSession(user.id);
  redirect("/admin");
}

export async function acceptInvitationAction(_prev: FormState, form: FormData): Promise<FormState> {
  const found = await findInvitation(String(form.get("token") ?? ""));
  if (found.state !== "ok") return { error: "This invitation isn't valid anymore. Ask for a new one." };
  const { invitation } = found;
  const name = text(form, "name", 80);
  if (!name) return { error: "Enter your name." };
  const problem = passwordProblem(form);
  if (problem) return { error: problem };
  if (await findUserByEmail(invitation.email)) return { error: `${invitation.email} already has an account. Sign in instead.` };
  const id = await createUser(invitation.email, name, invitation.role, String(form.get("password")));
  await markAccepted(invitation.id);
  await startSession(id);
  redirect("/admin");
}

export async function createOwnerAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (await ownerExists()) return { error: "This workspace already has an owner. Sign in instead." };
  // The first-run link's code, or a session from signing in with the setup password.
  const allowed = ownerSetupCodeMatches(String(form.get("code") ?? "")) || (await currentUser())?.id === 0;
  if (!allowed) return { error: "This setup link isn't valid. Sign in with the setup password (ADMIN_PASSWORD) instead." };
  const brand = text(form, "brand", 60);
  const name = text(form, "name", 80);
  if (!brand) return { error: "Enter your company or product name." };
  const email = text(form, "email", 200).toLowerCase();
  if (!name) return { error: "Enter your name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address." };
  const problem = passwordProblem(form);
  if (problem) return { error: problem };
  if (await findUserByEmail(email)) return { error: "That email already has an account. Sign in instead." };
  const id = await createUser(email, name, "owner", String(form.get("password")));
  await updateSettings({ brandName: brand });
  await startSession(id);
  redirect("/admin");
}
