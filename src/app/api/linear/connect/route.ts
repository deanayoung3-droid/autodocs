import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { adminOrigin } from "@/lib/integrations";
import { authorizeUrl } from "@/lib/linear";

// "Connect Linear": sends an admin to Linear's consent screen to install Docs Agent as an agent.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => new Response(null, { status: 303, headers: { Location: `/admin/integrations/linear?${q}` } });
  if (!(await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value))) return back("error=signin");
  const target = await authorizeUrl(adminOrigin(url.origin));
  return target ? Response.redirect(target, 303) : back("error=credentials");
}
