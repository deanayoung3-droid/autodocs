import "server-only";
import crypto from "node:crypto";

// Credentials stored in the database (integration tokens, app keys, saved sign-in sessions) are
// sealed with a key derived from SESSION_SECRET, so a copy of the database alone doesn't hand
// them over. Changing SESSION_SECRET means reconnecting integrations.

function key(purpose: string): Buffer {
  return crypto.createHash("sha256").update(`autodocs:${purpose}:${process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || ""}`).digest();
}

/** AES-256-GCM: iv, auth tag, and ciphertext, base64 encoded. */
export function seal(text: string, purpose = "secrets"): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(purpose), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

/** The sealed text, or null if it was sealed with another key or has been tampered with. */
export function unseal(sealed: string, purpose = "secrets"): string | null {
  try {
    const buf = Buffer.from(sealed, "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", key(purpose), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** A short-lived signed value for OAuth `state` parameters: proves the round trip started here. */
export function signState(payload: Record<string, unknown>, ttlSeconds = 15 * 60): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const sig = crypto.createHmac("sha256", key("state")).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readState<T extends Record<string, unknown>>(state: string | null): T | null {
  if (!state) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", key("state")).update(body).digest("base64url");
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    return data.exp >= Date.now() / 1000 ? data : null;
  } catch {
    return null;
  }
}

/** Constant-time HMAC-SHA256 check for webhook signatures (hex digests). */
export function hmacMatches(secret: string, body: string, signatureHex: string): boolean {
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(body).digest("hex"));
  const given = Buffer.from(signatureHex.replace(/^sha256=/, ""));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
