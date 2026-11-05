import "server-only";
import crypto from "node:crypto";
import { all, get, insert, run } from "./db";
import { adminOrigin } from "./integrations";
import { mailerReady, sendMail } from "./mailer";
import { PRODUCT_NAME } from "./product";
import { getSettings } from "./settings";
import { asRole, roleLabel, type Role, type User } from "./users";

// Invitations to the team: an email with a link to a page where the person sets
// their name and password. Links last a week; making a new one (or re-inviting) retires the old.

export const INVITE_DAYS = 7;

export type Invitation = { id: number; email: string; role: Role; invited_by_name: string; created_at: string; expires_at: string };

const COLUMNS = "id, email, role, invited_by_name, created_at, expires_at";
const digest = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const newToken = () => crypto.randomBytes(24).toString("base64url");
const typed = <T extends { role: string }>(row: T) => ({ ...row, role: asRole(row.role) });

/** `here` is the address the request came in on, used when the server has no PUBLIC_URL. */
export const invitationUrl = (token: string, here?: string) => `${adminOrigin(here)}/invite/${token}`;

export async function pendingInvitations(): Promise<Invitation[]> {
  const rows = await all<Invitation>(
    `SELECT ${COLUMNS} FROM invitations WHERE accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC`,
  );
  return rows.map(typed);
}

/** Invites an address (replacing any earlier invitation to it) and returns the link's token. */
export async function createInvitation(email: string, role: Role, by: User): Promise<string> {
  const token = newToken();
  await run("UPDATE invitations SET revoked_at = now() WHERE lower(email) = lower($1) AND accepted_at IS NULL AND revoked_at IS NULL", [email]);
  await insert(
    `INSERT INTO invitations (email, role, token_hash, invited_by, invited_by_name, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6)) RETURNING id`,
    [email.trim().toLowerCase(), role, digest(token), by.id, by.name, INVITE_DAYS],
  );
  return token;
}

/** A fresh link for a pending invitation, good for another week. The old link stops working. */
export async function renewInvitation(id: number): Promise<{ invitation: Invitation; token: string } | null> {
  const token = newToken();
  const row = await get<Invitation>(
    `UPDATE invitations SET token_hash = $1, expires_at = now() + make_interval(days => $2)
     WHERE id = $3 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING ${COLUMNS}`,
    [digest(token), INVITE_DAYS, id],
  );
  return row ? { invitation: typed(row), token } : null;
}

export async function revokeInvitation(id: number) {
  await run("UPDATE invitations SET revoked_at = now() WHERE id = $1 AND accepted_at IS NULL", [id]);
}

export type InvitationLookup = { state: "ok"; invitation: Invitation } | { state: "missing" | "expired" | "used" };

export async function findInvitation(token: string): Promise<InvitationLookup> {
  const row = await get<Invitation & { accepted_at: string | null; revoked_at: string | null; expired: boolean }>(
    `SELECT ${COLUMNS}, accepted_at, revoked_at, expires_at < now() AS expired FROM invitations WHERE token_hash = $1`,
    [digest(token)],
  );
  if (!row || row.revoked_at) return { state: "missing" };
  if (row.accepted_at) return { state: "used" };
  if (row.expired) return { state: "expired" };
  return { state: "ok", invitation: typed(row) };
}

export async function markAccepted(id: number) {
  await run("UPDATE invitations SET accepted_at = now() WHERE id = $1", [id]);
}

/** Emails the link when email delivery is set up. Returns whether it went out. */
export async function emailInvitation(email: string, role: Role, invitedBy: string, link: string): Promise<boolean> {
  if (!(await mailerReady())) return false;
  const { brandName } = await getSettings();
  await sendMail({
    to: email,
    subject: `Join ${brandName} on ${PRODUCT_NAME}`,
    text: `${invitedBy || "Your team"} invited you to ${brandName}'s help center on ${PRODUCT_NAME}, as ${roleLabel(role).toLowerCase()}.

Accept the invitation and choose your password:
${link}

The link works for ${INVITE_DAYS} days.`,
  });
  return true;
}
