import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { IconArrow } from "@/components/icons";
import { customerAiConfigured } from "@/lib/ai";
import { logQuery } from "@/lib/analytics";
import { hybridSearch } from "@/lib/search";
import { currentReader } from "@/lib/auth";
import { HIT_END, HIT_START } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { Answer } from "../answer";
import { SearchForm } from "../search-form";

/** Questions get an AI answer right away; short keyword searches offer one on request. */
function looksLikeQuestion(q: string) {
  return q.endsWith("?") || q.split(/\s+/).length >= 4;
}

export default async function SearchPage({ searchParams }: PageProps<"/help/search">) {
  await connection();
  const raw = (await searchParams).q;
  const q = (typeof raw === "string" ? raw : "").trim().slice(0, 300);
  const settings = await getSettings();
  const signedIn = (await currentReader()) !== null;
  if (settings.siteVisibility === "private" && !signedIn) redirect(`/help/signin?next=${encodeURIComponent(`/help/search?q=${q}`)}`);
  const hits = q ? await hybridSearch(q, { limit: 10, includeRestricted: signedIn }) : [];
  if (q) await logQuery("search", q, hits.length, hits.length > 0);
  const ai = settings.aiAnswers && customerAiConfigured() && q.length >= 3;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-10 md:py-14">
      <SearchForm defaultValue={q} />

      {q && ai && (
        <div className="mt-6">
          <Answer key={q} question={q} supportUrl={settings.supportUrl} auto={looksLikeQuestion(q)} />
        </div>
      )}

      {q && (
        <section className="mt-8" aria-labelledby="results">
          <h1 id="results" className="mb-3 text-[13px] font-semibold tracking-wide text-faint uppercase">
            {hits.length === 0 ? `No articles match “${q}”` : `${hits.length} ${hits.length === 1 ? "article" : "articles"} for “${q}”`}
          </h1>
          {hits.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="font-medium">We couldn&rsquo;t find that.</p>
              <p className="mt-1 text-muted">
                Try fewer or different words, or{" "}
                <Link href="/help" className="link">
                  browse topics
                </Link>
                {settings.supportUrl && (
                  <>
                    {" "}
                    or{" "}
                    <a href={settings.supportUrl} className="link">
                      contact support
                    </a>
                  </>
                )}
                .
              </p>
            </div>
          ) : (
            <ul className="card divide-y divide-line overflow-hidden">
              {hits.map((h, i) => (
                <li key={h.id} className="rise" style={{ "--i": i } as React.CSSProperties}>
                  <Link
                    href={`/help/${h.slug}?from=search&q=${encodeURIComponent(q)}`}
                    className="group flex items-start gap-3 px-5 py-4 transition-colors hover:bg-sunken"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium transition-colors group-hover:text-accent">{h.title}</span>
                      <span className="mt-0.5 line-clamp-2 block text-[14px] text-muted">
                        <Snippet text={h.snippet || h.summary} />
                      </span>
                    </span>
                    <IconArrow size={15} className="mt-1 shrink-0 text-faint transition-all group-hover:translate-x-0.5 group-hover:text-accent" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** Renders FTS snippet markers as <mark> without using innerHTML. */
function Snippet({ text }: { text: string }) {
  const parts = text.replace(/[#*_`>]/g, "").split(HIT_START);
  return (
    <>
      {parts.map((part, i) => {
        if (i === 0) return <span key={i}>{part}</span>;
        const [hit, rest] = part.split(HIT_END);
        return (
          <span key={i}>
            <mark>{hit}</mark>
            {rest}
          </span>
        );
      })}
    </>
  );
}
