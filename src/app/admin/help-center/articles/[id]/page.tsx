import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Mascot } from "@/components/mascot";
import { collectionTree, flattenTree, getArticle, listRevisions } from "@/lib/articles";
import { timeAgo } from "@/lib/format";
import { getVerification, issuesOf } from "@/lib/verification";
import { requireAdmin } from "@/lib/auth";
import { canManage } from "@/lib/users";
import { ArticleEditor } from "../../editor";

const SAVED: Record<string, string> = {
  save: "Saved.",
  restored: "Restored from Recently deleted.",
  publish: "Published. It's live in the help center.",
  unpublish: "Unpublished. The article is a draft again and hidden from the help center.",
  suggested: "Sent for review. An admin or owner approves it before it goes live.",
};

const SOURCES: Record<string, string> = { manual: "Edited", agent: "Docs Agent", seed: "Created", import: "Imported", bulk: "Find and replace" };

// Job: a person is editing one article, and next they publish it or go back to the tree.
export default async function EditArticlePage({ params, searchParams }: PageProps<"/admin/help-center/articles/[id]">) {
  await connection();
  const { id } = await params;
  const { saved } = await searchParams;
  const user = await requireAdmin();
  const article = await getArticle(Number(id));
  if (!article || article.deleted_at) notFound();
  const revisions = await listRevisions(article.id);
  const check = await getVerification(article.id);
  const issues = check ? issuesOf(check).length : 0;

  return (
    <div>
      <ArticleEditor
        key={article.updated_at}
        canPublish={canManage(user)}
        // node:sqlite rows have a null prototype; client components need plain objects.
        article={{
          id: article.id,
          slug: article.slug,
          title: article.title,
          summary: article.summary,
          body: article.body,
          collection_id: article.collection_id,
          status: article.status,
          restricted: article.restricted,
        }}
        collections={flattenTree(await collectionTree()).map((c) => ({ id: c.id, name: c.name, depth: c.depth, icon: c.icon }))}
        updated={`updated ${timeAgo(article.updated_at)}`}
        notice={
          typeof saved === "string" && SAVED[saved] ? (
            <p role="status" className="notice mb-6">
              {SAVED[saved]}
            </p>
          ) : undefined
        }
        meta={
          check?.checked_at ? (
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <Mascot size={14} mood={issues ? "thinking" : "happy"} />
              Reviewed by Docs Agent ·{" "}
              {issues ? (
                <Link href={`/admin/verification?article=${article.id}`} className="font-medium text-you-strong hover:underline">
                  {issues} {issues === 1 ? "issue" : "issues"}
                </Link>
              ) : check.status === "cant_verify" ? (
                "couldn't verify"
              ) : (
                <span className="text-success">up to date</span>
              )}{" "}
              · {timeAgo(check.checked_at)}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <Mascot size={14} mood="sleeping" /> Not verified yet
            </p>
          )
        }
      />

      <div className="mx-auto max-w-[760px] px-4 pb-16 md:px-8">
        <details className="border-t border-line-soft pt-6">
          <summary className="cursor-pointer text-sm font-medium text-graphite">
            History <span className="num font-normal text-muted">{revisions.length}</span>
          </summary>
          <ol className="mt-3 text-sm">
            {revisions.map((r) => (
              <li key={r.id} className="flex items-baseline gap-3 border-b border-line-soft py-2">
                <span className="w-24 shrink-0 text-muted">{timeAgo(r.created_at)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {SOURCES[r.source] ?? r.source}
                  {r.note && <span className="text-muted"> · {r.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        </details>
      </div>
    </div>
  );
}
