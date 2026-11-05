"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prepareRerun, queueThread, startThread } from "@/lib/agent";
import { AI_SETUP_HINT, aiConfigured } from "@/lib/ai";
import {
  createArticle,
  createCollection,
  deleteArticle,
  deleteCollection,
  getArticle,
  moveCollection,
  purgeArticle,
  restoreArticle,
  setArticleStatus,
  updateArticle,
  updateCollection,
  type ArticleStatus,
} from "@/lib/articles";
import { requireAdmin, requireManager, SESSION_COOKIE } from "@/lib/auth";
import { createReplaceThread } from "@/lib/bulk";
import { fetchPullRequest, parsePullRequestUrl, trimDiff } from "@/lib/github";
import { renderedDiff, renderMarkdown, type DiffBlock } from "@/lib/markdown";
import {
  addProposal,
  approveAllInThread,
  approveProposal,
  createThread,
  dismissThread,
  getProposal,
  getThread,
  rejectProposal,
  threadProposals,
} from "@/lib/proposals";
import { enqueue } from "@/lib/jobs";
import { updateSettings, type HeaderLink, type Settings } from "@/lib/settings";
import { canManage } from "@/lib/users";
import { getVerification, issuesOf, markNotAnIssue, queueVerification } from "@/lib/verification";

export type FormState = { error?: string; ok?: string } | undefined;

function text(form: FormData, key: string, max = 100_000): string {
  return String(form.get(key) ?? "")
    .trim()
    .slice(0, max);
}

/* Articles */

export async function saveArticleAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = Number(form.get("id")) || null;
  const intent = String(form.get("intent") ?? "save") as "save" | "publish" | "unpublish";
  const title = text(form, "title", 200);
  if (!title) return { error: "Give the article a title." };
  if (intent !== "save" && !canManage(user)) return { error: "Only admins and owners can publish. Save your draft and ask one of them." };

  let collectionId: number | null = Number(form.get("collection")) || null;
  if (form.get("collection") === "new") {
    const name = text(form, "newCollection", 80);
    if (!name) return { error: "Name the new section, or pick an existing one." };
    collectionId = await createCollection(name);
  }

  const input = {
    title,
    summary: text(form, "summary", 300),
    body: String(form.get("body") ?? ""),
    collectionId,
    slug: text(form, "slug", 80) || undefined,
    restricted: form.get("restricted") === "on",
  };

  let articleId: number;
  if (id) {
    const current = await getArticle(id);
    if (!current) return { error: "This article no longer exists." };
    // A contributor's edit to a live article goes to review instead of changing the live page.
    if (!canManage(user) && current.status === "published") {
      const runId = await createThread({ kind: "task", title: `${user.name} suggested an edit: ${title}`.slice(0, 200), author: user.name, status: "done" });
      await addProposal({
        runId,
        action: "update",
        articleId: id,
        collectionId: input.collectionId,
        title,
        summary: input.summary,
        body: input.body,
        baseBody: current.body,
        reason: `Suggested by ${user.name}.`,
      });
      redirect(`/admin/help-center/articles/${id}?saved=suggested`);
    }
    await updateArticle(id, input, "manual");
    articleId = id;
  } else {
    articleId = await createArticle(input, "draft", "manual");
  }
  const status: ArticleStatus | null = intent === "publish" ? "published" : intent === "unpublish" ? "draft" : null;
  if (status) await setArticleStatus(articleId, status);
  redirect(`/admin/help-center/articles/${articleId}?saved=${intent}`);
}

export async function deleteArticleAction(form: FormData) {
  await requireManager();
  const id = Number(form.get("id"));
  await deleteArticle(id);
  redirect(`/admin/help-center?deleted=${id}`);
}

export async function restoreArticleAction(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("id"));
  await restoreArticle(id);
  redirect(`/admin/help-center/articles/${id}?saved=restored`);
}

export async function purgeArticleAction(form: FormData) {
  await requireManager();
  await purgeArticle(Number(form.get("id")));
  redirect("/admin/help-center/deleted?purged=1");
}

export async function previewMarkdownAction(markdown: string): Promise<string> {
  await requireAdmin();
  return renderMarkdown(markdown.slice(0, 200_000));
}

export async function renderDiffAction(before: string, after: string): Promise<DiffBlock[]> {
  await requireAdmin();
  return renderedDiff(before.slice(0, 200_000), after.slice(0, 200_000));
}

/* Sections (collections) */

export async function saveCollectionAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const id = Number(form.get("id")) || null;
  const name = text(form, "name", 80);
  if (!name) return { error: "Name the section." };
  const fields = {
    name,
    description: text(form, "description", 300),
    icon: text(form, "icon", 24),
    parentId: Number(form.get("parent")) || null,
    restricted: form.get("restricted") === "on",
  };
  const savedId = id ?? await createCollection(name);
  await updateCollection(savedId, fields);
  redirect(`/admin/help-center/collections/${savedId}?saved=${id ? "section" : "created"}`);
}

export async function moveCollectionAction(form: FormData) {
  await requireAdmin();
  await moveCollection(Number(form.get("id")), form.get("direction") === "up" ? -1 : 1);
  redirect(`/admin/help-center/collections/${Number(form.get("id"))}?tab=settings`);
}

export async function deleteCollectionAction(form: FormData) {
  await requireManager();
  await deleteCollection(Number(form.get("id")));
  redirect("/admin/help-center?sectionDeleted=1");
}

/* Review */

export async function approveProposalAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (!canManage(await requireAdmin())) return { error: "Only admins and owners can publish changes. Ask one of them to approve it." };
  const id = Number(form.get("id"));
  const title = text(form, "title", 200);
  const body = String(form.get("body") ?? "").trim();
  if (!title) return { error: "The article needs a title." };
  if (!body) return { error: "The article body is empty." };
  let articleId: number;
  const runId = (await getProposal(id))?.run_id;
  try {
    articleId = await approveProposal(id, {
      title,
      summary: text(form, "summary", 300),
      body,
      collectionId: Number(form.get("collection")) || null,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't apply this change." };
  }
  redirect(returnTo(form, `approved=${articleId}`) ?? (await nextAfterDecision(runId, `approved=${articleId}`)));
}

export async function rejectProposalAction(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("id"));
  const p = await getProposal(id);
  await rejectProposal(id);
  const outcome = `rejected=${encodeURIComponent(p?.title ?? "")}`;
  redirect(returnTo(form, outcome) ?? (await nextAfterDecision(p?.run_id, outcome)));
}

/** A page inside the admin that asked to come back after a decision (Verification does). */
function returnTo(form: FormData, outcome: string): string | null {
  const to = String(form.get("returnTo") ?? "");
  if (!/^\/admin\/[\w/?=&.-]*$/.test(to) || to.includes("//")) return null;
  return `${to}${to.includes("?") ? "&" : "?"}${outcome}`;
}

/** After a decision, go to the thread's next open change, or back to Review. */
async function nextAfterDecision(runId: number | undefined, outcome: string): Promise<string> {
  if (runId) {
    const next = (await threadProposals(runId)).find((p) => p.status === "pending");
    if (next) return `/admin/review/${next.id}?${outcome}`;
  }
  return `/admin/review?${outcome}`;
}

export async function approveAllAction(form: FormData) {
  await requireManager();
  const runId = Number(form.get("runId"));
  const n = await approveAllInThread(runId);
  redirect(`/admin/agent/${runId}?approvedAll=${n}`);
}

export async function dismissThreadAction(form: FormData) {
  await requireAdmin();
  const runId = Number(form.get("runId"));
  await dismissThread(runId);
  redirect(`/admin/agent/${runId}`);
}

/* Agent */

function requireAI(): FormState {
  return aiConfigured() ? undefined : { error: AI_SETUP_HINT };
}

export async function startTaskAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const missing = requireAI();
  if (missing) return missing;
  const prompt = text(form, "prompt", 20_000);
  if (prompt.length < 8) return { error: "Describe the task in a sentence or two." };
  const id = await startThread({ kind: "task", prompt, startedBy: user.id });
  await queueThread(id);
  redirect(`/admin/agent/${id}`);
}

export async function startFromSourceAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const missing = requireAI();
  if (missing) return missing;
  const mode = String(form.get("mode"));
  let id: number;
  if (mode === "pr") {
    const parsed = parsePullRequestUrl(text(form, "prUrl", 500));
    if (!parsed) return { error: "Paste a pull request URL like https://github.com/owner/repo/pull/123." };
    let fetched;
    try {
      fetched = await fetchPullRequest(parsed.owner, parsed.repo, parsed.number);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Couldn't read that pull request." };
    }
    if (!fetched.diff.trim()) return { error: "That pull request has no reviewable changes (only generated or binary files)." };
    id = await startThread({
      kind: "pr",
      ref: `${fetched.pr.repo}#${fetched.pr.number}`,
      url: fetched.pr.url,
      title: fetched.pr.title,
      description: fetched.pr.body,
      diff: fetched.diff,
      omitted: fetched.omitted,
      startedBy: user.id,
    });
  } else if (mode === "diff") {
    const raw = String(form.get("diff") ?? "");
    if (!raw.trim()) return { error: "Paste a diff to analyze." };
    const { diff, omitted } = raw.includes("diff --git") ? trimDiff(raw) : { diff: raw, omitted: [] };
    id = await startThread({
      kind: "diff",
      ref: null,
      title: text(form, "title", 200) || "Pasted diff",
      description: text(form, "description", 10_000),
      diff,
      omitted,
      startedBy: user.id,
    });
  } else {
    return { error: "Choose what Docs Agent should read." };
  }
  await queueThread(id);
  redirect(`/admin/agent/${id}`);
}

export async function followUpAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const missing = requireAI();
  if (missing) return missing;
  const runId = Number(form.get("runId"));
  const message = text(form, "message", 10_000);
  const thread = await getThread(runId);
  if (!thread) return { error: "This thread no longer exists." };
  if (thread.status === "running") return { error: "The agent is still working. Wait for it to finish." };
  if (!message) return { error: "Tell Docs Agent what to change." };
  await prepareRerun(runId, message);
  await queueThread(runId);
  redirect(`/admin/agent/${runId}`);
}

export async function retryThreadAction(form: FormData) {
  await requireAdmin();
  const runId = Number(form.get("runId"));
  await prepareRerun(runId);
  await queueThread(runId);
  redirect(`/admin/agent/${runId}`);
}

export async function runAuditAction() {
  await requireManager();
  if (!aiConfigured()) redirect("/admin/agent?audit=nokey");
  await enqueue("audit", {}, { dedupeKey: "audit", maxAttempts: 1 });
  redirect("/admin/agent?audit=started");
}

export async function bulkReplaceAction(form: FormData) {
  await requireManager();
  const find = String(form.get("find") ?? "");
  const replace = String(form.get("replace") ?? "");
  if (!find) redirect("/admin/help-center/replace");
  const { runId } = await createReplaceThread(find, replace, {
    matchCase: form.get("matchCase") === "on",
    wholeWord: form.get("wholeWord") === "on",
    collectionId: Number(form.get("collection")) || null,
  });
  redirect(`/admin/agent/${runId}`);
}

/* Verification */

export async function verifyAction(form: FormData) {
  await requireAdmin();
  const target = String(form.get("article") ?? "all");
  const n = await queueVerification(target === "all" ? "all" : [Number(target)]);
  redirect(`/admin/verification?${target === "all" ? `queued=${n}` : `tab=all&article=${target}&queued=1`}`);
}

export async function notAnIssueAction(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("article"));
  await markNotAnIssue(id);
  redirect(`/admin/verification?article=${id}&tab=up_to_date`);
}

export async function verificationTaskAction(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("article"));
  const a = await getArticle(id);
  const row = await getVerification(id);
  if (!a || !aiConfigured()) redirect(`/admin/verification?article=${id}`);
  const issues = row ? issuesOf(row) : [];
  const runId = await startThread({
    kind: "task",
    title: `Fix “${a.title}”`,
    prompt: `Fix the article "${a.title}" (id ${a.id}). A verification check found:\n${row?.summary ?? ""}\n${issues
      .map((i) => `- It says: ${i.claim}\n  Actually: ${i.problem} (${i.evidence})`)
      .join("\n")}`,
  });
  await queueThread(runId);
  redirect(`/admin/agent/${runId}`);
}

/* Settings */

function accentOrError(v: string) {
  return /^#[0-9a-f]{6}$/.test(v) ? null : "Accent color must be a hex value like #7f56d9.";
}

export async function saveGeneralSettingsAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireManager();
  const brandName = text(form, "brandName", 60);
  const accent = text(form, "accent", 7).toLowerCase();
  const logoUrl = text(form, "logoUrl", 500);
  const supportUrl = text(form, "supportUrl", 500);
  if (!brandName) return { error: "Enter a name for the help center." };
  const accentError = accentOrError(accent);
  if (accentError) return { error: accentError };
  if (supportUrl && !/^(https?:\/\/|mailto:)/i.test(supportUrl)) {
    return { error: "Support link must start with https:// or mailto:." };
  }
  if (logoUrl && !/^(https?:\/\/|\/)/i.test(logoUrl)) return { error: "Logo must be a URL starting with https:// or /." };
  const headerLinks: HeaderLink[] = [];
  for (const line of text(form, "headerLinks", 2000).split("\n")) {
    if (!line.trim()) continue;
    const [label, url] = line.split("|").map((s) => s.trim());
    if (!label || !url || !/^(https?:\/\/|\/|mailto:)/i.test(url)) {
      return { error: `Header link "${line}" should look like: Label | https://example.com` };
    }
    headerLinks.push({ label, url });
  }
  await updateSettings({
    brandName,
    accent,
    logoUrl,
    supportUrl,
    headerLinks: headerLinks.slice(0, 6),
    showPoweredBy: form.get("showPoweredBy") === "on",
  });
  return { ok: "Settings saved." };
}

export async function saveAgentSettingsAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireManager();
  const githubRepo = text(form, "githubRepo", 200).replace(/^https?:\/\/github\.com\//i, "").replace(/\/$/, "");
  if (githubRepo && !/^[\w.-]+\/[\w.-]+$/.test(githubRepo)) return { error: "Enter the repository as owner/name." };
  const sensitivity = String(form.get("prSensitivity"));
  const audit = String(form.get("auditFrequency"));
  const perDay = Math.round(Number(form.get("verifyPerDay")));
  if (!Number.isFinite(perDay) || perDay < 1 || perDay > 200) return { error: "Checks per day must be between 1 and 200." };
  await updateSettings({
    githubRepo,
    autoScreenPRs: form.get("autoScreenPRs") === "on",
    prSensitivity: (["strict", "balanced", "eager"].includes(sensitivity) ? sensitivity : "balanced") as Settings["prSensitivity"],
    agentGuidance: text(form, "agentGuidance", 4000),
    auditFrequency: (["off", "weekly", "biweekly", "monthly"].includes(audit) ? audit : "off") as Settings["auditFrequency"],
    continuousVerification: form.get("continuousVerification") === "on",
    verifyPerDay: perDay,
  });
  return { ok: "Agent settings saved." };
}

export async function signOutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
