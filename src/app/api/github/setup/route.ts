import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { readState } from "@/lib/crypto";
import { completeInstallation, githubConfig } from "@/lib/github-app";

// GitHub sends the browser here after the app is installed or its repository access changes.
// The signed state proves the install started from this workspace, so nobody can attach a
// different installation by sending someone a crafted link.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => new Response(null, { status: 303, headers: { Location: `/admin/integrations/github?${q}` } });
  if (!(await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value))) return back("error=signin");
  const id = Number(url.searchParams.get("installation_id"));
  const action = url.searchParams.get("setup_action");
  if (!Number.isInteger(id) || id <= 0) return back("error=noinstall");
  // Updates (repository access changed on GitHub) come without our state; the installation must already be ours.
  const signed = readState<{ purpose: string }>(url.searchParams.get("state"))?.purpose === "github-install";
  if (!signed && !(action === "update" && (await githubConfig()).installationId === id)) return back("error=state");
  try {
    await completeInstallation(id);
  } catch (err) {
    return back(`error=${encodeURIComponent(err instanceof Error ? err.message : "install")}`);
  }
  return back("connected=1");
}
