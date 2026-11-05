// Signed session cookies for the admin area and for help center readers. Web Crypto only,
// so it also runs in proxy.ts. Database lookups are imported lazily for the same reason.

export const SESSION_COOKIE = "autodocs_session";
export const READER_COOKIE = "autodocs_reader";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 14;

const enc = new TextEncoder();

function secret(): string {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
}

function toBase64Url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return toBase64Url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function adminPasswordConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export async function checkPassword(input: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  // Compare digests so the comparison time doesn't depend on the password length.
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(input)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return equal(toBase64Url(a), toBase64Url(b));
}

type TokenKind = "admin" | "reader" | "link" | "reset";

/** Token format: `${kind}.${subject}.${expiry}.${signature}`. */
async function createToken(kind: TokenKind, subject: string, maxAge = SESSION_MAX_AGE): Promise<string> {
  const exp = String(Math.floor(Date.now() / 1000) + maxAge);
  // Dots separate the parts, so the subject (often an email address) carries its own dots escaped.
  const body = `${kind}.${encodeURIComponent(subject).replace(/\./g, "%2E")}.${exp}`;
  return `${body}.${await sign(body)}`;
}

async function readToken(token: string | undefined, kind: TokenKind): Promise<string | null> {
  if (!token || !secret()) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== kind) return null;
  const [, subject, exp, sig] = parts;
  if (Number(exp) < Date.now() / 1000) return null;
  if (!equal(sig, await sign(`${kind}.${subject}.${exp}`))) return null;
  return decodeURIComponent(subject);
}

export function createSessionToken(userId: number): Promise<string> {
  return createToken("admin", String(userId));
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  return (await readToken(token, "admin")) !== null;
}

export function createReaderToken(identity: string): Promise<string> {
  return createToken("reader", identity, 60 * 60 * 24 * 30);
}

export function readReaderToken(token: string | undefined): Promise<string | null> {
  return readToken(token, "reader");
}

/** The emailed sign-in link for a reader: good for 15 minutes. */
export function createReaderLinkToken(email: string): Promise<string> {
  return createToken("link", email, 15 * 60);
}

export function readReaderLinkToken(token: string | undefined): Promise<string | null> {
  return readToken(token, "link");
}

/** A teammate's password reset link: good for an hour. users.ts ties it to the current password. */
export function createResetToken(subject: string): Promise<string> {
  return createToken("reset", subject, 60 * 60);
}

export function readResetToken(token: string | undefined): Promise<string | null> {
  return readToken(token, "reset");
}

/** For server components and actions. Redirects to the login page when signed out. */
export async function requireAdmin() {
  const { cookies } = await import("next/headers");
  const { redirect } = await import("next/navigation");
  const { getUser } = await import("./users");
  const subject = await readToken((await cookies()).get(SESSION_COOKIE)?.value, "admin");
  const user = subject === null ? undefined : await getUser(Number(subject));
  if (!user) return redirect("/login");
  return user;
}

/** The signed-in teammate, or null. For pages outside /admin that sign in on their own terms. */
export async function currentUser() {
  const { cookies } = await import("next/headers");
  const { getUser } = await import("./users");
  const subject = await readToken((await cookies()).get(SESSION_COOKIE)?.value, "admin");
  return subject === null ? null : ((await getUser(Number(subject))) ?? null);
}

/** For actions only owners and admins may take. Contributors get an error they can read. */
export async function requireManager() {
  const user = await requireAdmin();
  if (user.role !== "owner" && user.role !== "admin") throw new Error("Only admins and owners can change this. Ask one of them.");
  return user;
}

/** For owner-only actions: deleting the workspace's content, making someone an owner. */
export async function requireOwner() {
  const user = await requireAdmin();
  if (user.role !== "owner") throw new Error("Only owners can do this.");
  return user;
}

/** The signed-in help center reader (any admin counts as one), or null. */
export async function currentReader(): Promise<string | null> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  if (await verifySessionToken(jar.get(SESSION_COOKIE)?.value)) return "team";
  return readReaderToken(jar.get(READER_COOKIE)?.value);
}
