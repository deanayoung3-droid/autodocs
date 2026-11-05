import { ImageResponse } from "next/og";
import { Mascot } from "@/components/mascot";

// Docs Agent as a square PNG, for places that want an image file: the Linear app's icon, Slack, email.
export function GET() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%" }}>
        <Mascot size={512} />
      </div>
    ),
    { width: 512, height: 512, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
