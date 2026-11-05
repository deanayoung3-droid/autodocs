import "server-only";
import { signState } from "./crypto";
import { all, get, run } from "./db";
import { adminOrigin, getIntegration, getSecrets, saveIntegration } from "./integrations";
import { PRODUCT_NAME } from "@/lib/product";

// Linear's agent platform: Docs Agent is installed in a Linear workspace as an app user people can
// @mention or assign. Each mention opens an "agent session" on the issue; Linear sends it here as
// a webhook, Docs Agent works on it as an ordinary thread, and posts what it's doing and the result back
// into the issue as agent activities.

// LINEAR_API_URL points at a test double. The authorize page is always linear.app.
const API = (process.env.LINEAR_API_URL || "https://api.linear.app").replace(/\/$/, "");
const AUTHORIZE = "https://linear.app/oauth/authorize";
const SCOPES = "read,write,app:assignable,app:mentionable";

export type LinearConfig = {
  organizationId?: string;
  organizationName?: string;
  urlKey?: string;
  appUserId?: string;
  appUserName?: string;
  scope?: string;
  /** The address the app was connected from; links posted into Linear point here. */
  origin?: string;
};

type LinearSecrets = {
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  accessToken?: string;
  refreshToken?: string;
  /** Milliseconds since the epoch. */
  expiresAt?: number;
};

export type LinearSessionRow = {
  session_id: string;
  run_id: number;
  issue_identifier: string;
  issue_title: string;
  issue_url: string;
  requested_by: string;
  created_at: string;
  status: string;
};

export async function linearConfig(): Promise<LinearConfig> {
  return (await getIntegration<LinearConfig>("linear"))?.config ?? {};
}

async function secrets(): Promise<LinearSecrets | null> {
  return getSecrets<LinearSecrets>("linear");
}

/** What the setup page shows: which credentials are saved, never their values. */
export async function linearSetupStatus() {
  const s = await secrets();
  return { clientId: s?.clientId ?? "", hasSecret: Boolean(s?.clientSecret), hasWebhookSecret: Boolean(s?.webhookSecret), authorized: Boolean(s?.accessToken) };
}

/**
 * Saves the OAuth application's credentials from Linear's settings. Blank fields keep what's
 * saved. A different client ID belongs to a different app, so the old authorization is dropped.
 */
export async function saveLinearCredentials(input: { clientId: string; clientSecret: string; webhookSecret: string }) {
  const current = await secrets();
  const sameApp = current?.clientId === input.clientId;
  const next: LinearSecrets = {
    clientId: input.clientId,
    clientSecret: input.clientSecret || (sameApp ? (current?.clientSecret ?? "") : ""),
    webhookSecret: input.webhookSecret || (sameApp ? (current?.webhookSecret ?? "") : ""),
    ...(sameApp ? { accessToken: current?.accessToken, refreshToken: current?.refreshToken, expiresAt: current?.expiresAt } : {}),
  };
  cached = null;
  await saveIntegration("linear", { secrets: next, ...(sameApp ? {} : { connected: false }) });
}

/** Linear's consent screen, asking to install the app as an agent people can mention and assign. */
export async function authorizeUrl(origin: string): Promise<string | null> {
  const s = await secrets();
  if (!s?.clientId) return null;
  const q = new URLSearchParams({
    client_id: s.clientId,
    redirect_uri: `${origin}/api/linear/callback`,
    response_type: "code",
    scope: SCOPES,
    actor: "app",
    prompt: "consent",
    state: signState({ purpose: "linear-oauth", origin }),
  });
  return `${AUTHORIZE}?${q}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string | string[] };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Linear didn't issue a token: ${data.error_description || data.error || res.status}.`);
  }
  return data;
}

function withToken(s: LinearSecrets, t: TokenResponse): LinearSecrets {
  return {
    ...s,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? s.refreshToken,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined,
  };
}

/** Finishes the consent screen: trades the code for tokens and records which workspace Docs Agent joined. */
export async function completeLinearOAuth(code: string, origin: string): Promise<LinearConfig> {
  const s = await secrets();
  if (!s?.clientId || !s.clientSecret) throw new Error("Save the Linear app's client ID and secret first.");
  const t = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${origin}/api/linear/callback`,
    client_id: s.clientId,
    client_secret: s.clientSecret,
  });
  const next = withToken(s, t);
  const who = await gqlWith<{ viewer: { id: string; name: string; displayName?: string }; organization: { id: string; name: string; urlKey: string } }>(
    next.accessToken!,
    "query { viewer { id name displayName } organization { id name urlKey } }",
  );
  const config: LinearConfig = {
    organizationId: who.organization.id,
    organizationName: who.organization.name,
    urlKey: who.organization.urlKey,
    appUserId: who.viewer.id,
    appUserName: who.viewer.displayName || who.viewer.name,
    scope: Array.isArray(t.scope) ? t.scope.join(",") : (t.scope ?? SCOPES),
    origin,
  };
  await saveIntegration("linear", { config, secrets: next, connected: true });
  cached = null;
  return config;
}

let cached: { token: string; expiresAt: number } | null = null;
let refreshing: Promise<string> | null = null;

/** A working access token, refreshed when it's within five minutes of expiring. */
async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.token;
  const s = await secrets();
  if (!s?.accessToken) throw new Error("Linear isn't connected. Connect it in Integrations → Linear.");
  if (!s.expiresAt || s.expiresAt - 5 * 60_000 > Date.now()) {
    cached = { token: s.accessToken, expiresAt: s.expiresAt ?? Date.now() + 60 * 60_000 };
    return s.accessToken;
  }
  if (!s.refreshToken) throw new Error("Linear's authorization expired. Reconnect Linear in Integrations.");
  refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: s.refreshToken, client_id: s.clientId, client_secret: s.clientSecret })
    .then(async (t) => {
      const next = withToken(s, t);
      await saveIntegration("linear", { secrets: next });
      cached = { token: next.accessToken!, expiresAt: next.expiresAt ?? Date.now() + 60 * 60_000 };
      return next.accessToken!;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function gqlWith<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) throw new Error("Linear rejected the authorization. Reconnect Linear in Integrations.");
  const data = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  if (data.errors?.length) throw new Error(`Linear: ${data.errors.map((e) => e.message).join("; ")}`);
  if (!res.ok || !data.data) throw new Error(`Linear returned ${res.status}.`);
  return data.data;
}

export async function linearQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  return gqlWith<T>(await accessToken(), query, variables);
}

/** The signing secret Linear uses for this app's webhooks. */
export async function linearWebhookSecret(): Promise<string | null> {
  return (await secrets())?.webhookSecret || null;
}

/** Forgets the authorization here and asks Linear to revoke it. The OAuth app's credentials stay. */
export async function disconnectLinear() {
  const s = await secrets();
  if (s?.accessToken) {
    await fetch(`${API}/oauth/revoke`, { method: "POST", headers: { Authorization: `Bearer ${s.accessToken}` } }).catch(() => undefined);
  }
  await linearRevoked();
}

/** The authorization is gone (disconnected here, or the app was uninstalled in Linear). Keeps the app's credentials so it can be reinstalled. */
export async function linearRevoked() {
  const s = await secrets();
  cached = null;
  if (s) await saveIntegration("linear", { secrets: { clientId: s.clientId, clientSecret: s.clientSecret, webhookSecret: s.webhookSecret }, connected: false });
  await run(
    "UPDATE integrations SET config = config - 'organizationId' - 'organizationName' - 'urlKey' - 'appUserId' - 'appUserName' - 'scope' WHERE kind = 'linear'",
  );
}

// Agent activities ------------------------------------------------------------------------------

type ActivityContent =
  | { type: "thought"; body: string }
  | { type: "action"; action: string; parameter: string; result?: string }
  | { type: "response"; body: string }
  | { type: "error"; body: string }
  | { type: "elicitation"; body: string };

/** Posts to the issue's agent session. Thoughts and actions marked ephemeral are replaced by the next activity. */
export async function postActivity(sessionId: string, content: ActivityContent, ephemeral = false) {
  await linearQuery("mutation ($input: AgentActivityCreateInput!) { agentActivityCreate(input: $input) { success } }", {
    input: { agentSessionId: sessionId, content, ...(ephemeral ? { ephemeral: true } : {}) },
  });
}

/** Puts a link to the Docs Agent thread on the session in Linear. */
export async function linkSession(sessionId: string, url: string) {
  await linearQuery("mutation ($id: String!, $input: AgentSessionUpdateInput!) { agentSessionUpdate(id: $id, input: $input) { success } }", {
    id: sessionId,
    input: { externalUrls: [{ label: `Review in ${PRODUCT_NAME}`, url }] },
  });
}

/** Links a session to its thread. False when Linear redelivered a session already being worked on. */
export async function recordSession(row: { sessionId: string; runId: number; identifier: string; title: string; url: string; requestedBy: string }): Promise<boolean> {
  const inserted = await get<{ session_id: string }>(
    `INSERT INTO linear_sessions (session_id, run_id, issue_identifier, issue_title, issue_url, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (session_id) DO NOTHING RETURNING session_id`,
    [row.sessionId, row.runId, row.identifier, row.title, row.url, row.requestedBy],
  );
  return Boolean(inserted);
}

export async function sessionById(sessionId: string): Promise<LinearSessionRow | undefined> {
  return get<LinearSessionRow>("SELECT s.*, r.status FROM linear_sessions s JOIN agent_runs r ON r.id = s.run_id WHERE s.session_id = $1", [sessionId]);
}

export async function recentLinearSessions(limit = 10): Promise<LinearSessionRow[]> {
  return all<LinearSessionRow>("SELECT s.*, r.status FROM linear_sessions s JOIN agent_runs r ON r.id = s.run_id ORDER BY s.created_at DESC LIMIT $1", [limit]);
}

export function threadUrl(origin: string | undefined, runId: number): string {
  return `${adminOrigin(origin)}/admin/agent/${runId}`;
}

/**
 * For a thread that came from Linear: reports progress into the issue while Docs Agent works, and the
 * result when it's done. Reporting never fails the thread; Linear being unreachable only means
 * the update is missing there.
 */
export async function linearReporter(runId: number) {
  const row = await get<{ session_id: string }>("SELECT session_id FROM linear_sessions WHERE run_id = $1 ORDER BY created_at DESC LIMIT 1", [runId]);
  if (!row) return null;
  const sessionId = row.session_id;
  const { origin } = await linearConfig();
  const link = threadUrl(origin, runId);
  let last = 0;
  const quietly = (p: Promise<unknown>) => p.catch((err) => console.warn(`[linear] session ${sessionId}: ${err instanceof Error ? err.message : err}`));
  return {
    /** A working step, shown in Linear as a passing thought (at most one every two seconds). */
    step(label: string) {
      if (Date.now() - last < 2000) return;
      last = Date.now();
      void quietly(postActivity(sessionId, { type: "thought", body: label }, true));
    },
    async finished(summary: string, proposals: { title: string; action: "update" | "create" }[]) {
      const list = proposals.map((p) => `- ${p.action === "update" ? "Updated" : "New article:"} **${p.title}**`).join("\n");
      const body = proposals.length
        ? `${summary}\n\n${list}\n\nNothing is published until someone approves it. [Review the ${proposals.length === 1 ? "draft" : "drafts"}](${link})`
        : `${summary}\n\n[Open the thread](${link})`;
      await quietly(postActivity(sessionId, { type: "response", body }));
    },
    async failed(message: string) {
      await quietly(postActivity(sessionId, { type: "error", body: `I couldn't finish: ${message}\n\n[Open the thread](${link})` }));
    },
  };
}
