import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { readState } from "@/lib/crypto";
import { completeManifest, installUrl } from "@/lib/github-app";

// GitHub sends the browser here after creating the app from our manifest, with a one-time code
// for the app's credentials. Next stop: installing the app on repositories.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => new Response(null, { status: 303, headers: { Location: `/admin/integrations/github?${q}` } });
  if (!(await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value))) return back("error=signin");
  if (readState<{ purpose: string }>(url.searchParams.get("state"))?.purpose !== "github-manifest") return back("error=state");
  const code = url.searchParams.get("code");
  if (!code) return back("error=nocode");
  try {
    await completeManifest(code);
  } catch (err) {
    return back(`error=${encodeURIComponent(err instanceof Error ? err.message : "create")}`);
  }
  const install = await installUrl();
  return install ? Response.redirect(install, 303) : back("created=1");
}
