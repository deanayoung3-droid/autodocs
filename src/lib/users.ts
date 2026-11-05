import "server-only";
import crypto from "node:crypto";
import { createResetToken, readResetToken } from "./auth";
import { all, get, insert, run } from "./db";

// Owners can do everything. Admins too, except deleting the workspace's content and making someone
// an owner. Contributors write and edit drafts and work with Docs Agent, but can't publish or change settings.
export type Role = "owner" | "admin" | "contributor";
export type User = { id: number; email: string; name: string; role: Role; created_at: string };

export const ROLES: { value: Role; label: string; blurb: string }[] = [
  { value: "owner", label: "Owner", blurb: "Everything, including deleting the workspace's content" },
  { value: "admin", label: "Admin", blurb: "Publish, manage the team, and change settings" },
  { value: "contributor", label: "Contributor", blurb: "Write drafts and work with Docs Agent; can't publish or change settings" },
];

export const roleLabel = (r: Role) => ROLES.find((x) => x.value === r)?.label ?? "Contributor";
export const asRole = (v: unknown): Role => (v === "owner" || v === "admin" ? v : "contributor");
/** Publishing, settings, integrations, and the team. */
export const canManage = (u: Pick<User, "role">) => u.role === "owner" || u.role === "admin";

/** The built-in owner who signs in with ADMIN_PASSWORD. */
export const BOOTSTRAP_OWNER: User = { id: 0, email: "", name: "Admin", role: "owner", created_at: "" };

function hash(password: string, salt = crypto.randomBytes(16).toString("hex")): string {
  const key = crypto.scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${key}`;
}

function check(password: string, stored: string): boolean {
  const [, salt, key] = stored.split("$");
  if (!salt || !key) return false;
  const given = Buffer.from(crypto.scryptSync(password, salt, 32).toString("hex"));
  const expected = Buffer.from(key);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export async function listUsers(): Promise<User[]> {
  return all<User>("SELECT id, email, name, role, created_at FROM users ORDER BY id");
}

export async function getUser(id: number): Promise<User | undefined> {
  if (id === 0) return BOOTSTRAP_OWNER;
  if (!Number.isInteger(id)) return undefined;
  return get<User>("SELECT id, email, name, role, created_at FROM users WHERE id = $1", [id]);
}

export async function createUser(email: string, name: string, role: Role, password: string): Promise<number> {
  return insert("INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id", [
    email.trim().toLowerCase(),
    name.trim(),
    role,
    hash(password),
  ]);
}

export async function setRole(id: number, role: Role) {
  await run("UPDATE users SET role = $1 WHERE id = $2", [role, id]);
}

export async function setPassword(id: number, password: string) {
  await run("UPDATE users SET password_hash = $1 WHERE id = $2", [hash(password), id]);
}

export async function deleteUser(id: number) {
  await run("DELETE FROM users WHERE id = $1", [id]);
}

/** Checks an email and password. Returns the user, or undefined. */
export async function authenticate(email: string, password: string): Promise<User | undefined> {
  const row = await get<User & { password_hash: string }>(
    "SELECT id, email, name, role, created_at, password_hash FROM users WHERE email = $1",
    [email.trim().toLowerCase()],
  );
  if (!row || !check(password, row.password_hash)) return undefined;
  return { id: row.id, email: row.email, name: row.name, role: row.role, created_at: row.created_at };
}

/** Same hashing for other secrets, like the help center reader password. */
export const hashSecret = (s: string) => hash(s);
export const checkSecret = (s: string, stored: string) => check(s, stored);

export async function findUserByEmail(email: string): Promise<User | undefined> {
  return get<User>("SELECT id, email, name, role, created_at FROM users WHERE email = $1", [email.trim().toLowerCase()]);
}

/** Whether anyone has an owner account yet (the built-in ADMIN_PASSWORD owner doesn't count). */
export async function ownerExists(): Promise<boolean> {
  return Boolean(await get("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1"));
}

/** The code in the first-run link that creates the owner account. deploy/gcp/owner-link.sh
    computes the same one, so the link proves the person was given the setup password
    (ADMIN_PASSWORD) without putting the password in a URL. */
function ownerSetupCode(): string | null {
  const password = process.env.ADMIN_PASSWORD;
  return password ? crypto.createHmac("sha256", password).update("autodocs-owner-setup").digest("hex") : null;
}

export function ownerSetupCodeMatches(code: string): boolean {
  const expected = ownerSetupCode();
  if (!expected || code.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected));
}

/* Password resets. The link carries a fingerprint of the password it replaces, so it works once:
   after the password changes, the fingerprint no longer matches. */

async function passwordFingerprint(id: number): Promise<string | null> {
  const row = await get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [id]);
  return row ? crypto.createHash("sha256").update(row.password_hash).digest("hex").slice(0, 16) : null;
}

export async function passwordResetToken(user: User): Promise<string> {
  return createResetToken(`${user.id}:${await passwordFingerprint(user.id)}`);
}

export async function userFromResetToken(token: string): Promise<User | undefined> {
  const subject = await readResetToken(token);
  const [id, print] = (subject ?? "").split(":");
  if (!id || !print || print !== (await passwordFingerprint(Number(id)))) return undefined;
  return getUser(Number(id));
}

export async function setName(id: number, name: string) {
  await run("UPDATE users SET name = $1 WHERE id = $2", [name, id]);
}
