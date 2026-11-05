import { connection } from "next/server";
import { collectionTree, flattenTree } from "@/lib/articles";
import { requireAdmin } from "@/lib/auth";
import { canManage } from "@/lib/users";
import { ArticleEditor } from "../../editor";

export default async function NewArticlePage({ searchParams }: PageProps<"/admin/help-center/articles/new">) {
  await connection();
  const sp = await searchParams;
  const user = await requireAdmin();
  return (
    <ArticleEditor
      article={null}
      canPublish={canManage(user)}
      collections={flattenTree(await collectionTree()).map((c) => ({ id: c.id, name: c.name, depth: c.depth, icon: c.icon }))}
      defaultCollection={Number(sp.collection) || null}
    />
  );
}
