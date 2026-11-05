import { aiConfigured } from "@/lib/ai";
import { hmacMatches } from "@/lib/crypto";
import { disconnectGitHub, forgetDeletedBranch, githubConfig, productionBranch, syncRepositories, webhookSecret } from "@/lib/github-app";
import { enqueuePullRequest } from "@/lib/pr-intake";
import { getSettings } from "@/lib/settings";

// Deliveries from the GitHub App (or a manually added repository webhook). GitHub expects a reply
// within 10 seconds: a merged pull request is read now, and the agent's work is queued.
export async function POST(req: Request) {
  const secret = await webhookSecret();
  if (!secret) return Response.json({ error: "Connect GitHub in Integrations first." }, { status: 503 });
  const raw = await req.text();
  if (!hmacMatches(secret, raw, req.headers.get("x-hub-signature-256") ?? "")) {
    return Response.json({ error: "Signature doesn't match." }, { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  const payload = JSON.parse(raw);
  if (event === "ping") return Response.json({ ok: true });

  // The installation's repository access changed on GitHub.
  if (event === "installation_repositories" || (event === "installation" && payload.action !== "deleted")) {
    await syncRepositories();
    return Response.json({ synced: true });
  }
  if (event === "installation" && payload.action === "deleted") {
    if ((await githubConfig()).installationId === payload.installation?.id) await disconnectGitHub();
    return Response.json({ disconnected: true });
  }
  // A deleted production branch falls back to the default branch.
  if (event === "delete" && payload.ref_type === "branch") {
    await forgetDeletedBranch(payload.repository?.full_name ?? "", payload.ref);
    return Response.json({ ok: true });
  }
  if (event !== "pull_request") return Response.json({ ignored: `event ${event}` }, { status: 202 });

  const pr = payload.pull_request;
  if (payload.action !== "closed" || !pr?.merged) {
    return Response.json({ ignored: "not a merged pull request" }, { status: 202 });
  }

  const settings = await getSettings();
  const repo: string = payload.repository?.full_name ?? "";
  if (!settings.autoScreenPRs) return Response.json({ ignored: "automatic drafts are off" }, { status: 202 });
  const target = await productionBranch(repo);
  if (target) {
    if (!target.included) return Response.json({ ignored: `${repo} is ignored in this workspace` }, { status: 202 });
    if (pr.base?.ref !== target.branch) return Response.json({ ignored: `merged into ${pr.base?.ref}, not ${target.branch}` }, { status: 202 });
  } else if (settings.githubRepo && repo.toLowerCase() !== settings.githubRepo.toLowerCase()) {
    return Response.json({ ignored: `repository ${repo} is not connected` }, { status: 202 });
  }
  if (!aiConfigured()) return Response.json({ ignored: "No OpenAI API key on the server (Settings → AI)" }, { status: 202 });

  // Sorting (front end or back end, does it need docs) and drafting happen in the background;
  // a failure there is recorded as a thread, and the catch-up sweep covers missed deliveries.
  const number = Number(pr.number);
  await enqueuePullRequest(repo, number, "webhook");
  return Response.json({ queued: `${repo}#${number}` }, { status: 202 });
}
