import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { customerAiConfigured } from "@/lib/ai";
import { collectionTree, listArticles, listRedirects, type CollectionNode } from "@/lib/articles";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { canManage } from "@/lib/users";
import { SubnavShell } from "../secondary";
import { HelpCenterNav, type CustomizeData, type TreeArticle, type TreeNode } from "./hc-nav";

export default async function HelpCenterLayout({ children }: LayoutProps<"/admin/help-center">) {
  await connection();
  const [s, user] = await Promise.all([getSettings(), requireAdmin()]);
  const h = await headers();
  const publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, "") || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;

  const byCollection = new Map<number | null, TreeArticle[]>();
  for (const a of await listArticles({ order: "position" })) {
    const key = a.collection_id ?? null;
    byCollection.set(key, [
      ...(byCollection.get(key) ?? []),
      { id: a.id, title: a.title, status: a.status, restricted: Boolean(a.restricted) },
    ]);
  }
  const toTree = (nodes: CollectionNode[]): TreeNode[] =>
    nodes.map((n) => ({
      id: n.id,
      name: n.name,
      icon: n.icon,
      restricted: Boolean(n.restricted),
      articles: byCollection.get(n.id) ?? [],
      children: toTree(n.children),
    }));

  // The Customize panels' data, only for people who can change it.
  const customize: CustomizeData | null = canManage(user)
    ? {
        settings: {
          brandName: s.brandName,
          accent: s.accent,
          logoUrl: s.logoUrl,
          supportUrl: s.supportUrl,
          headerLinks: s.headerLinks.map((l) => `${l.label} | ${l.url}`).join("\n"),
          footerLinks: s.footerLinks.map((l) => `${l.label} | ${l.url}`).join("\n"),
          showPoweredBy: s.showPoweredBy,
          helpColorScheme: s.helpColorScheme,
          aiAnswers: s.aiAnswers,
          contentActions: s.contentActions,
          seoTitle: s.seoTitle,
          seoDescription: s.seoDescription,
          customCss: s.customCss,
          customJs: s.customJs,
        },
        redirects: ((await listRedirects()) as TreeRedirect[]).map((r) => ({ id: r.id, from_path: r.from_path, to_path: r.to_path })),
        customerAi: customerAiConfigured(),
        publicUrl,
      }
    : null;

  return (
    <SubnavShell
      nav={
        <Suspense>
          <HelpCenterNav tree={toTree(await collectionTree())} unsorted={byCollection.get(null) ?? []} customize={customize} />
        </Suspense>
      }
    >
      {children}
    </SubnavShell>
  );
}

type TreeRedirect = { id: number; from_path: string; to_path: string };
