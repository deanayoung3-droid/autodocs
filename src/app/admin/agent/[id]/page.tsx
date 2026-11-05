import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { IconChevronRight, IconFile, IconFolder, IconGithub, IconHome } from "@/components/icons";
import { MascotAvatar } from "@/components/mascot";
import { aiConfigured } from "@/lib/ai";
import { collectionPath, getCollection } from "@/lib/articles";
import { timeAgo } from "@/lib/format";
import { describeCounts, type TriageRecord } from "@/lib/pr-intake";
import { getThread, listMessages, listSteps, threadChanges, threadProposals, type ProposalRow } from "@/lib/proposals";
import { approveAllAction, dismissThreadAction, retryThreadAction } from "../../actions";
import { PageBar } from "../../secondary";
import { SubmitButton } from "../../ui";
import { KIND_LABEL } from "../thread-list";
import { AutoRefresh, FollowUp } from "./thread-live";

const STATUS_TAG: Record<string, { label: string; className: string }> = {
  pending: { label: "", className: "text-accent-strong" },
  approved: { label: "Published", className: "text-success" },
  rejected: { label: "Rejected", className: "text-faint" },
  superseded: { label: "Replaced", className: "text-faint" },
};

// Job: a person is checking what Docs Agent did for one task, and next they review its changes or ask for a revision.
export default async function ThreadPage({ params, searchParams }: PageProps<"/admin/agent/[id]">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const t = await getThread(Number(id));
  if (!t) notFound();

  const proposals = (await threadProposals(t.id)).filter((p) => p.status !== "superseded");
  const pending = proposals.filter((p) => p.status === "pending");
  const changes = threadChanges(t);
  const triage = readTriage(t.triage_json);
  const steps = await listSteps(t.id);
  const messages = (await listMessages(t.id)).slice(1); // the first message is the source material
  const running = t.status === "running";
  const mood = running ? "thinking" : t.status === "failed" ? "sleeping" : pending.length ? "happy" : "idle";

  // Group proposals by section path for the "Review changes" tree.
  const groups = new Map<string, { path: string[]; items: ProposalRow[] }>();
  for (const p of proposals) {
    const path = (await collectionPath(p.collection_id)).map((c) => c.name);
    const key = path.join("/");
    groups.set(key, { path, items: [...(groups.get(key)?.items ?? []), p] });
  }

  return (
    <div>
      <AutoRefresh active={running} />
      <PageBar
        actions={
          <>
            {t.status === "failed" && (
              <form action={retryThreadAction}>
                <input type="hidden" name="runId" value={t.id} />
                <SubmitButton className="btn h-8" disabled={!aiConfigured()} pendingLabel="Retrying…">
                  Try again
                </SubmitButton>
              </form>
            )}
            {pending.length > 1 && t.status !== "dismissed" && (
              <form action={approveAllAction}>
                <input type="hidden" name="runId" value={t.id} />
                <SubmitButton className="btn h-8" pendingLabel="Publishing…">
                  Approve all {pending.length}
                </SubmitButton>
              </form>
            )}
          </>
        }
      >
        <Link href="/admin/agent" className="hover:text-ink md:hidden">
          Docs Agent
        </Link>
        <span className="md:hidden">/</span>
        <span className="font-medium text-graphite">{KIND_LABEL[t.kind] ?? "Task"}</span>
      </PageBar>

      <div className="mx-auto max-w-[720px] px-4 py-10 md:px-8 md:py-14">
        <div className="pop-in">
          <MascotAvatar size={44} mood={mood} />
        </div>
        <h1 className="rise title mt-5">{t.source_title}</h1>
        <Source thread={t} />

        {sp.approvedAll && (
          <p role="status" className="notice mt-5">
            Published {sp.approvedAll} {sp.approvedAll === "1" ? "change" : "changes"}.
          </p>
        )}

        {running && (
          <section aria-live="polite" className="card mt-6 px-4 py-3.5">
            <p className="flex items-center gap-2 font-medium">
              <span className="working-dot" /> Docs Agent is working…
            </p>
            <ol className="mt-2 flex flex-col gap-1 text-[13px] text-muted">
              {steps.slice(-8).map((s) => (
                <li key={s.id} className="fade-in">
                  {s.label}
                </li>
              ))}
              {steps.length === 0 && <li>Reading the request</li>}
            </ol>
          </section>
        )}

        {t.status === "failed" && <p className="notice notice-error mt-6">{t.error}</p>}
        {t.status === "dismissed" && <p className="notice mt-6">Marked not relevant {t.dismissed_at ? timeAgo(t.dismissed_at) : ""}.</p>}

        {t.summary && !running && <p className="rise mt-5 text-[15px] leading-relaxed text-graphite">{t.summary}</p>}
        {triage && !running && <TriageNote triage={triage} />}

        {(changes.length > 0 || steps.length > 0 || t.prompt) && !running && (
          <details className="group mt-4">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-[13px] text-muted hover:text-ink">
              Why Docs Agent made {proposals.length === 1 ? "this change" : "these changes"}
              <IconChevronRight size={14} className="transition-transform group-open:rotate-90" />
            </summary>
            <div className="mt-3 flex flex-col gap-4 border-l-2 border-line pl-4 text-[13px]">
              {t.confidence && (
                <p className="text-graphite">
                  Confidence: <span className="font-medium capitalize">{t.confidence}</span>
                </p>
              )}
              {changes.length > 0 && (
                <div>
                  <h2 className="mb-1.5 font-medium text-graphite">What changed in the product</h2>
                  <ul className="flex flex-col gap-1.5">
                    {changes.map((c, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="w-16 shrink-0 text-muted capitalize">{c.type}</span>
                        <span className="text-graphite">{c.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {t.prompt && (t.kind === "task" || t.kind === "audit" || t.kind === "notes") && (
                <div>
                  <h2 className="mb-1.5 font-medium text-graphite">{t.kind === "audit" ? "Signals the audit used" : "Request"}</h2>
                  <p className="whitespace-pre-wrap text-graphite">{t.prompt}</p>
                </div>
              )}
              {steps.length > 0 && (
                <div>
                  <h2 className="mb-1.5 font-medium text-graphite">Research ({steps.length} steps)</h2>
                  <ol className="flex flex-col gap-1 text-muted">
                    {steps.map((s) => (
                      <li key={s.id}>{s.label}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </details>
        )}

        {proposals.length > 0 && (
          <section className="card rise mt-6 overflow-hidden" aria-labelledby="review-changes">
            <div className="flex items-center justify-between border-b border-line bg-sunken px-4 py-2.5">
              <h2 id="review-changes" className="flex items-center gap-2 text-[13px] font-medium">
                <IconFile size={14} className="text-faint" /> Review changes
              </h2>
              <span className="num text-[12px] text-muted">
                {proposals.length} {proposals.length === 1 ? "article" : "articles"}
              </span>
            </div>
            <div className="px-4 py-3 text-[13px]">
              <p className="flex items-center gap-2 text-muted">
                <IconHome size={14} /> Home
              </p>
              {[...groups.values()].map(({ path, items }) => (
                <div key={path.join("/") || "none"}>
                  {path.map((name, depth) => (
                    <p key={depth} className="mt-1.5 flex items-center gap-2 text-muted" style={{ paddingLeft: (depth + 1) * 18 }}>
                      <IconFolder size={14} /> {name}
                    </p>
                  ))}
                  <ul>
                    {items.map((p) => {
                      const tag = STATUS_TAG[p.status];
                      return (
                        <li key={p.id} className="mt-1.5 flex items-center gap-2" style={{ paddingLeft: (path.length + 1) * 18 }}>
                          <IconFile size={14} className="shrink-0 text-faint" />
                          {p.status === "pending" ? (
                            <Link href={`/admin/review/${p.id}`} className="min-w-0 flex-1 truncate font-medium text-ink hover:underline">
                              {p.title}
                            </Link>
                          ) : (
                            <span className="min-w-0 flex-1 truncate text-graphite">{p.title}</span>
                          )}
                          <span className={`shrink-0 text-[11px] font-semibold tracking-wider uppercase ${tag.className}`}>
                            {p.status === "pending" ? (p.action === "create" ? "New" : "Updated") : tag.label}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {pending.length > 0 && t.status !== "dismissed" && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link href={`/admin/review/${pending[0].id}`} className="btn btn-primary">
              Review &amp; edit changes
            </Link>
            <form action={dismissThreadAction}>
              <input type="hidden" name="runId" value={t.id} />
              <SubmitButton className="btn btn-quiet" pendingLabel="Dismissing…">
                Not relevant
              </SubmitButton>
            </form>
          </div>
        )}

        {t.kind !== "bulk" && t.kind !== "verify" && (
          <section className="mt-12" aria-labelledby="conversation">
            <h2 id="conversation" className="mb-3 text-[11px] font-semibold tracking-wider text-faint uppercase">
              Ask Docs Agent for changes
            </h2>
            {messages.length > 0 && (
              <ol className="mb-4 flex flex-col gap-3">
                {messages.map((m) => (
                  <li key={m.id} className={`flex gap-2.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                    {m.role === "agent" && <MascotAvatar size={26} animate={false} />}
                    <div className={`max-w-[85%] rounded-xl px-3.5 py-2 ${m.role === "user" ? "bg-ink-strong text-white" : "border border-line bg-surface"}`}>
                      <p className={`mb-0.5 text-[11px] ${m.role === "user" ? "text-white/60" : "text-muted"}`}>
                        {m.role === "user" ? "You" : "Docs Agent"} · {timeAgo(m.created_at)}
                      </p>
                      <p className="text-[14px] whitespace-pre-wrap">{m.content}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <FollowUp runId={t.id} disabled={running || !aiConfigured()} />
          </section>
        )}
      </div>
    </div>
  );
}

async function Source({ thread: t }: { thread: NonNullable<Awaited<ReturnType<typeof getThread>>> }) {
  const when = <span>{timeAgo(t.created_at)}</span>;
  if (t.kind === "pr" && t.source_ref) {
    return (
      <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
        <span className="chip">
          <IconGithub size={12} />
          {t.source_url ? (
            <a className="hover:underline" href={t.source_url} target="_blank" rel="noreferrer">
              {t.source_ref}
            </a>
          ) : (
            t.source_ref
          )}
        </span>
        {t.source_author && <span className="font-medium text-graphite">{t.source_author}</span>}
        <span>merged {timeAgo(t.created_at)}</span>
      </p>
    );
  }
  if (t.kind === "verify") {
    const collection = t.source_ref ? await getCollection(Number(t.source_ref)) : undefined;
    return (
      <p className="mt-2.5 text-[13px] text-muted">
        Found by verification{collection ? ` in ${collection.name}` : ""} · {when} ·{" "}
        <Link className="link" href="/admin/verification">
          Open Verification
        </Link>
      </p>
    );
  }
  return (
    <p className="mt-2.5 flex items-center gap-2 text-[13px] text-muted">
      <span className="chip">{KIND_LABEL[t.kind] ?? "Task"}</span> {when}
    </p>
  );
}

function readTriage(json: string | null): TriageRecord | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as TriageRecord;
  } catch {
    return null;
  }
}

const AREA_LABEL: Record<TriageRecord["area"], string> = {
  frontend: "Front end",
  backend_user_facing: "Back end that customers notice",
  backend_internal: "Internal back end",
  infrastructure: "Infrastructure",
  mixed: "Front end and back end",
};
const DECISION_LABEL: Record<TriageRecord["decision"], string> = {
  skip: "no docs change",
  update: "update articles",
  create: "add an article",
  update_and_create: "update articles and add one",
};

/** How a merged pull request was sorted before drafting. Open when it was skipped: the reasons are the whole answer. */
function TriageNote({ triage }: { triage: TriageRecord }) {
  const files = describeCounts(triage.files ?? {});
  return (
    <details className="group mt-4" open={!triage.drafted}>
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[13px] text-muted hover:text-ink">
        How Docs Agent sorted this pull request
        <IconChevronRight size={14} className="transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-3 flex flex-col gap-2 border-l-2 border-line pl-4 text-[13px] text-graphite">
        <p>
          <span className="font-medium text-ink">{AREA_LABEL[triage.area] ?? triage.area}</span>, {triage.customer_impact} customer impact: {DECISION_LABEL[triage.decision] ?? triage.decision}.
          {triage.method === "rules" ? " Decided from the files alone." : ""}
        </p>
        {files && <p className="text-muted">Files: {files}.</p>}
        {triage.reasons?.length > 0 && (
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {triage.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
