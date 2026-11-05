import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { report, type Report } from "@/lib/analytics";
import { timeAgo, usd } from "@/lib/format";
import { PageHeader } from "../../secondary";

export const SECTIONS = {
  overview: { group: "Help center", title: "Overview", description: "How readers use your help center and widgets." },
  articles: { group: "Help center", title: "Articles", description: "What people read most." },
  searches: { group: "Help center", title: "Searches", description: "What people look for, and what they couldn't find." },
  feedback: { group: "Help center", title: "Feedback", description: "How readers rate each article." },
  trends: { group: "Intelligence", title: "Support trends", description: "The topics customers ask about, and how well the docs cover them." },
  conversations: { group: "Intelligence", title: "AI conversations", description: "Every question asked to the AI assistant, with its answer." },
} as const;
type Section = keyof typeof SECTIONS;

const RANGES = [7, 30, 90];

// Job: a person is seeing how the help center performs, and next they fix the gap it reveals.
export default async function ReportPage({ params, searchParams }: PageProps<"/admin/reporting/[section]">) {
  await connection();
  const { section } = await params;
  if (!(section in SECTIONS)) notFound();
  const s = section as Section;
  const sp = await searchParams;
  const days = RANGES.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const r = await report(days);
  const meta = SECTIONS[s];

  return (
    <div className="mx-auto max-w-5xl px-4 pt-10 pb-16 md:px-8 md:pt-16">
      <PageHeader
        eyebrow={meta.group}
        title={meta.title}
        description={meta.description}
        actions={
          <nav aria-label="Range" className="inline-flex rounded-lg border border-line bg-sunken p-0.5">
            {RANGES.map((d) => (
              <Link
                key={d}
                href={`/admin/reporting/${s}?days=${d}`}
                aria-current={d === days ? "page" : undefined}
                className={`h-7 rounded-md px-3 text-[12px] leading-7 font-medium transition-all ${
                  d === days ? "bg-surface text-ink shadow-[0_1px_2px_rgb(10_13_18/0.08)]" : "text-muted hover:text-ink"
                }`}
              >
                Past {d} days
              </Link>
            ))}
          </nav>
        }
      />

      {s === "overview" && <Overview r={r} />}
      {s === "articles" && <Articles r={r} />}
      {s === "searches" && <Searches r={r} />}
      {s === "conversations" && <Conversations r={r} />}
      {s === "feedback" && <Feedback r={r} />}
      {s === "trends" && <Trends r={r} />}
    </div>
  );
}

function delta(cur: number, prev: number) {
  if (!prev) return cur ? "new" : "";
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/** A tiny area line across the card's foot: the shape of the period, not exact values. */
function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const n = Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${(i / n) * 100},${28 - (v / max) * 24}`);
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="block h-10 w-full" aria-hidden>
      <polygon points={`0,30 ${pts.join(" ")} 100,30`} style={{ fill: "var(--accent-soft)" }} />
      <polyline points={pts.join(" ")} fill="none" style={{ stroke: "var(--accent)" }} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Overview({ r }: { r: Report }) {
  const c = r.current;
  const p = r.previous;
  const views = r.daily.map((d) => d.views);
  const searches = r.daily.map((d) => d.searches);
  const asked = r.daily.map((d) => d.conversations);
  const cards = [
    { label: "Unique visitors", hint: "People who visited the help center and widgets", v: c.visitors.toLocaleString(), d: delta(c.visitors, p.visitors), series: views },
    { label: "Article views", hint: "Views across the help center and widgets", v: c.views.toLocaleString(), d: delta(c.views, p.views), series: views },
    { label: "Searches", hint: "Searches across the help center and widgets", v: c.searches.toLocaleString(), d: delta(c.searches, p.searches), series: searches },
    { label: "Search click-through", hint: "Searches that led to an article click", v: `${Math.round(c.ctr * 100)}%`, d: "", series: searches },
    { label: "AI conversations", hint: "Questions answered by the AI assistant", v: c.conversations.toLocaleString(), d: delta(c.conversations, p.conversations), series: asked },
    { label: "Estimated savings", hint: "Support work deflected by AI answers", v: usd(c.savings), d: delta(c.savings, p.savings), series: asked },
  ];
  const max = Math.max(1, ...r.daily.map((d) => d.views + d.searches + d.conversations));
  return (
    <div className="flex flex-col gap-8">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map((card, i) => (
          <div key={card.label} className="card rise flex flex-col overflow-hidden" style={{ "--i": i } as React.CSSProperties}>
            <div className="px-4 pt-4">
              <dt className="text-[13px] font-medium text-graphite">{card.label}</dt>
              <dd className="mt-1.5 flex items-center gap-2">
                <span className="num font-display text-[28px] leading-none font-medium tracking-[-0.02em]">{card.v}</span>
                {card.d && (
                  <span
                    className={`num rounded-md px-1.5 text-[11px] leading-[18px] font-semibold ${
                      card.d.startsWith("-") ? "bg-danger-soft text-[var(--danger-strong)]" : "bg-success-soft text-success"
                    }`}
                  >
                    {card.d.startsWith("-") ? "↘" : "↗"} {card.d.replace(/^[+-]/, "")}
                  </span>
                )}
              </dd>
              <dd className="mt-1.5 text-[12px] text-muted">{card.hint}</dd>
            </div>
            <dd className="mt-auto pt-3">
              <Sparkline values={card.series} />
            </dd>
          </div>
        ))}
      </dl>

      <section className="card p-5" aria-labelledby="daily">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 id="daily" className="font-semibold">
            Daily activity
          </h2>
          <p className="flex items-center gap-3 text-[12px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-accent" /> Views
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-[var(--accent-line)]" /> Searches and questions
            </span>
          </p>
        </div>
        <div className="flex h-40 items-end gap-[3px]" role="img" aria-label={`Daily views and searches over ${r.days} days`}>
          {r.daily.map((d, i) => {
            const total = d.views + d.searches + d.conversations;
            return (
              <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.date}: ${d.views} views, ${d.searches} searches, ${d.conversations} questions`}>
                <div
                  className="flex flex-col justify-end overflow-hidden rounded-t-[3px] transition-opacity group-hover:opacity-80"
                  style={{ height: `${(total / max) * 100}%`, animation: `rise 500ms var(--ease-out) ${i * 12}ms backwards` }}
                >
                  <div className="bg-[var(--accent-line)]" style={{ height: `${total ? ((d.searches + d.conversations) / total) * 100 : 0}%` }} />
                  <div className="bg-accent" style={{ height: `${total ? (d.views / total) * 100 : 0}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-faint">
          <span>{r.daily[0]?.date}</span>
          <span>{r.daily.at(-1)?.date}</span>
        </div>
      </section>

    </div>
  );
}

function Articles({ r }: { r: Report }) {
  return (
    <div className="flex flex-col gap-8">
      <section className="card overflow-hidden" aria-labelledby="top">
        <h2 id="top" className="border-b border-line px-5 py-3 font-semibold">
          Most viewed articles
        </h2>
        {r.topArticles.length === 0 ? (
          <p className="px-5 py-8 text-center text-muted">No views in this period.</p>
        ) : (
          <ol className="divide-y divide-line">
            {r.topArticles.map((a, i) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-[14px]">
                <span className="num w-5 text-muted">{i + 1}</span>
                <Link href={`/admin/help-center/articles/${a.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {a.title}
                </Link>
                <span className="num text-muted">{a.views.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function draftHref(text: string, count: number) {
  return `/admin/agent?prompt=${encodeURIComponent(
    `Customers searched or asked "${text}" ${count} ${count === 1 ? "time" : "times"} and the help center had no answer. Write or update the article that answers it.`,
  )}`;
}

function Searches({ r }: { r: Report }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 font-semibold">Top searches</h2>
        {r.topSearches.length === 0 ? (
          <p className="px-5 py-8 text-center text-muted">No searches yet.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="text-left text-[11px] tracking-wide text-faint uppercase">
              <tr>
                <th className="px-5 py-2 font-semibold">Query</th>
                <th className="px-2 py-2 text-right font-semibold">Searches</th>
                <th className="px-5 py-2 text-right font-semibold">Clicks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.topSearches.map((q) => (
                <tr key={q.text}>
                  <td className="max-w-0 truncate px-5 py-2">{q.text}</td>
                  <td className="num px-2 py-2 text-right">{q.count}</td>
                  <td className="num px-5 py-2 text-right text-muted">{q.clicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 font-semibold">Couldn&rsquo;t find an answer</h2>
        {r.emptySearches.length === 0 ? (
          <p className="px-5 py-8 text-center text-muted">Every search and question found something.</p>
        ) : (
          <ul className="divide-y divide-line">
            {r.emptySearches.map((q) => (
              <li key={q.text} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                <span className="num w-6 font-semibold">{q.count}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{q.text}</span>
                  <span className="block text-[12px] text-muted">last {timeAgo(q.last)}</span>
                </span>
                <Link href={draftHref(q.text, q.count)} className="btn btn-quiet h-7 px-2 text-[12px] text-accent">
                  Draft article
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Conversations({ r }: { r: Report }) {
  if (r.conversations.length === 0) return <p className="card px-5 py-10 text-center text-muted">No AI conversations in this period.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {r.conversations.map((c, i) => {
        const sources = JSON.parse(c.sources_json) as { title: string; slug: string }[];
        return (
          <li key={c.id} className="rise" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
            <details className="card group overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                <span className={`chip ${c.answered ? "chip-accent" : "text-danger"}`}>{c.answered ? "Answered" : "No answer"}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{c.question}</span>
                {c.theme && <span className="chip hidden sm:inline-flex">{c.theme}</span>}
                <span className="shrink-0 text-[12px] text-muted">{timeAgo(c.created_at)}</span>
              </summary>
              <div className="border-t border-line px-4 py-3 text-[14px]">
                {c.answer ? <p className="whitespace-pre-wrap text-graphite">{c.answer}</p> : <p className="text-muted">The help center didn&rsquo;t cover this.</p>}
                {sources.length > 0 && <p className="mt-2 text-[12px] text-muted">Sources: {sources.map((s) => s.title).join(", ")}</p>}
                {!c.answered && (
                  <Link href={draftHref(c.question, 1)} className="btn mt-3 h-8 text-[12px]">
                    Draft an article for this
                  </Link>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function Feedback({ r }: { r: Report }) {
  if (r.feedback.length === 0) return <p className="card px-5 py-10 text-center text-muted">No article feedback yet.</p>;
  return (
    <ul className="card divide-y divide-line overflow-hidden">
      {r.feedback.map((f) => {
        const total = f.helpful_yes + f.helpful_no;
        const pct = Math.round((f.helpful_yes / total) * 100);
        return (
          <li key={f.id} className="flex items-center gap-4 px-5 py-3 text-[14px]">
            <Link href={`/admin/help-center/articles/${f.id}`} className="min-w-0 flex-1 truncate hover:underline">
              {f.title}
            </Link>
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-danger-soft">
              <span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
            </span>
            <span className="num w-24 text-right text-[13px] text-muted">
              {pct}% of {total}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Trends({ r }: { r: Report }) {
  const total = r.conversations.length;
  const answered = r.conversations.filter((c) => c.answered).length;
  const coverage = total ? Math.round((answered / total) * 100) : 0;
  const max = Math.max(1, ...r.themes.map((t) => t.count));
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <div className="card p-5">
        <p className="text-[12px] font-semibold tracking-wide text-faint uppercase">Coverage score</p>
        <p className="num mt-2 font-display text-[40px] leading-none font-medium tracking-[-0.02em]">{total ? `${coverage}%` : "—"}</p>
        <p className="mt-2 text-[13px] text-muted">
          {total ? `${answered} of ${total} questions answered from your docs.` : "No questions captured in this period."}
        </p>
        <p className="mt-4 text-[13px] text-muted">{total - answered} were deflectable with a new or better article.</p>
      </div>
      <section className="card p-5" aria-labelledby="themes">
        <h2 id="themes" className="mb-4 font-semibold">
          Top themes
        </h2>
        {r.themes.length === 0 ? (
          <p className="text-muted">Themes appear once a few questions come in. They&rsquo;re grouped automatically every hour.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {r.themes.map((t, i) => (
              <li key={t.theme} className="text-[13px]">
                <div className="mb-1 flex justify-between">
                  <span className="font-medium">{t.theme}</span>
                  <span className="num text-muted">
                    {t.count} · {Math.round((t.answered / t.count) * 100)}% answered
                  </span>
                </div>
                <span className="block h-2 overflow-hidden rounded-full bg-sunken">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${(t.count / max) * 100}%`, animation: `rise 500ms var(--ease-out) ${i * 50}ms backwards` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
