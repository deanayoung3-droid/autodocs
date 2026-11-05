import { currentUser } from "@/lib/auth";
import { adminOrigin, publicOrigin } from "@/lib/integrations";
import { getClient, issueCode } from "@/lib/oauth";

// POST from the consent page: Allow issues a one-time code, Cancel reports access_denied, and
// either way the person goes back to the app.
export async function POST(req: Request) {
  // Only the consent page may approve. The session cookie is SameSite=Lax too, so other sites can't post as you.
  const from = req.headers.get("origin");
  const here = new URL(req.url).origin;
  // The consent page is on the admin's address when it has its own (see proxy.ts).
  if (from && from !== here && from !== publicOrigin(here) && from !== adminOrigin(here)) return new Response("Forbidden", { status: 403 });

  const form = await req.formData();
  const v = (k: string) => String(form.get(k) ?? "");
  const client = await getClient(v("client_id"));
  if (!client || !client.redirect_uris.includes(v("redirect_uri"))) return new Response("This connection link isn't valid. Start again from the app.", { status: 400 });
  const user = await currentUser();
  if (!user) return new Response(null, { status: 303, headers: { Location: "/login" } });

  const back = new URL(v("redirect_uri"));
  if (v("decision") === "allow" && v("code_challenge")) back.searchParams.set("code", await issueCode(user, client, v("redirect_uri"), v("code_challenge")));
  else back.searchParams.set("error", "access_denied");
  if (v("state")) back.searchParams.set("state", v("state"));
  return new Response(null, { status: 303, headers: { Location: back.toString(), "Cache-Control": "no-store" } });
}
