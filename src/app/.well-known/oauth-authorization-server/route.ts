import { publicOrigin } from "@/lib/integrations";
import { authorizationServerMetadata, OAUTH_HEADERS } from "@/lib/oauth";

// OAuth authorization server metadata (RFC 8414), where MCP clients find the sign-in endpoints.
export function GET(req: Request) {
  return Response.json(authorizationServerMetadata(publicOrigin(new URL(req.url).origin)), { headers: OAUTH_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_HEADERS });
}
