import Link from "next/link";
import { connection } from "next/server";
import { IconArrow, IconCheck } from "@/components/icons";
import { getArticle } from "@/lib/articles";
import { timeAgo } from "@/lib/format";
import { pendingProposals, type ProposalRow } from "@/lib/proposals";
import { KIND_LABEL } from "../agent/thread-list";

// Job: a person is clearing what the agent proposed, and next they open one to approve or reject.
export default async function ReviewPage({ searchParams }: PageProps<"/admin/review">) {
  await connection();
  const params = await searchParams;
  const pending = await pendingProposals();
  const groups = new Map<number, ProposalRow[]>();
  for (const p of pending) groups.set(p.run_id, [...(groups.get(p.run_id) ?? []), p]);
  const approved = params.approved ? await getArticle(Number(params.approved)) : undefined;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="title">Review</h1>
          <p className="mt-1 text-muted">
            {pending.length === 0
              ? "Nothing waiting."
              : `${pending.length} proposed ${pending.length === 1 ? "change" : "changes"} across ${groups.size} ${groups.size === 1 ? "thread" : "threads"}.`}
          </p>
        </div>
        <Link href="/admin/agent" className="btn">
          New task
        </Link>
      </header>

      {approved && (
        <p role="status" className="notice notice-accent mb-6">
          Published “{approved.title}”.{" "}
          <Link className="link" href={`/help/${approved.slug}`} target="_blank">
            View in help center
          </Link>
        </p>
      )}
      {typeof params.rejected === "string" && (
        <p role="status" className="notice mb-6">
          Rejected{params.rejected ? ` “${params.rejected}”` : ""}. Nothing was changed.
        </p>
      )}

      {pending.length === 0 ? (
        <div className="pop-in rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <IconCheck size={24} />
          </span>
          <p className="text-[16px] font-semibold">You&rsquo;re all caught up</p>
          <p className="mx-auto mt-1 max-w-sm text-muted">
            Changes from merged pull requests, tasks, audits, and verification land here for your approval.
          </p>
          <Link href="/admin/agent" className="btn btn-primary mt-5">
            Give the agent a task
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {[...groups.values()].map((items, gi) => (
            <section key={items[0].run_id} aria-label={items[0].run_title} className="card rise overflow-hidden" style={{ "--i": gi } as React.CSSProperties}>
              <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-sunken px-4 py-2.5 text-[13px]">
                <span className="chip">{KIND_LABEL[items[0].run_kind]}</span>
                <Link href={`/admin/agent/${items[0].run_id}`} className="font-semibold text-ink hover:underline">
                  {items[0].run_title}
                </Link>
                <span className="text-muted">
                  {items[0].run_ref ? `${items[0].run_ref} · ` : ""}
                  {timeAgo(items[0].created_at)}
                </span>
                <span className="chip chip-accent num ml-auto">{items.length}</span>
              </h2>
              <ul className="divide-y divide-line">
                {items.map((p) => (
                  <li key={p.id}>
                    <Link href={`/admin/review/${p.id}`} className="group flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-sunken">
                      <span className={`chip w-12 justify-center ${p.action === "create" ? "chip-accent" : ""}`}>{p.action === "create" ? "New" : "Edit"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.title}</span>
                        <span className="block truncate text-[13px] text-muted">{p.reason}</span>
                      </span>
                      <IconArrow size={15} className="text-faint transition-all group-hover:translate-x-0.5 group-hover:text-accent" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
