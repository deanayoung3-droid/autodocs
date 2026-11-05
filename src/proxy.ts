import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Pages and routes that need the admin session cookie, which only exists on the admin's address.
const ADMIN_PATHS = [
  "/admin",
  "/login",
  "/oauth/authorize",
  "/invite",
  "/welcome",
  "/api/admin/",
  "/api/github/manifest",
  "/api/github/setup",
  "/api/linear/connect",
  "/api/linear/callback",
  "/api/extension/download",
];
const isAdminPath = (path: string) => ADMIN_PATHS.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`));

const hostOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).host.toLowerCase() : "";
  } catch {
    return "";
  }
};

// The address the visitor used. request.url can carry the server's own listening address instead
// (0.0.0.0:8080 in the container), so redirects back to "here" are built from the headers.
function visitorOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/**
 * When ADMIN_URL gives the admin its own domain (admin-docs.… next to docs.…), each address only
 * serves its own half: the public one sends admin pages to the admin address, and the admin one
 * sends readers' pages to the public address. Any other address (Cloud Run's own, localhost) serves
 * everything, so the service can be tried before the domains point at it.
 */
function splitHosts(request: NextRequest): { redirect: NextResponse | null; onAdminHost: boolean } {
  const admin = hostOf(process.env.ADMIN_URL);
  const pub = hostOf(process.env.PUBLIC_URL);
  if (!admin || !pub || admin === pub) return { redirect: null, onAdminHost: false };
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").toLowerCase();
  const { pathname, search } = request.nextUrl;

  if (host === pub && isAdminPath(pathname)) {
    return { redirect: NextResponse.redirect(new URL(pathname + search, process.env.ADMIN_URL), 307), onAdminHost: false };
  }
  if (host !== admin) return { redirect: null, onAdminHost: false };
  if (pathname === "/robots.txt") {
    return { redirect: new NextResponse("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain" } }), onAdminHost: true };
  }
  if (pathname === "/") return { redirect: NextResponse.redirect(new URL("/admin", process.env.ADMIN_URL), 307), onAdminHost: true };
  // Readers' pages move to the public address, except inside the admin's own previews (iframes),
  // which stay on this address so they can talk to the page around them.
  const topLevel = (request.headers.get("sec-fetch-dest") ?? "document") === "document";
  if (topLevel && (pathname === "/help" || pathname.startsWith("/help/") || pathname === "/sitemap.xml" || pathname === "/llms.txt")) {
    return { redirect: NextResponse.redirect(new URL(pathname + search, process.env.PUBLIC_URL), 307), onAdminHost: true };
  }
  return { redirect: null, onAdminHost: true };
}

export async function proxy(request: NextRequest) {
  const { redirect, onAdminHost } = splitHosts(request);
  if (redirect) return redirect;
  const path = request.nextUrl.pathname;
  let res = NextResponse.next();
  // First gate for the admin area. Pages and actions also call requireAdmin().
  if ((path === "/admin" || path.startsWith("/admin/")) && !(await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value))) {
    res = NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(path)}`, visitorOrigin(request)), 307);
  }
  // The admin's address never shows up in search results.
  if (onAdminHost) res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export const config = {
  // Everything except build assets, which never depend on the address.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
