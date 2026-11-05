import { aiConfigured } from "@/lib/ai";
import { extensionAuth, revokeExtensionToken, signedOut } from "@/lib/extension";
import { publicOrigin } from "@/lib/integrations";
import { AGENT_NAME, PRODUCT_NAME } from "@/lib/product";
import { getSettings } from "@/lib/settings";

// GET: who the extension is signed in as, and the workspace's look. DELETE: signs this browser out.
export async function GET(req: Request) {
  const auth = await extensionAuth(req);
  if (!auth) return signedOut();
  const s = await getSettings();
  return Response.json({
    user: { name: auth.user.name, role: auth.user.role },
    workspace: { name: s.brandName, accent: s.accent, origin: publicOrigin(new URL(req.url).origin) },
    product: PRODUCT_NAME,
    agent: AGENT_NAME,
    aiReady: aiConfigured(),
  });
}

export async function DELETE(req: Request) {
  const auth = await extensionAuth(req);
  if (!auth) return signedOut();
  await revokeExtensionToken(auth.user.id, auth.tokenId);
  return Response.json({ ok: true });
}
