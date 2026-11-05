import "server-only";
import crypto from "node:crypto";

// GITHUB_API_URL points at GitHub Enterprise Server (https://HOST/api/v3) or a test double.
const API = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");

// Files that never describe customer-facing behavior. Dropped before the diff
// reaches the model so tokens go to code that matters.
const IGNORED = [
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/,
  /(^|\/)(dist|build|vendor|node_modules|\.next|coverage)\//,
  /\.(min\.js|map|snap|png|jpe?g|gif|webp|ico|svg|pdf|woff2?|ttf|mp4|zip)$/i,
];

/** Diffs larger than this are cut at a file boundary; the omitted files are reported. */
const MAX_DIFF_CHARS = 250_000;

export type PullRequest = {
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  merged: boolean;
};

export function parsePullRequestUrl(input: string): { owner: string; repo: string; number: number } | null {
  const m = input.trim().match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/i);
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

/** The GitHub App's installation token when the app is connected; otherwise GITHUB_TOKEN, if set. */
async function token(): Promise<string | null> {
  const { installationToken } = await import("./github-app");
  return (await installationToken().catch(() => null)) ?? process.env.GITHUB_TOKEN ?? null;
}

async function github(path: string, accept: string): Promise<Response> {
  const t = await token();
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "autodocs", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    cache: "no-store",
  });
  if (res.status === 404) {
    throw new Error(
      t
        ? "GitHub couldn't find that. Check the address and that the GitHub App can read the repository."
        : "GitHub couldn't find that. For a private repository, connect GitHub in Integrations.",
    );
  }
  if (res.status === 401) throw new Error("GitHub rejected the credentials. Reconnect GitHub in Integrations.");
  if (res.status === 403) throw new Error("GitHub refused the request (rate limit or missing permission).");
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${path}.`);
  return res;
}

export async function fetchPullRequest(owner: string, repo: string, number: number) {
  const path = `/repos/${owner}/${repo}/pulls/${number}`;
  const [meta, diffRes] = await Promise.all([
    github(path, "application/vnd.github+json").then((r) => r.json()),
    // GitHub refuses diffs past a size limit (406); the pull request still counts, from its file list.
    github(path, "application/vnd.github.diff").catch(() => null),
  ]);
  const pr: PullRequest = {
    repo: `${owner}/${repo}`,
    number,
    url: meta.html_url,
    title: meta.title ?? "",
    body: meta.body ?? "",
    merged: Boolean(meta.merged),
  };
  const raw = diffRes ? await diffRes.text() : "";
  return {
    pr,
    base: String(meta.base?.ref ?? ""),
    author: (meta.user?.login as string | undefined) ?? null,
    mergedAt: (meta.merged_at as string | null) ?? null,
    files: await pullRequestFiles(path).catch(() => changedFiles(raw)),
    ...trimDiff(raw),
  };
}

/** Every file a pull request touches (GitHub lists up to 3,000), for sorting it by area. */
async function pullRequestFiles(path: string): Promise<string[]> {
  const files: string[] = [];
  for (let page = 1; page <= 30; page++) {
    const batch = (await (await github(`${path}/files?per_page=100&page=${page}`, "application/vnd.github+json")).json()) as { filename: string }[];
    files.push(...batch.map((f) => f.filename));
    if (batch.length < 100) break;
  }
  return files;
}

/** Removes ignored files and caps size. Returns the kept diff and what was left out. */
export function trimDiff(diff: string): { diff: string; omitted: string[] } {
  const files = diff.split(/^(?=diff --git )/m).filter(Boolean);
  const kept: string[] = [];
  const omitted: string[] = [];
  let size = 0;
  for (const f of files) {
    const name = f.match(/^diff --git a\/(\S+)/)?.[1] ?? "unknown file";
    if (IGNORED.some((re) => re.test(name))) {
      omitted.push(`${name} (generated or binary)`);
    } else if (size + f.length > MAX_DIFF_CHARS) {
      omitted.push(`${name} (diff too large)`);
    } else {
      kept.push(f);
      size += f.length;
    }
  }
  return { diff: kept.join(""), omitted };
}

export function changedFiles(diff: string): string[] {
  return [...diff.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]);
}

/* Codebase research. Needs the GitHub App (or GITHUB_TOKEN): code search requires authentication. */

const MAX_FILE_CHARS = 40_000;

/** With a personal token only: whether a single owner/name repository can be researched. */
export function canResearch(repo: string): boolean {
  return Boolean(process.env.GITHUB_TOKEN && /^[\w.-]+\/[\w.-]+$/.test(repo));
}

/** Every repository Docs Agent may read: the GitHub App's included ones, or the one repository set with a token. */
export async function researchRepos(): Promise<string[]> {
  const { includedRepositories } = await import("./github-app");
  const repos = (await includedRepositories().catch(() => [])).map((r) => r.full_name);
  if (repos.length) return repos;
  const { getSettings } = await import("./settings");
  const legacy = (await getSettings()).githubRepo;
  return canResearch(legacy) ? [legacy] : [];
}

export async function searchCode(repo: string, query: string): Promise<string> {
  const q = encodeURIComponent(`${query} repo:${repo}`);
  const res = await github(`/search/code?q=${q}&per_page=10`, "application/vnd.github.text-match+json");
  const data = (await res.json()) as {
    total_count: number;
    items: { path: string; text_matches?: { fragment: string }[] }[];
  };
  if (!data.items.length) return `No code matches "${query}".`;
  return [
    `${data.total_count} matches (showing ${data.items.length}):`,
    ...data.items.map(
      (i) =>
        `- ${i.path}${i.text_matches?.length ? `\n    ${i.text_matches[0].fragment.replace(/\s+/g, " ").slice(0, 240)}` : ""}`,
    ),
  ].join("\n");
}

export async function readFile(repo: string, filePath: string): Promise<string> {
  const clean = filePath.replace(/^\/+/, "");
  const res = await github(`/repos/${repo}/contents/${clean.split("/").map(encodeURIComponent).join("/")}`, "application/vnd.github.raw");
  const text = await res.text();
  return text.length > MAX_FILE_CHARS
    ? `${text.slice(0, MAX_FILE_CHARS)}\n\n[File truncated: showing the first ${MAX_FILE_CHARS} of ${text.length} characters.]`
    : text;
}

export async function listDirectory(repo: string, dirPath: string): Promise<string> {
  const clean = dirPath.replace(/^\/+|\/+$/g, "");
  const res = await github(`/repos/${repo}/contents/${clean}`, "application/vnd.github+json");
  const data = (await res.json()) as { name: string; type: string }[] | { type: string };
  if (!Array.isArray(data)) return `${clean} is a file, not a directory. Use read_file.`;
  return data.map((e) => `${e.type === "dir" ? "📁" : "  "} ${clean ? `${clean}/` : ""}${e.name}`).join("\n");
}

export type MergedPR = { number: number; title: string; body: string; url: string; author: string; merged_at: string; base: string };

export async function listMergedPullRequests(repo: string, since: Date): Promise<MergedPR[]> {
  const res = await github(
    `/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`,
    "application/vnd.github+json",
  );
  const data = (await res.json()) as {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    merged_at: string | null;
    user: { login: string } | null;
    base: { ref: string } | null;
  }[];
  return data
    .filter((p) => p.merged_at && new Date(p.merged_at) >= since)
    .map((p) => ({
      number: p.number,
      title: p.title,
      body: (p.body ?? "").slice(0, 1500),
      url: p.html_url,
      author: p.user?.login ?? "",
      merged_at: p.merged_at!,
      base: p.base?.ref ?? "",
    }));
}

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
