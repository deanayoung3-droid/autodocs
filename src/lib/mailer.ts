import "server-only";
import nodemailer from "nodemailer";
import { getIntegration, getSecrets, saveIntegration } from "./integrations";

// Outgoing email: notifications when Docs Agent finishes, and Email Docs Agent's replies. Any SMTP service works
// (Google Workspace, SendGrid, Postmark, Mailgun, Amazon SES). Set it up in Settings → Email
// delivery, or with SMTP_URL (smtp://user:pass@host:587) and MAIL_FROM in the environment.

export type SmtpSettings = { host: string; port: number; user: string; from: string };
type SmtpSecrets = { password?: string; agentKey?: string; pipKey?: string };

async function settings(): Promise<{ smtp: SmtpSettings | null; password: string; source: "saved" | "environment" | null }> {
  const [meta, secrets] = await Promise.all([getIntegration<{ smtp?: SmtpSettings }>("email"), getSecrets<SmtpSecrets>("email")]);
  const saved = meta?.config.smtp;
  if (saved?.host && saved.from) return { smtp: saved, password: secrets?.password ?? "", source: "saved" };
  if (process.env.SMTP_URL && process.env.MAIL_FROM) {
    const u = new URL(process.env.SMTP_URL);
    return {
      smtp: { host: u.hostname, port: Number(u.port) || 587, user: decodeURIComponent(u.username), from: process.env.MAIL_FROM },
      password: decodeURIComponent(u.password),
      source: "environment",
    };
  }
  return { smtp: null, password: "", source: null };
}

export async function mailStatus() {
  const s = await settings();
  return { smtp: s.smtp, source: s.source };
}

export async function mailerReady(): Promise<boolean> {
  return Boolean((await settings()).smtp);
}

function transport(smtp: SmtpSettings, password: string) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: password } : undefined,
    connectionTimeout: 10_000,
  });
}

export async function saveSmtp(smtp: SmtpSettings, password: string) {
  const secrets = (await getSecrets<SmtpSecrets>("email")) ?? {};
  await saveIntegration("email", { config: { smtp }, secrets: { ...secrets, password: password || secrets.password }, connected: true });
}

export async function removeSmtp() {
  const secrets = (await getSecrets<SmtpSecrets>("email")) ?? {};
  await saveIntegration("email", { config: { smtp: {} }, secrets: { agentKey: secrets.agentKey ?? secrets.pipKey }, connected: false });
}

/** Checks the settings by connecting and signing in, without sending anything. */
export async function verifySmtp(smtp: SmtpSettings, password?: string) {
  const pass = password || (await getSecrets<SmtpSecrets>("email"))?.password || "";
  await transport(smtp, pass).verify();
}

export async function sendMail(m: { to: string; subject: string; text: string; replyTo?: string; inReplyTo?: string }) {
  const s = await settings();
  if (!s.smtp) throw new Error("Email delivery isn't set up. Add an SMTP server in Settings → Email delivery.");
  await transport(s.smtp, s.password).sendMail({
    from: s.smtp.from,
    to: m.to,
    subject: m.subject.replace(/[\r\n]+/g, " ").slice(0, 200),
    text: m.text,
    replyTo: m.replyTo,
    inReplyTo: m.inReplyTo,
    references: m.inReplyTo,
  });
}

/** The secret part of Email Docs Agent's inbound address. */
export async function emailAgentKey(rotate = false): Promise<string | null> {
  const secrets = (await getSecrets<SmtpSecrets>("email")) ?? {};
  const current = secrets.agentKey ?? secrets.pipKey; // pipKey: saved before the agent was renamed
  if (current && !rotate) return current;
  if (!rotate) return null;
  const key = (await import("node:crypto")).randomBytes(18).toString("base64url");
  await saveIntegration("email", { secrets: { password: secrets.password, agentKey: key } });
  return key;
}

export async function stopEmailAgent() {
  const secrets = (await getSecrets<SmtpSecrets>("email")) ?? {};
  await saveIntegration("email", { secrets: { password: secrets.password } });
}
