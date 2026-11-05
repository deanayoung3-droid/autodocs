import { exchangeCode, OAUTH_HEADERS, OAuthError, oauthError, refreshTokens } from "@/lib/oauth";

// POST /oauth/token: trades an authorization code (with its PKCE verifier) or a refresh token for
// tokens. Takes the usual form encoding, or JSON.
export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  const params: Record<string, string> = type.includes("application/json")
    ? Object.fromEntries(Object.entries(((await req.json().catch(() => ({}))) as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v)]))
    : Object.fromEntries(new URLSearchParams(await req.text()));
  try {
    const clientId = params.client_id ?? "";
    if (!clientId) throw new OAuthError("invalid_client", "client_id is required.");
    if (params.grant_type === "authorization_code") {
      const tokens = await exchangeCode({ code: params.code ?? "", clientId, redirectUri: params.redirect_uri ?? "", verifier: params.code_verifier ?? "" });
      return Response.json(tokens, { headers: OAUTH_HEADERS });
    }
    if (params.grant_type === "refresh_token") {
      return Response.json(await refreshTokens(params.refresh_token ?? "", clientId), { headers: OAUTH_HEADERS });
    }
    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  } catch (err) {
    if (err instanceof OAuthError) return oauthError(err, err.code === "invalid_client" ? 401 : 400);
    throw err;
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_HEADERS });
}
