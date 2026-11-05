import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { collectionPath, collectionTree, flattenTree, getArticle } from "@/lib/articles";
import { timeAgo } from "@/lib/format";
import { renderedDiff, renderMarkdown } from "@/lib/markdown";
import { getProposal, threadProposals } from "@/lib/proposals";
import { ReviewPanel } from "./review-panel";

// Job: a person is deciding whether the agent's proposed change is right, and next they approve or reject it.
export default async function ReviewProposalPage({ params, searchParams }: PageProps<"/admin/review/[id]">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const p = await getProposal(Number(id));
  if (!p) notFound();

  const article = p.article_id ? await getArticle(p.article_id) : undefined;
  const warnings: string[] = [];
  if (p.action === "update" && (!article || article.deleted_at)) {
    warnings.push("The article this updates was deleted. Approving creates it as a new article.");
  } else if (article && p.base_body !== null && article.body !== p.base_body) {
    warnings.push(
      "Someone edited this article after the agent proposed this change. The comparison is against the current text; approving replaces those edits.",
    );
  }
  const decided = p.status !== "pending";
  const open = (await threadProposals(p.run_id)).filter((x) => x.status === "pending");
  const index = open.findIndex((x) => x.id === p.id);
  const base = article && !article.deleted_at ? article.body : null;
  const sectionPath = (await collectionPath(article?.collection_id ?? p.collection_id))
    .map((c) => c.name)
    .join(" / ");

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
        <Link href={`/admin/agent/${p.run_id}`} className="min-w-0 truncate text-muted hover:text-ink">
          ← {p.run_title}
        </Link>
        {open.length > 1 && index >= 0 && (
          <span className="flex items-center gap-1 text-muted">
            <span className="num">
              {index + 1} of {open.length}
            </span>
            {index > 0 && (
              <Link href={`/admin/review/${open[index - 1].id}`} className="btn btn-quiet h-7 px-2">
                Previous
              </Link>
            )}
            {index < open.length - 1 && (
              <Link href={`/admin/review/${open[index + 1].id}`} className="btn btn-quiet h-7 px-2">
                Next
              </Link>
            )}
          </span>
        )}
      </div>

      {(sp.approved || typeof sp.rejected === "string") && (
        <p role="status" className="notice mt-4">
          {sp.approved ? "Published the previous change." : "Rejected the previous change."} Here&rsquo;s the next one.
        </p>
      )}

      <header className="mt-4 mb-5">
        <p className="text-[13px] text-muted">
          {p.action === "create" ? "New article" : "Edit"}
          {sectionPath && ` · ${sectionPath}`}
        </p>
        <h1 className="title mt-1">{p.title}</h1>
        <p className="mt-3 max-w-2xl text-graphite">{p.reason}</p>
        {p.outdated_quote && (
          <p className="mt-3 max-w-2xl border-l-2 border-line-strong pl-3 text-[13px] text-muted">
            Out of date: <span className="italic">“{p.outdated_quote}”</span>
          </p>
        )}
        <p className="mt-2 text-[13px] text-muted">Proposed {timeAgo(p.created_at)}</p>
      </header>

      {decided ? (
        <p className="notice">
          This proposal was {p.status === "superseded" ? "replaced by a revision" : p.status} {p.decided_at ? timeAgo(p.decided_at) : ""}.{" "}
          {article && (
            <Link className="link" href={`/admin/help-center/articles/${article.id}`}>
              Open the article
            </Link>
          )}
        </p>
      ) : (
        <>
          {warnings.map((w) => (
            <p key={w} className="notice mb-4">
              {w}
            </p>
          ))}
          <ReviewPanel
            proposal={{ id: p.id, action: p.action, title: p.title, summary: p.summary, body: p.body }}
            baseBody={base}
            initialHtml={renderMarkdown(p.body)}
            initialDiff={base === null ? [] : renderedDiff(base, p.body)}
            collections={flattenTree(await collectionTree()).map((c) => ({ id: c.id, name: c.name, depth: c.depth }))}
            collectionId={article?.collection_id ?? p.collection_id}
          />
        </>
      )}
    </div>
  );
}
