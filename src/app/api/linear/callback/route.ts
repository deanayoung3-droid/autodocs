import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { readState } from "@/lib/crypto";
import { completeLinearOAuth } from "@/lib/linear";

// Linear sends the browser back here from its consent screen. The signed state proves the
// request started on our Connect button, and carries the exact redirect address Linear expects.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => new Response(null, { status: 303, headers: { Location: `/admin/integrations/linear?${q}` } });
  if (!(await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value))) return back("error=signin");
  if (url.searchParams.get("error")) return back("error=denied");
  const state = readState<{ purpose: string; origin: string }>(url.searchParams.get("state"));
  if (state?.purpose !== "linear-oauth") return back("error=state");
  const code = url.searchParams.get("code");
  if (!code) return back("error=nocode");
  try {
    await completeLinearOAuth(code, state.origin);
  } catch (err) {
    return back(`error=${encodeURIComponent(err instanceof Error ? err.message : "token")}`);
  }
  return back("connected=1");
}
