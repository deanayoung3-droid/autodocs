import { connection } from "next/server";
import { listDeletedArticles } from "@/lib/articles";
import { timeAgo } from "@/lib/format";
import { purgeArticleAction, restoreArticleAction } from "../../actions";
import { PageHeader } from "../../secondary";
import { SubmitButton } from "../../ui";

export default async function DeletedArticlesPage({ searchParams }: PageProps<"/admin/help-center/deleted">) {
  await connection();
  const { purged } = await searchParams;
  const rows = await listDeletedArticles();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-8">
      <PageHeader eyebrow="Help Center" title="Recently deleted" />
      <p className="mt-1 text-muted">Deleted articles stay here for 30 days, then they&rsquo;re removed for good.</p>

      {purged && (
        <p role="status" className="notice mt-4">
          Article permanently deleted.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-line-strong px-6 py-10 text-center text-muted">Nothing here.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.title}</span>
                <span className="block text-[13px] text-muted">
                  {a.collection_name ?? "No section"} · deleted {a.deleted_at ? timeAgo(a.deleted_at) : ""}
                </span>
              </span>
              <form action={restoreArticleAction}>
                <input type="hidden" name="id" value={a.id} />
                <SubmitButton className="btn h-8" pendingLabel="Restoring…">
                  Restore
                </SubmitButton>
              </form>
              <details className="relative">
                <summary className="btn btn-quiet btn-danger h-8 list-none">Delete forever</summary>
                <form action={purgeArticleAction} className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-line bg-surface p-3 shadow-lg">
                  <input type="hidden" name="id" value={a.id} />
                  <p className="mb-2 text-[13px]">This can&rsquo;t be undone.</p>
                  <SubmitButton className="btn btn-danger w-full" pendingLabel="Deleting…">
                    Delete “{a.title.slice(0, 24)}”
                  </SubmitButton>
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
