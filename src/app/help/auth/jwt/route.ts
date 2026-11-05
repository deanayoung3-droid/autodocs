import crypto from "node:crypto";
import { cookies } from "next/headers";
import { createReaderToken, READER_COOKIE } from "@/lib/auth";

// "Sign in with your product": your app signs a short-lived HS256 JWT with READER_JWT_SECRET
// and sends the reader to /help/auth/jwt?token=…&next=/help/some-article.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.READER_JWT_SECRET;
  const token = url.searchParams.get("token") ?? "";
  const next = url.searchParams.get("next") ?? "/help";
  const fail = (msg: string) => new Response(msg, { status: 401 });
  if (!secret) return fail("READER_JWT_SECRET is not set on the help center server.");

  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return fail("Malformed token.");
  const expected = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  if (expected.length !== s.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return fail("Bad signature.");
  let claims: { sub?: string; email?: string; exp?: number };
  try {
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    if (header.alg !== "HS256") return fail("Only HS256 tokens are accepted.");
    claims = JSON.parse(Buffer.from(p, "base64url").toString());
  } catch {
    return fail("Malformed token.");
  }
  if (!claims.exp || claims.exp < Date.now() / 1000) return fail("Token expired. Sign in again from the app.");

  (await cookies()).set(READER_COOKIE, await createReaderToken(claims.email ?? claims.sub ?? "reader"), {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return new Response(null, { status: 302, headers: { Location: next.startsWith("/help") ? next : "/help" } });
}
