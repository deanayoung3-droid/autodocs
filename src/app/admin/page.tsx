import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { IconArrow, IconExternal, IconGlobe, IconShield, IconWarning } from "@/components/icons";
import { Mascot, MascotAvatar } from "@/components/mascot";
import { aiConfigured } from "@/lib/ai";
import { hoursSaved, report } from "@/lib/analytics";
import { listArticles } from "@/lib/articles";
import { requireAdmin } from "@/lib/auth";
import { greeting, timeAgo, usd } from "@/lib/format";
import { listThreads } from "@/lib/proposals";
import { verificationRows } from "@/lib/verification";
import { KIND_LABEL } from "./agent/thread-list";
import { HomeAsk } from "./home-ask";
import { CopyField } from "./settings/platform-forms";

// Job: a person is getting oriented, and next they clear what Docs Agent prepared or hand Docs Agent a task.
export default async function HomePage() {
  await connection();
  const user = await requireAdmin();
  const r = await report(30);
  const published = (await listArticles({ status: "published" })).length;
  const rows = await verificationRows();
  const flagged = rows.filter((v) => v.status === "needs_review").length;
  const unverifiable = rows.filter((v) => v.status === "cant_verify").length;
  const checked = rows.filter((v) => v.status === "up_to_date" || v.status === "needs_review").length;
  const healthy = rows.filter((v) => v.status === "up_to_date").length;
  const threads = (await listThreads({ limit: 40 }))
    .filter((t) => t.pending_count > 0 || t.status === "running" || t.status === "failed")
    .slice(0, 6);
  const h = await headers();
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, "") || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const host = origin.replace(/^https?:\/\//, "");
  const row = "group flex items-center gap-3 rounded-xs border-b border-line-soft py-[11px] text-sm text-ink transition-colors hover:bg-sunken";

  const stats = [
    { label: "Hours saved", value: String(await hoursSaved()), hint: "Estimated time saved on research, drafts, and verification in the last 30 days.", dot: "bg-success" },
    { label: "Saved on support", value: usd(r.current.savings), hint: "Questions the help center answered this month.", dot: "bg-accent" },
  ];

  return (
    <div className="mx-auto grid max-w-[1080px] gap-8 px-4 py-10 md:px-8 md:py-14 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <h1 className="rise title">
          {greeting()}, {user.name.split(" ")[0]}
        </h1>

        <div className="rise mt-6" style={{ "--i": 1 } as React.CSSProperties}>
          <HomeAsk disabled={!aiConfigured()} />
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {stats.map((st, i) => (
            <div key={st.label} className="card rise p-4" style={{ "--i": i + 2 } as React.CSSProperties}>
              <dt className="flex items-center gap-2 text-[13px] font-medium text-graphite">
                <span className={`size-2.5 rounded-[3px] ${st.dot}`} /> {st.label}
              </dt>
              <dd className="num mt-2 font-display text-[30px] leading-none font-medium tracking-[-0.02em]">{st.value}</dd>
              <dd className="mt-2 text-[12px] text-muted">{st.hint}</dd>
            </div>
          ))}
        </dl>

        <section className="rise mt-9" style={{ "--i": 4 } as React.CSSProperties} aria-labelledby="catchup">
          <div className="mb-1 flex items-center justify-between">
            <h2 id="catchup" className="text-sm font-medium text-ink">
              Catch up
            </h2>
            <Link href="/admin/agent" className="flex items-center gap-1 text-xs text-muted hover:text-ink">
              All threads <IconArrow size={12} />
            </Link>
          </div>
          {threads.length === 0 && flagged === 0 && unverifiable === 0 ? (
            <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
              <Mascot size={40} mood="happy" animate />
              <p className="font-medium text-ink">Nothing needs you right now.</p>
              <p className="text-sm text-muted">Docs Agent will put new drafts and flagged articles here.</p>
            </div>
          ) : (
            <ul>
              {flagged > 0 && (
                <li>
                  <Link href="/admin/verification" className={row}>
                    <IconShield size={16} className="shrink-0 text-danger" />
                    <span className="min-w-0 flex-1 truncate">
                      {flagged} {flagged === 1 ? "article has" : "articles have"} claims that don&rsquo;t match the product
                    </span>
                    <IconArrow size={14} className="text-faint transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              )}
              {unverifiable > 0 && (
                <li>
                  <Link href="/admin/verification?tab=cant_verify" className={row}>
                    <IconWarning size={16} className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate">
                      {unverifiable} {unverifiable === 1 ? "article has" : "articles have"} claims Docs Agent couldn&rsquo;t verify
                    </span>
                    <IconArrow size={14} className="text-faint transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              )}
              {threads.map((t) => (
                <li key={t.id}>
                  <Link href={`/admin/agent/${t.id}`} className={row}>
                    <MascotAvatar size={16} mood={t.status === "running" ? "thinking" : t.status === "failed" ? "sleeping" : "idle"} animate={t.status === "running"} />
                    <span className="min-w-0 flex-1 truncate" title={KIND_LABEL[t.kind] ?? "Task"}>
                      {t.source_title}
                    </span>
                    {t.status === "running" ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted">
                        <span className="working-dot" /> Working
                      </span>
                    ) : t.status === "failed" ? (
                      <span className="text-xs font-medium text-danger">Failed</span>
                    ) : (
                      <span className="size-1.5 rounded-[1px] bg-accent" aria-label={`${t.pending_count} to review`} />
                    )}
                    <span className="num w-9 text-right text-xs text-muted">{timeAgo(t.created_at).replace(" ago", "")}</span>
                    <IconArrow size={14} className="text-faint transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <section className="card rise overflow-hidden" style={{ "--i": 3 } as React.CSSProperties} aria-label="Help center">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
            <IconGlobe size={15} className="text-faint" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-graphite">{host}/help</span>
            <a href="/help" target="_blank" className="btn h-7 px-2.5 text-[12px]">
              Open <IconExternal size={12} />
            </a>
          </div>
          <div className="relative h-[220px] overflow-hidden bg-sunken">
            <iframe
              title="Help center preview"
              src="/help"
              tabIndex={-1}
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 h-[400%] w-[400%] origin-top-left scale-[0.25] border-0 bg-white"
            />
          </div>
          <div className="flex items-center justify-between border-t border-line px-3.5 py-2.5 text-[13px] text-muted">
            <span>
              {published} {published === 1 ? "article" : "articles"}
            </span>
            <Link href="/admin/reporting/overview" className="hover:text-ink">
              {r.current.views.toLocaleString()} views this month
            </Link>
          </div>
        </section>

        <section className="card rise p-4" style={{ "--i": 4 } as React.CSSProperties} aria-labelledby="health">
          <div className="flex items-center justify-between">
            <h2 id="health" className="text-[13px] font-medium text-graphite">
              Doc health
            </h2>
            <Link href="/admin/verification" className="text-[12px] text-muted hover:text-ink">
              Verification →
            </Link>
          </div>
          <p className="num mt-2 font-display text-[30px] leading-none font-medium tracking-[-0.02em]">
            {checked ? `${Math.round((healthy / checked) * 100)}%` : "—"}
          </p>
          <p className="mt-2 text-[12px] text-muted">
            {checked ? `${healthy} of ${checked} checked articles match the product.` : "Verify your docs to measure how accurate they are."}
          </p>
        </section>

        <section className="card rise p-4" style={{ "--i": 5 } as React.CSSProperties} aria-labelledby="share">
          <h2 id="share" className="mb-2 text-[13px] font-medium text-graphite">
            Help center link
          </h2>
          <CopyField value={`${origin}/help`} />
        </section>
      </aside>
    </div>
  );
}
