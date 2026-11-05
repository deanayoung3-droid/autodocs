import fs from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync, type Zippable } from "fflate";
import { ImageResponse } from "next/og";
import { Mascot } from "@/components/mascot";
import { requireAdmin } from "@/lib/auth";
import { slugify } from "@/lib/format";
import { publicOrigin } from "@/lib/integrations";
import { AGENT_NAME, PRODUCT_NAME } from "@/lib/product";
import { getSettings } from "@/lib/settings";

// The Chrome extension as a zip for "Load unpacked", made for this workspace: its address goes in
// config.js and the manifest's host permission, and Docs Agent's picture becomes the icons.
const SOURCE = path.join(process.cwd(), "extension");

export async function GET(req: Request) {
  await requireAdmin();
  const origin = publicOrigin(new URL(req.url).origin);
  const s = await getSettings();

  const files: Zippable = {};
  for (const name of await fs.readdir(SOURCE)) {
    if (name === "manifest.json" || name === "config.js") continue;
    files[name] = new Uint8Array(await fs.readFile(path.join(SOURCE, name)));
  }
  const manifest = JSON.parse(await fs.readFile(path.join(SOURCE, "manifest.json"), "utf8"));
  manifest.host_permissions = [`${origin}/*`];
  manifest.name = PRODUCT_NAME;
  files["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  files["config.js"] = strToU8(`self.AUTODOCS = ${JSON.stringify({ origin, product: PRODUCT_NAME, agent: AGENT_NAME, version: manifest.version })};\n`);

  const icons: Zippable = {};
  for (const size of [16, 32, 48, 128]) {
    icons[`${size}.png`] = new Uint8Array(await new ImageResponse(<Mascot size={size} />, { width: size, height: size }).arrayBuffer());
  }
  files.icons = icons;

  const name = `${slugify(s.brandName) || "workspace"}-${slugify(PRODUCT_NAME)}-chrome-extension.zip`;
  return new Response(zipSync(files, { level: 9 }), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
