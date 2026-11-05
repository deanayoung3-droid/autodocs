import { OAUTH_HEADERS, OAuthError, oauthError, registerClient } from "@/lib/oauth";

// POST /oauth/register: dynamic client registration (RFC 7591) for MCP clients.
export async function POST(req: Request) {
  try {
    const client = await registerClient(await req.json().catch(() => null));
    return Response.json(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: client.name,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      { status: 201, headers: OAUTH_HEADERS },
    );
  } catch (err) {
    if (err instanceof OAuthError) return oauthError(err);
    throw err;
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_HEADERS });
}
