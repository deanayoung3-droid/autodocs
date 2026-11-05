import { headers } from "next/headers";
import { connection } from "next/server";
import { HelpCenterPreview } from "../preview";
import { managerGate } from "../../managers-only";

// Job: a person is restyling the help center, and next they pick a panel on the left and watch the preview change.
export default async function CustomizePage() {
  await connection();
  const gate = await managerGate("the help center's design");
  if (gate) return gate;
  const h = await headers();
  const host = (process.env.PUBLIC_URL?.replace(/^https?:\/\//, "").replace(/\/$/, "") || h.get("host")) ?? "";
  return (
    <div className="dots flex h-dvh flex-col px-4 pt-4 pb-8 md:px-8">
      <HelpCenterPreview host={host} />
    </div>
  );
}
