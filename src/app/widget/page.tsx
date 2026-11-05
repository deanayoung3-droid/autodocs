import { connection } from "next/server";
import { customerAiConfigured } from "@/lib/ai";
import { collectionTree, listArticles, popularArticles, restrictedCollectionIds, type CollectionNode } from "@/lib/articles";
import { getSettings } from "@/lib/settings";
import { fileUrl } from "@/lib/storage";
import { getWidget, listWidgets, recordWidgetEvent } from "@/lib/widgets";
import { WidgetPanel, type WidgetSection } from "./widget-panel";

// Rendered inside the iframe that /widget.js adds to a host page, and in the customizer's preview.
export default async function WidgetPage({ searchParams }: PageProps<"/widget">) {
  await connection();
  const { id, preview } = await searchParams;
  const settings = await getSettings();
  const widget = (await getWidget(Number(id))) ?? (await listWidgets())[0];
  const isPreview = preview === "1";
  if (!isPreview) await recordWidgetEvent(widget.id, "impression");

  // The top-level sections this widget shows (all, unless the Content panel picked some), each
  // with every public published article inside it, subsections included.
  const [tree, articles, hidden] = await Promise.all([collectionTree(), listArticles({ status: "published", order: "position" }), restrictedCollectionIds()]);
  const bySection = new Map<number, { slug: string; title: string }[]>();
  for (const a of articles) {
    if (a.restricted || (a.collection_id && hidden.has(a.collection_id)) || !a.collection_id) continue;
    bySection.set(a.collection_id, [...(bySection.get(a.collection_id) ?? []), { slug: a.slug, title: a.title }]);
  }
  const gather = (n: CollectionNode): { slug: string; title: string }[] => [...(bySection.get(n.id) ?? []), ...n.children.flatMap(gather)];
  const chosen = widget.settings.collections;
  const sections: WidgetSection[] = tree
    .filter((n) => !n.restricted && (!chosen.length || chosen.includes(n.id)))
    .map((n) => ({ id: n.id, name: n.name, articles: gather(n) }))
    .filter((x) => x.articles.length);

  return (
    <div className="h-dvh">
      <WidgetPanel
        widgetId={widget.id}
        initial={widget.settings}
        accent={settings.accent}
        workspaceLogo={settings.workspaceIcon ? fileUrl(settings.workspaceIcon) : ""}
        supportUrl={settings.supportUrl}
        aiAvailable={settings.aiAnswers && customerAiConfigured()}
        sections={sections}
        popular={(await popularArticles(6)).map((a) => ({ slug: a.slug, title: a.title }))}
        preview={isPreview}
      />
    </div>
  );
}
