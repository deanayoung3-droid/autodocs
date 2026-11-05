import { forwardingKeyMatches, readInbound, receiveEmail } from "@/lib/inbox";

const MAX_BYTES = 10 * 1024 * 1024;

// Incoming mail for the screenshot agent's test account, forwarded by an email service. The key
// in the address is the only credential, so it's long, random, and compared in constant time.
export async function POST(req: Request, ctx: RouteContext<"/api/inbox/[key]">) {
  const { key } = await ctx.params;
  if (!(await forwardingKeyMatches(key))) return Response.json({ error: "Unknown address." }, { status: 404 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return Response.json({ error: "Too large." }, { status: 413 });
  const email = await readInbound(req);
  if (!email) return Response.json({ error: "Empty message." }, { status: 400 });
  await receiveEmail(email);
  return Response.json({ ok: true });
}
