import "server-only";
import crypto from "node:crypto";
import { all, get, run } from "./db";
import { adminOrigin } from "./integrations";
import { PRODUCT_NAME } from "./product";
import { getUser, type User } from "./users";

// Sign-in for MCP clients that use OAuth (Claude on the web and desktop, ChatGPT), as the MCP
// authorization spec describes: the client registers itself (RFC 7591), sends the person to
// /oauth/authorize to approve it (PKCE with S256 only), and trades the code for an access token
// that lasts an hour and a refresh token that lasts 60 days. Each approval is one row in
// oauth_grants; deleting it signs that app out. Only hashes of codes and tokens are stored.

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const random = (prefix: string) => `${prefix}${crypto.randomBytes(24).toString("base64url")}`;
const ACCESS_SECONDS = 3600;

export class OAuthError extends Error {
  constructor(
    public code: "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type" | "invalid_client_metadata",
    message: string,
  ) {
    super(message);
  }
}

/** Responses the token and registration endpoints share: JSON, never cached, callable from browsers. */
export const OAUTH_HEADERS = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Protocol-Version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const oauthError = (err: OAuthError, status = 400) => Response.json({ error: err.code, error_description: err.message }, { status, headers: OAUTH_HEADERS });

export const mcpUrl = (origin: string) => `${origin}/api/mcp`;

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    // The consent page needs the admin session, so it lives on the admin's address.
    authorization_endpoint: `${adminOrigin(origin)}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  };
}

export function protectedResourceMetadata(origin: string) {
  return { resource: mcpUrl(origin), authorization_servers: [origin], bearer_methods_supported: ["header"], scopes_supported: ["mcp"], resource_name: PRODUCT_NAME };
}

/**
 * Where a client may send people back to: https anywhere, http only on this machine (local tools),
 * or a desktop app's own scheme (cursor://…). Never javascript:, data:, or file:.
 */
function allowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !["javascript:", "data:", "file:", "vbscript:", "blob:"].includes(u.protocol);
  } catch {
    return false;
  }
}

export type OAuthClient = { id: string; name: string; redirect_uris: string[] };

/** Dynamic client registration: anyone may register; nothing works until a teammate approves it. */
export async function registerClient(body: unknown): Promise<OAuthClient> {
  const b = (body && typeof body === "object" ? body : {}) as { redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown };
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String).slice(0, 10) : [];
  if (!uris.length || !uris.every(allowedRedirect)) {
    throw new OAuthError("invalid_client_metadata", "redirect_uris must be https URLs, http URLs on localhost, or an app's own scheme.");
  }
  if (b.token_endpoint_auth_method && b.token_endpoint_auth_method !== "none") {
    throw new OAuthError("invalid_client_metadata", "Only public clients (token_endpoint_auth_method \"none\") with PKCE are supported.");
  }
  // Registrations nobody approved within a day are dropped.
  await run("DELETE FROM oauth_clients c WHERE c.created_at < now() - interval '1 day' AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = c.id)");
  const client = { id: random("cdc_"), name: String(b.client_name ?? "").trim().slice(0, 80) || "An MCP client", redirect_uris: uris };
  await run("INSERT INTO oauth_clients (id, name, redirect_uris) VALUES ($1, $2, $3)", [client.id, client.name, JSON.stringify(client.redirect_uris)]);
  return client;
}

export async function getClient(id: string): Promise<OAuthClient | undefined> {
  if (!id.startsWith("cdc_")) return undefined;
  return get<OAuthClient>("SELECT id, name, redirect_uris FROM oauth_clients WHERE id = $1", [id]);
}

/** After the person approves: a code for this client, redirect, and PKCE challenge, good for ten minutes. */
export async function issueCode(user: User, client: OAuthClient, redirectUri: string, challenge: string): Promise<string> {
  const code = random("cda_");
  await run(
    `INSERT INTO oauth_grants (client_id, user_id, code_hash, code_challenge, redirect_uri, code_expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '10 minutes')`,
    [client.id, user.id, sha256(code), challenge, redirectUri],
  );
  return code;
}

type Tokens = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

async function issueTokens(grantId: number): Promise<Tokens> {
  const access = random("cdm_");
  const refresh = random("cdr_");
  await run(
    `UPDATE oauth_grants SET code_hash = NULL, code_challenge = NULL, access_hash = $2, access_expires_at = now() + interval '${ACCESS_SECONDS} seconds',
       refresh_hash = $3, refresh_expires_at = now() + interval '60 days' WHERE id = $1`,
    [grantId, sha256(access), sha256(refresh)],
  );
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: "mcp" };
}

const challengeOf = (verifier: string) => crypto.createHash("sha256").update(verifier).digest("base64url");

export async function exchangeCode(p: { code: string; clientId: string; redirectUri: string; verifier: string }): Promise<Tokens> {
  // A code works once: it's cleared before anything is checked, so a replay always fails.
  const g = await get<{ id: number; client_id: string; redirect_uri: string; code_challenge: string; expired: boolean }>(
    `UPDATE oauth_grants SET code_hash = NULL WHERE code_hash = $1
     RETURNING id, client_id, redirect_uri, code_challenge, code_expires_at < now() AS expired`,
    [sha256(p.code)],
  );
  const problem = !g
    ? "The code is unknown or was already used."
    : g.expired
      ? "The code expired. Connect again."
      : g.client_id !== p.clientId || g.redirect_uri !== p.redirectUri
        ? "The code was issued to a different client or redirect."
        : !p.verifier || challengeOf(p.verifier) !== g.code_challenge
          ? "The PKCE code_verifier doesn't match."
          : "";
  if (problem) {
    if (g) await run("DELETE FROM oauth_grants WHERE id = $1 AND access_hash IS NULL", [g.id]);
    throw new OAuthError("invalid_grant", problem);
  }
  return issueTokens(g!.id);
}

export async function refreshTokens(refreshToken: string, clientId: string): Promise<Tokens> {
  const g = await get<{ id: number; client_id: string; expired: boolean }>(
    "SELECT id, client_id, refresh_expires_at < now() AS expired FROM oauth_grants WHERE refresh_hash = $1",
    [sha256(refreshToken)],
  );
  if (!g || g.expired || g.client_id !== clientId) throw new OAuthError("invalid_grant", "The refresh token is unknown, expired, or belongs to another client.");
  return issueTokens(g.id);
}

/** The teammate an MCP request acts for, from its OAuth access token. Null if missing, unknown, or expired. */
export async function oauthUser(req: Request): Promise<User | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token?.startsWith("cdm_")) return null;
  const g = await get<{ user_id: number }>(
    "UPDATE oauth_grants SET last_used_at = now() WHERE access_hash = $1 AND access_expires_at > now() RETURNING user_id",
    [sha256(token)],
  );
  return g ? ((await getUser(g.user_id)) ?? null) : null;
}

export type ConnectedApp = { id: number; name: string; created_at: string; last_used_at: string | null };

/** Apps this person approved that still hold a sign-in. */
export async function connectedApps(userId: number): Promise<ConnectedApp[]> {
  return all<ConnectedApp>(
    `SELECT g.id, c.name, g.created_at, g.last_used_at FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id
     WHERE g.user_id = $1 AND g.refresh_hash IS NOT NULL AND g.refresh_expires_at > now() ORDER BY g.id DESC`,
    [userId],
  );
}

export async function disconnectApp(userId: number, id: number) {
  await run("DELETE FROM oauth_grants WHERE id = $1 AND user_id = $2", [id, userId]);
}
