import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { customerAiConfigured } from "@/lib/ai";
import { collectionTree, type CollectionNode } from "@/lib/articles";
import { currentReader } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { AskBox } from "./ask-box";
import { SearchForm } from "./search-form";
import { SectionIcon } from "@/components/section-icon";

/** Published articles in a section and every visible section under it. */
export function visibleCount(n: CollectionNode, signedIn: boolean): number {
  if (n.restricted && !signedIn) return 0;
  return n.published + n.children.reduce((s, c) => s + visibleCount(c, signedIn), 0);
}

// "/" shows this page too (see next.config.ts), so search engines are pointed at /help.
export function generateMetadata(): Metadata {
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, "");
  return origin ? { alternates: { canonical: `${origin}/help` } } : {};
}

// Job: a customer is looking for an answer, and next they search or open a topic.
export default async function HelpHome() {
  await connection();
  const s = await getSettings();
  const signedIn = (await currentReader()) !== null;
  if (s.siteVisibility === "private" && !signedIn) redirect("/help/signin?next=/help");
  const topics = (await collectionTree()).filter((c) => visibleCount(c, signedIn) > 0);

  return (
    <div className="mx-auto max-w-3xl px-4 pt-12 pb-20 md:pt-20">
      <h1 className="rise display">What do you need help with?</h1>
      <p className="rise mt-2 text-[16px] text-muted" style={{ "--i": 1 } as React.CSSProperties}>
        Search our knowledge base for answers to common questions.
      </p>
      <div className="rise mt-6" style={{ "--i": 2 } as React.CSSProperties}>
        {s.aiAnswers && customerAiConfigured() ? <AskBox /> : <SearchForm autoFocus large />}
      </div>

      {topics.length === 0 ? (
        <p className="mt-12 text-center text-muted">No articles have been published yet.</p>
      ) : (
        <>
          <h2 className="sr-only">Browse by topic</h2>
          <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {topics.map((c, i) => (
              <li key={c.id} className="rise" style={{ "--i": i + 3 } as React.CSSProperties}>
                <Link
                  href={`/help/c/${c.slug}`}
                  className="group flex h-full flex-col rounded-xl border border-line bg-surface px-6 pt-8 pb-6 transition-colors hover:border-line-strong"
                >
                  <SectionIcon value={c.icon} size={28} className="text-muted" />
                  <span className="mt-4 text-[16px] font-medium text-ink">{c.name}</span>
                  {c.description && <span className="mt-1 line-clamp-2 text-[14px] leading-5 text-muted">{c.description}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
