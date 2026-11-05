import { publicOrigin } from "@/lib/integrations";
import { OAUTH_HEADERS, protectedResourceMetadata } from "@/lib/oauth";

// Protected resource metadata (RFC 9728) for the MCP server, at the root and at
// /.well-known/oauth-protected-resource/api/mcp: which authorization server signs people in.
export function GET(req: Request) {
  return Response.json(protectedResourceMetadata(publicOrigin(new URL(req.url).origin)), { headers: OAUTH_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_HEADERS });
}
