import "server-only";
import crypto from "node:crypto";
import { all, get, insert, run } from "./db";

export type ApiKey = { id: number; name: string; prefix: string; created_at: string; last_used_at: string | null };

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Creates a key. The full key is returned once; only its hash is stored. */
export async function createKey(name: string): Promise<{ id: number; key: string }> {
  const key = `cd_${crypto.randomBytes(24).toString("base64url")}`;
  const id = await insert("INSERT INTO api_keys (name, prefix, key_hash) VALUES ($1, $2, $3) RETURNING id", [
    name,
    key.slice(0, 9),
    sha256(key),
  ]);
  return { id, key };
}

export async function listKeys(): Promise<ApiKey[]> {
  return all<ApiKey>("SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE kind = 'api' ORDER BY id DESC");
}

export async function revokeKey(id: number) {
  await run("DELETE FROM api_keys WHERE id = $1 AND kind = 'api'", [id]);
}

/** Reads `Authorization: Bearer cd_…`. Returns the key, or null. */
export async function authenticateRequest(req: Request): Promise<ApiKey | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token?.startsWith("cd_")) return null;
  const row = await get<ApiKey>(
    `UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1 AND kind = 'api'
     RETURNING id, name, prefix, created_at, last_used_at`,
    [sha256(token)],
  );
  return row ?? null;
}

export const unauthorized = () =>
  Response.json({ error: "Send an API key as `Authorization: Bearer cd_…`. Create one in Settings → API." }, { status: 401 });
