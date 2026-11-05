"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createReaderLinkToken, createReaderToken, READER_COOKIE } from "@/lib/auth";
import { publicOrigin } from "@/lib/integrations";
import { mailerReady, sendMail } from "@/lib/mailer";
import { emailMayRead, getSettings } from "@/lib/settings";
import { checkSecret } from "@/lib/users";

export async function readerSignInAction(_prev: { error?: string } | undefined, form: FormData) {
  const { readerPasswordHash } = await getSettings();
  if (!readerPasswordHash) return { error: "Password sign-in isn't set up for this help center." };
  if (!checkSecret(String(form.get("password") ?? ""), readerPasswordHash)) {
    await new Promise((r) => setTimeout(r, 600));
    return { error: "That password isn't right." };
  }
  const h = await headers();
  (await cookies()).set(READER_COOKIE, await createReaderToken("password"), {
    httpOnly: true,
    sameSite: "lax",
    secure: h.get("x-forwarded-proto") === "https",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/help") ? next : "/help");
}

// A few links per address per quarter hour, per server instance, so the form can't be used to flood an inbox.
const sent = new Map<string, number[]>();

/**
 * Emails a sign-in link. The answer is the same whether or not the address may sign in, so the
 * form can't be used to find out who has access.
 */
export async function readerEmailLinkAction(_prev: { error?: string; ok?: string } | undefined, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter your email address." };
  const next = String(form.get("next") ?? "");
  const recent = (sent.get(email) ?? []).filter((t) => Date.now() - t < 15 * 60_000);
  if (emailMayRead((await getSettings()).readerEmailAllow, email) && (await mailerReady()) && recent.length < 3) {
    sent.set(email, [...recent, Date.now()]);
    const h = await headers();
    const origin = publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`);
    const link = `${origin}/help/auth/link?${new URLSearchParams({ token: await createReaderLinkToken(email), next: next.startsWith("/help") ? next : "/help" })}`;
    const { brandName } = await getSettings();
    await sendMail({
      to: email,
      subject: `Sign in to the ${brandName} help center`,
      text: `Use this link to sign in to the ${brandName} help center. It works for 15 minutes.\n\n${link}\n\nIf you didn't ask for it, you can ignore this email.`,
    }).catch((err) => console.error("[reader link]", err));
  }
  return { ok: `If ${email} can read this help center, a sign-in link is on its way. It works for 15 minutes.` };
}

export async function readerSignOutAction() {
  (await cookies()).delete(READER_COOKIE);
  redirect("/help");
}
