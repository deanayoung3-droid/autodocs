import Link from "next/link";
import { connection } from "next/server";
import { IconChevronLeft, IconChevronRight, IconFile, IconFolder, IconGithub, IconShield, IconWarning } from "@/components/icons";
import { Mascot } from "@/components/mascot";
import { aiConfigured } from "@/lib/ai";
import { collectionTree, flattenTree, getArticle } from "@/lib/articles";
import { timeAgo } from "@/lib/format";
import { canResearch } from "@/lib/github";
import { renderedDiff, renderMarkdown } from "@/lib/markdown";
import { threadProposals } from "@/lib/proposals";
import { getSettings } from "@/lib/settings";
import { issuesOf, recentVerifications, verificationRows, type VerificationRow } from "@/lib/verification";
import { notAnIssueAction, verificationTaskAction, verifyAction } from "../actions";
import { AutoRefresh } from "../agent/[id]/thread-live";
import { subRow } from "../styles";
import { ReviewPanel } from "../review/[id]/review-panel";
import { SubmitButton } from "../ui";

const TABS = [
  { id: "needs_review", label: "Needs review", icon: <IconWarning size={14} /> },
  { id: "up_to_date", label: "Up to date", icon: <IconShield size={14} /> },
  { id: "cant_verify", label: "Can't verify", icon: <IconFile size={14} /> },
  { id: "unchecked", label: "Not checked", icon: <IconFile size={14} /> },
  { id: "activity", label: "Activity", icon: null },
] as const;

const STATUS_TEXT: Record<string, string> = {
  needs_review: "Flagged",
  up_to_date: "Up to date",
  cant_verify: "Couldn't verify",
  queued: "Waiting to be checked",
  checking: "Checking now",
};

function inTab(r: VerificationRow, tab: string) {
  if (tab === "unchecked") return !r.status || r.status === "queued" || r.status === "checking";
  return r.status === tab;
}

// Job: a person is finding articles that no longer match the product, and next they publish the fix or dismiss it.
export default async function VerificationPage({ searchParams }: PageProps<"/admin/verification">) {
  await connection();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as string) : "needs_review";
  const rows = await verificationRows();
  const counts = Object.fromEntries(TABS.map((t) => [t.id, rows.filter((r) => inTab(r, t.id)).length]));
  const inQueue = rows.filter((r) => r.status === "queued" || r.status === "checking").length;
  const list = tab === "activity" ? [] : rows.filter((r) => inTab(r, tab));
  const selectedId = Number(sp.article) || list[0]?.article_id;
  const index = list.findIndex((r) => r.article_id === selectedId);
  const selected = rows.find((r) => r.article_id === selectedId);
  const settings = await getSettings();
  const code = canResearch(settings.githubRepo);
  const ready = aiConfigured() && code;
  const href = (articleId?: number) => `/admin/verification?tab=${tab}${articleId ? `&article=${articleId}` : ""}`;

  const byCollection = new Map<string, VerificationRow[]>();
  for (const r of list) {
    const k = r.collection_name ?? "No section";
    byCollection.set(k, [...(byCollection.get(k) ?? []), r]);
  }

  return (
    <div className="flex min-h-dvh flex-col md:h-dvh">
      <AutoRefresh active={inQueue > 0} />
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-line px-4 pt-7 pb-5 md:px-8">
        <div className="rise min-w-0">
          <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-accent-strong uppercase">Doc health</p>
          <h1 className="title">Verification</h1>
          <p className="mt-1 text-[14px] text-muted">Every published article, checked against your product.</p>
        </div>
        <div className="rise flex flex-wrap items-stretch gap-3" style={{ "--i": 1 } as React.CSSProperties}>
          <dl className="flex divide-x divide-line rounded-xl border border-line text-[12px]">
            <div className="px-4 py-2">
              <dt className="text-muted">Coverage</dt>
              <dd className="mt-0.5 font-semibold">All {rows.length} articles</dd>
            </div>
            <div className="px-4 py-2">
              <dt className="text-muted">Verified against</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 font-semibold">
                {code ? (
                  <>
                    <IconGithub size={12} /> {settings.githubRepo}
                  </>
                ) : (
                  <Link href="/admin/integrations/github" className="link">
                    Connect GitHub
                  </Link>
                )}
              </dd>
            </div>
            <div className="px-4 py-2">
              <dt className="text-muted">Stays current</dt>
              <dd className="mt-0.5 font-semibold">{settings.continuousVerification ? "Automatically" : "When you ask"}</dd>
            </div>
          </dl>
          <form action={verifyAction} className="flex">
            <input type="hidden" name="article" value="all" />
            <SubmitButton className="btn btn-primary h-auto" disabled={!ready} pendingLabel="Queuing…">
              <IconShield size={15} /> Verify docs
            </SubmitButton>
          </form>
        </div>
      </header>

      {(!ready || inQueue > 0) && (
        <div className="flex flex-col gap-2 border-b border-line px-4 py-3 md:px-8">
          {!aiConfigured() && (
            <p className="notice">
              Verification needs the server&rsquo;s OpenAI API key.{" "}
              <Link href="/admin/settings/ai" className="link">
                Set up AI
              </Link>
            </p>
          )}
          {!code && (
            <p className="notice">
              Verification reads your code.{" "}
              <Link href="/admin/integrations/github" className="link">
                Connect GitHub
              </Link>{" "}
              to check articles against it.
            </p>
          )}
          {inQueue > 0 && (
            <p role="status" className="notice flex items-center gap-2">
              <Mascot size={16} mood="thinking" animate /> Checking {inQueue} {inQueue === 1 ? "article" : "articles"}. Results appear as they finish.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-b border-line px-4 md:px-8">
        <nav aria-label="Verification status" className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <Link key={t.id} href={`/admin/verification?tab=${t.id}`} aria-current={tab === t.id ? "page" : undefined} className="tab shrink-0">
              {t.icon && <span className="text-faint">{t.icon}</span>}
              {t.label}
              {t.id !== "activity" && (
                <span className={`count ${t.id === "needs_review" && counts[t.id] > 0 ? "" : "bg-well text-muted"}`}>{counts[t.id]}</span>
              )}
            </Link>
          ))}
        </nav>
        {list.length > 1 && index >= 0 && (
          <div className="hidden shrink-0 items-center gap-1 text-[12px] text-muted md:flex">
            <span className="num">
              {index + 1} of {list.length}
            </span>
            <Link
              href={href(list[Math.max(0, index - 1)].article_id)}
              aria-label="Previous article"
              aria-disabled={index === 0}
              className={`btn btn-quiet size-7 px-0 ${index === 0 ? "pointer-events-none opacity-40" : ""}`}
            >
              <IconChevronLeft size={15} />
            </Link>
            <Link
              href={href(list[Math.min(list.length - 1, index + 1)].article_id)}
              aria-label="Next article"
              aria-disabled={index === list.length - 1}
              className={`btn btn-quiet size-7 px-0 ${index === list.length - 1 ? "pointer-events-none opacity-40" : ""}`}
            >
              <IconChevronRight size={15} />
            </Link>
          </div>
        )}
      </div>

      {tab === "activity" ? (
        <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
          <Activity />
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
          <Mascot size={56} mood={tab === "needs_review" ? "happy" : "idle"} animate />
          <p className="font-medium">{tab === "needs_review" ? "Nothing needs review." : "No articles here."}</p>
          {tab === "needs_review" && <p className="text-[13px] text-muted">Every checked article matches the product.</p>}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="slim-scroll border-b border-line md:w-64 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0">
            <div className="p-2">
              {[...byCollection.entries()].map(([name, items]) => (
                <section key={name} className="mb-3">
                  <h2 className="kicker px-3 pt-2 pb-1.5">{name}</h2>
                  <ul className="flex flex-col gap-0.5">
                    {items.map((r) => (
                      <li key={r.article_id}>
                        <Link
                          href={href(r.article_id)}
                          aria-current={r.article_id === selectedId ? "page" : undefined}
                          className={subRow(r.article_id === selectedId)}
                        >
                          <IconFile size={14} className="shrink-0 text-faint" />
                          <span className="truncate">{r.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              <p className="px-3 pt-1 text-xs text-faint">{list.length} left</p>
            </div>
          </div>
          {selected && <Detail key={selected.article_id} row={selected} ready={ready} tab={tab} />}
        </div>
      )}
    </div>
  );
}

async function Detail({ row, ready, tab }: { row: VerificationRow; ready: boolean; tab: string }) {
  const issues = issuesOf(row);
  const fix = row.run_id ? (await threadProposals(row.run_id)).find((p) => p.status === "pending") : undefined;
  const article = await getArticle(row.article_id);
  const tree = fix ? flattenTree(await collectionTree()) : [];
  const back = `/admin/verification?tab=${tab}`;

  return (
    <>
      <div className="border-b border-line p-5 md:w-80 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <IconFolder size={13} /> {row.collection_name ?? "No section"}
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-[-0.01em] text-ink">
          <Link href={`/admin/help-center/articles/${row.article_id}`} className="hover:underline">
            {row.title}
          </Link>
        </h2>
        {row.summary && <p className="mt-3 text-[13px] leading-relaxed text-graphite">{row.summary}</p>}
        <p className="mt-3 text-[12px] text-muted">
          {row.status ? STATUS_TEXT[row.status] : "Not checked yet"}
          {row.checked_at && ` ${timeAgo(row.checked_at)}`}
          {issues.length > 0 && ` · ${issues.length} ${issues.length === 1 ? "issue" : "issues"}`}
        </p>

        {issues.length > 0 && (
          <section className="card mt-4 overflow-hidden">
            <h3 className="flex items-center justify-between border-b border-line bg-sunken px-3.5 py-2 text-[12px] font-semibold">
              What&rsquo;s wrong <span className="num font-normal text-muted">{issues.length}</span>
            </h3>
            <ol className="divide-y divide-line">
              {issues.map((i, n) => (
                <li key={n} className="px-3.5 py-3 text-[13px]">
                  <p className="text-graphite">
                    <span className="text-muted">Says </span>
                    {i.claim}
                  </p>
                  <p className="mt-1">
                    <span className="text-muted">Actually </span>
                    {i.problem}
                  </p>
                  {i.evidence && <p className="mt-1 truncate font-mono text-[11.5px] text-muted">{i.evidence}</p>}
                </li>
              ))}
            </ol>
          </section>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {row.status === "needs_review" && !fix && (
            <>
              <form action={notAnIssueAction}>
                <input type="hidden" name="article" value={row.article_id} />
                <SubmitButton className="btn h-8" pendingLabel="Saving…">
                  Not an issue
                </SubmitButton>
              </form>
              <form action={verificationTaskAction}>
                <input type="hidden" name="article" value={row.article_id} />
                <SubmitButton className="btn h-8" pendingLabel="Starting…" disabled={!ready}>
                  Open task
                </SubmitButton>
              </form>
            </>
          )}
          {row.status !== "queued" && row.status !== "checking" && (
            <form action={verifyAction}>
              <input type="hidden" name="article" value={row.article_id} />
              <SubmitButton className="btn btn-quiet h-8" pendingLabel="Queuing…" disabled={!ready}>
                {row.status ? "Check again" : "Check now"}
              </SubmitButton>
            </form>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 p-5 md:overflow-y-auto md:px-8">
        {fix && article ? (
          <>
            <ReviewPanel
              proposal={{ id: fix.id, action: fix.action, title: fix.title, summary: fix.summary, body: fix.body }}
              baseBody={article.body}
              initialHtml={renderMarkdown(fix.body)}
              initialDiff={renderedDiff(article.body, fix.body)}
              collections={tree.map((c) => ({ id: c.id, name: c.name, depth: c.depth }))}
              collectionId={article.collection_id}
              returnTo={back}
              fields={{ article: row.article_id }}
              dismiss={
                row.status === "needs_review" ? (
                  <SubmitButton formAction={notAnIssueAction} className="btn btn-quiet" pendingLabel="Saving…">
                    Not an issue
                  </SubmitButton>
                ) : undefined
              }
              actions={
                row.status === "needs_review" ? (
                  <SubmitButton formAction={verificationTaskAction} className="btn" pendingLabel="Starting…" disabled={!ready}>
                    Open task
                  </SubmitButton>
                ) : undefined
              }
            />
          </>
        ) : article ? (
          <article className="mx-auto max-w-[680px]">
            <h3 className="title mb-4 text-[24px]">{article.title}</h3>
            <div className="prose-doc" dangerouslySetInnerHTML={{ __html: renderMarkdown(article.body) }} />
          </article>
        ) : null}
      </div>
    </>
  );
}

async function Activity() {
  const recent = await recentVerifications(40);
  if (recent.length === 0) return <p className="text-muted">No checks yet.</p>;
  return (
    <ul className="card divide-y divide-line">
      {recent.map((r) => (
        <li key={r.article_id} className="flex items-baseline gap-3 px-4 py-2.5 text-[13px]">
          <span className="w-24 shrink-0 text-muted">{r.checked_at ? timeAgo(r.checked_at) : ""}</span>
          <Link href={`/admin/verification?tab=${r.status === "up_to_date" ? "up_to_date" : r.status ?? "unchecked"}&article=${r.article_id}`} className="min-w-0 flex-1 truncate hover:underline">
            {r.title}
          </Link>
          <span className="shrink-0 text-muted">{r.status ? STATUS_TEXT[r.status] : ""}</span>
        </li>
      ))}
    </ul>
  );
}
