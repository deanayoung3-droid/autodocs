import { cookies } from "next/headers";
import { createReaderToken, READER_COOKIE, readReaderLinkToken } from "@/lib/auth";
import { emailMayRead, getSettings } from "@/lib/settings";

// The emailed sign-in link: signs the reader in for 30 days, if the address may still read the help center.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = await readReaderLinkToken(url.searchParams.get("token") ?? "");
  const next = url.searchParams.get("next") ?? "/help";
  if (!email || !emailMayRead((await getSettings()).readerEmailAllow, email)) {
    return new Response(null, { status: 302, headers: { Location: `/help/signin?expired=1&next=${encodeURIComponent(next)}` } });
  }
  (await cookies()).set(READER_COOKIE, await createReaderToken(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return new Response(null, { status: 302, headers: { Location: next.startsWith("/help") ? next : "/help" } });
}
