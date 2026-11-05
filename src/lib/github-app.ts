import "server-only";
import crypto from "node:crypto";
import { SignJWT } from "jose";
import { signState } from "./crypto";
import { all, get, run, tx } from "./db";
import { adminOrigin, getIntegration, getSecrets, publicOrigin, reachableFromInternet, saveIntegration } from "./integrations";

// GitHub as a GitHub App: one click creates a private app for this workspace
// (GitHub's manifest flow), you install it on the repositories Docs Agent may read, and Docs Agent works with
// short-lived installation tokens. Merged pull requests arrive as app webhooks.

// GITHUB_API_URL points at GitHub Enterprise Server (https://HOST/api/v3) or a test double.
const API = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");

export type GitHubConfig = {
  appId?: number;
  slug?: string;
  appUrl?: string;
  owner?: string;
  installationId?: number;
  account?: string;
  accountType?: string;
};

type GitHubSecrets = { pem: string; webhookSecret: string; clientId: string; clientSecret: string };

export type RepoRow = {
  id: number;
  full_name: string;
  default_branch: string;
  production_branch: string | null;
  included: boolean;
  private: boolean;
};

export async function githubConfig(): Promise<GitHubConfig> {
  return (await getIntegration<GitHubConfig>("github"))?.config ?? {};
}

/**
 * The manifest GitHub uses to create the app. GitHub refuses webhook addresses it can't reach
 * (localhost), so the webhook is only declared once this server has a public address.
 */
export function appManifest(origin: string, name: string) {
  const live = reachableFromInternet(origin);
  return {
    name: name.slice(0, 34),
    url: origin,
    ...(live ? { hook_attributes: { url: `${origin}/api/github/webhook`, active: true } } : {}),
    redirect_url: `${adminOrigin(origin)}/api/github/manifest`,
    setup_url: `${adminOrigin(origin)}/api/github/setup`,
    setup_on_update: true,
    public: false,
    default_permissions: { contents: "read", metadata: "read", pull_requests: "read" },
    default_events: live ? ["pull_request", "delete", "release"] : [],
  };
}

/** Exchanges the one-time code GitHub sends after creating the app for its credentials. */
export async function completeManifest(code: string): Promise<GitHubConfig> {
  const res = await fetch(`${API}/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "autodocs" },
  });
  if (!res.ok) throw new Error(`GitHub didn't finish creating the app (${res.status}). Start again.`);
  const app = (await res.json()) as {
    id: number;
    slug: string;
    html_url: string;
    owner: { login: string };
    pem: string;
    webhook_secret: string;
    client_id: string;
    client_secret: string;
  };
  const config: GitHubConfig = { appId: app.id, slug: app.slug, appUrl: app.html_url, owner: app.owner.login };
  await saveIntegration("github", {
    config,
    secrets: { pem: app.pem, webhookSecret: app.webhook_secret, clientId: app.client_id, clientSecret: app.client_secret },
  });
  return config;
}

/** Where to send someone to install the app; the signed state ties the installation to this workspace. */
export async function installUrl(): Promise<string | null> {
  const c = await githubConfig();
  if (!c.slug) return null;
  return `https://github.com/apps/${c.slug}/installations/new?state=${encodeURIComponent(signState({ purpose: "github-install" }))}`;
}

async function appJwt(): Promise<string> {
  const [c, s] = await Promise.all([githubConfig(), getSecrets<GitHubSecrets>("github")]);
  if (!c.appId || !s?.pem) throw new Error("The GitHub App isn't set up. Connect GitHub in Integrations.");
  const now = Math.floor(Date.now() / 1000);
  // GitHub issues PKCS#1 keys; Node reads either format.
  return new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setIssuedAt(now - 60).setExpirationTime(now + 540).setIssuer(String(c.appId)).sign(crypto.createPrivateKey(s.pem));
}

async function asApp(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "autodocs", Authorization: `Bearer ${await appJwt()}` },
  });
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${path}.`);
  return res.json();
}

/** Records an installation after GitHub sends someone back from installing the app. */
export async function completeInstallation(installationId: number) {
  const inst = (await asApp(`/app/installations/${installationId}`)) as { id: number; account: { login: string; type: string } };
  await saveIntegration("github", {
    config: { installationId: inst.id, account: inst.account.login, accountType: inst.account.type },
    connected: true,
  });
  await syncRepositories();
}

let cachedToken: { value: string; expires: number; installation: number } | null = null;

/** A short-lived token for the installation, renewed five minutes before it expires. */
export async function installationToken(): Promise<string | null> {
  const c = await githubConfig();
  if (!c.installationId) return null;
  if (cachedToken && cachedToken.installation === c.installationId && cachedToken.expires - 5 * 60_000 > Date.now()) return cachedToken.value;
  const t = (await asApp(`/app/installations/${c.installationId}/access_tokens`, { method: "POST" })) as { token: string; expires_at: string };
  cachedToken = { value: t.token, expires: new Date(t.expires_at).getTime(), installation: c.installationId };
  return t.token;
}

/** The webhook secret GitHub signs deliveries with: the app's, or GITHUB_WEBHOOK_SECRET for a manual webhook. */
export async function webhookSecret(): Promise<string | null> {
  return (await getSecrets<GitHubSecrets>("github"))?.webhookSecret ?? process.env.GITHUB_WEBHOOK_SECRET ?? null;
}

/** Brings the repository list in line with what the installation can see. New repositories start included. */
export async function syncRepositories(): Promise<number> {
  const token = await installationToken();
  if (!token) return 0;
  const repos: { id: number; full_name: string; default_branch: string; private: boolean }[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${API}/installation/repositories?per_page=100&page=${page}`, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "autodocs", Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`GitHub returned ${res.status} listing repositories.`);
    const data = (await res.json()) as { repositories: typeof repos; total_count: number };
    repos.push(...data.repositories);
    if (repos.length >= data.total_count) break;
  }
  await tx(async () => {
    await run("DELETE FROM github_repos WHERE id <> ALL($1::bigint[])", [repos.map((r) => r.id)]);
    for (const r of repos) {
      await run(
        `INSERT INTO github_repos (id, full_name, default_branch, private) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name, default_branch = excluded.default_branch,
           private = excluded.private, updated_at = now()`,
        [r.id, r.full_name, r.default_branch, r.private],
      );
    }
  });
  return repos.length;
}

export async function listRepositories(): Promise<RepoRow[]> {
  return all<RepoRow>("SELECT id, full_name, default_branch, production_branch, included, private FROM github_repos ORDER BY full_name");
}

/** Repositories Docs Agent reads, in a stable order (the first is the default for research). */
export async function includedRepositories(): Promise<RepoRow[]> {
  return (await listRepositories()).filter((r) => r.included);
}

export async function setRepositoryIncluded(id: number, included: boolean) {
  await run("UPDATE github_repos SET included = $1, updated_at = now() WHERE id = $2", [included, id]);
}

/** null goes back to the repository's default branch. */
export async function setProductionBranch(id: number, branch: string | null) {
  await run("UPDATE github_repos SET production_branch = $1, updated_at = now() WHERE id = $2", [branch || null, id]);
}

/** The branch merges have to land on to count as shipped. */
export async function productionBranch(fullName: string): Promise<{ branch: string; included: boolean } | null> {
  const r = await get<RepoRow>("SELECT * FROM github_repos WHERE lower(full_name) = lower($1)", [fullName]);
  return r ? { branch: r.production_branch || r.default_branch, included: r.included } : null;
}

/** A deleted branch can't be the production branch any more; fall back to the default. */
export async function forgetDeletedBranch(fullName: string, branch: string) {
  await run("UPDATE github_repos SET production_branch = NULL WHERE lower(full_name) = lower($1) AND production_branch = $2", [fullName, branch]);
}

export async function listBranches(fullName: string): Promise<string[]> {
  const token = await installationToken();
  if (!token) return [];
  const res = await fetch(`${API}/repos/${fullName}/branches?per_page=100`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "autodocs", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return ((await res.json()) as { name: string }[]).map((b) => b.name);
}

/** Forgets the installation here. The app itself stays on GitHub until you uninstall or delete it there. */
export async function disconnectGitHub() {
  cachedToken = null;
  await tx(async () => {
    await run("DELETE FROM github_repos");
    await run("UPDATE integrations SET connected_at = NULL, config = config - 'installationId' - 'account' - 'accountType' WHERE kind = 'github'");
  });
}

export function manifestFormAction(org: string): string {
  const base = org.trim() ? `https://github.com/organizations/${encodeURIComponent(org.trim())}/settings/apps/new` : "https://github.com/settings/apps/new";
  return `${base}?state=${encodeURIComponent(signState({ purpose: "github-manifest" }))}`;
}

export { publicOrigin };
