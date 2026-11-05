import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { customerAiConfigured } from "@/lib/ai";
import { collectionTree } from "@/lib/articles";
import { publicOrigin } from "@/lib/integrations";
import { mailerReady } from "@/lib/mailer";
import { getSettings } from "@/lib/settings";
import { getWidget } from "@/lib/widgets";
import { managerGate } from "../../../managers-only";
import { Customizer } from "./customizer";

// Job: an owner is making the widget look and behave like their product; next they save and install it.
export default async function CustomizeWidgetPage({ params, searchParams }: PageProps<"/admin/widgets/[id]/customize">) {
  await connection();
  const gate = await managerGate("the widget");
  if (gate) return gate;
  const { id } = await params;
  const sp = await searchParams;
  const widget = await getWidget(Number(id));
  if (!widget) notFound();
  const h = await headers();
  const [s, tree, mail] = await Promise.all([getSettings(), collectionTree(), mailerReady()]);
  return (
    <Customizer
      widget={{ id: widget.id, name: widget.name, settings: widget.settings }}
      accent={s.accent}
      origin={publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`)}
      sections={tree.filter((n) => !n.restricted).map((n) => ({ id: n.id, name: n.name, articles: n.published }))}
      aiAvailable={s.aiAnswers && customerAiConfigured()}
      mailReady={mail}
      supportUrl={s.supportUrl}
      initialPanel={typeof sp.panel === "string" ? sp.panel : null}
    />
  );
}
