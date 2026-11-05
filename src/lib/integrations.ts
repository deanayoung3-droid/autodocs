import "server-only";
import { seal, unseal } from "./crypto";
import { get, run } from "./db";
import type { HelpdeskId } from "./helpdesks";

export type IntegrationKind = "github" | "linear" | "slack" | "slack-alerts" | "slack-dms" | "support" | "inbox" | "email" | "capture" | HelpdeskId;

export type Integration<C = Record<string, unknown>> = {
  kind: IntegrationKind;
  label: string;
  description: string;
  config: C;
  connected_at: string | null;
  updated_at: string;
};

/** The integration's settings, or undefined if it was never set up. Secrets are read separately. */
export async function getIntegration<C = Record<string, unknown>>(kind: IntegrationKind): Promise<Integration<C> | undefined> {
  return get<Integration<C>>("SELECT kind, label, description, config, connected_at, updated_at FROM integrations WHERE kind = $1", [kind]);
}

export async function getSecrets<S = Record<string, string>>(kind: IntegrationKind): Promise<S | null> {
  const row = await get<{ secrets: string | null }>("SELECT secrets FROM integrations WHERE kind = $1", [kind]);
  const text = row?.secrets ? unseal(row.secrets, `integration:${kind}`) : null;
  return text ? (JSON.parse(text) as S) : null;
}

/** Merges config (and replaces secrets, when given). Creates the row on first use. */
export async function saveIntegration(
  kind: IntegrationKind,
  patch: { config?: Record<string, unknown>; secrets?: Record<string, unknown> | null; connected?: boolean },
) {
  await run(
    `INSERT INTO integrations (kind, config, secrets, connected_at) VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END)
     ON CONFLICT (kind) DO UPDATE SET
       config = integrations.config || excluded.config,
       secrets = CASE WHEN $5 THEN excluded.secrets ELSE integrations.secrets END,
       connected_at = CASE WHEN $4 THEN coalesce(integrations.connected_at, now())
                           WHEN $6 THEN NULL ELSE integrations.connected_at END,
       updated_at = now()`,
    [
      kind,
      JSON.stringify(patch.config ?? {}),
      patch.secrets ? seal(JSON.stringify(patch.secrets), `integration:${kind}`) : null,
      patch.connected === true,
      patch.secrets !== undefined,
      patch.connected === false,
    ],
  );
}

/** Label and team note shown on the connection's page. */
export async function saveIntegrationDetails(kind: IntegrationKind, label: string, description: string) {
  await run(
    `INSERT INTO integrations (kind, label, description) VALUES ($1, $2, $3)
     ON CONFLICT (kind) DO UPDATE SET label = excluded.label, description = excluded.description, updated_at = now()`,
    [kind, label, description],
  );
}

/** Forgets a connection entirely: credentials, settings, and label. */
export async function removeIntegration(kind: IntegrationKind) {
  await run("DELETE FROM integrations WHERE kind = $1", [kind]);
}

/** The address this server is reached at, for OAuth redirects and webhook URLs. */
export function publicOrigin(fallback?: string): string {
  return (process.env.PUBLIC_URL?.replace(/\/$/, "") || fallback || "http://localhost:3000").replace(/\/$/, "");
}

/**
 * The address of the admin area: ADMIN_URL when the admin has its own domain (admin-docs.… next to
 * docs.…), otherwise the public address. Links people open while signed in, and sign-in redirects
 * back from GitHub and Linear, use this one, since the admin session cookie only lives there.
 */
export function adminOrigin(fallback?: string): string {
  return process.env.ADMIN_URL?.replace(/\/$/, "") || publicOrigin(fallback);
}

/** True when the server can receive webhooks from the internet (not localhost). */
export function reachableFromInternet(origin: string): boolean {
  const host = new URL(origin).hostname;
  return !/^(localhost|127\.|0\.0\.0\.0|\[::1\]|.*\.local$|.*\.localhost$)/.test(host);
}
