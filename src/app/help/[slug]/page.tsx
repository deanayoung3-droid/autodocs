import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { connection } from "next/server";
import { IconArrow } from "@/components/icons";
import { customerAiConfigured } from "@/lib/ai";
import { markSearchClick, recordPageView, visitorId } from "@/lib/analytics";
import { collectionRestricted, getArticleBySlug, getCollection, listArticles, recordView, redirectFor } from "@/lib/articles";
import { currentReader } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { headings, renderMarkdown } from "@/lib/markdown";
import { getSettings } from "@/lib/settings";
import { getTranslation, LANGUAGES } from "@/lib/translations";
import { ArticleMenu, TableOfContents } from "../article-actions";
import { Feedback } from "../feedback";

export async function generateMetadata({ params }: PageProps<"/help/[slug]">): Promise<Metadata> {
  await connection();
  const a = await getArticleBySlug((await params).slug);
  if (!a || a.status !== "published" || a.restricted) return {};
  return { title: a.title, description: a.summary, openGraph: { title: a.title, description: a.summary, type: "article" } };
}

// Job: a customer is reading to solve their problem, and next they say whether it helped (or contact support).
export default async function ArticlePage({ params, searchParams }: PageProps<"/help/[slug]">) {
  await connection();
  const { slug } = await params;
  const sp = await searchParams;
  const s = await getSettings();
  const signedIn = (await currentReader()) !== null;
  const article = await getArticleBySlug(slug);

  if (!article || article.status !== "published") {
    const to = await redirectFor(`/help/${slug}`);
    // Moved articles redirect permanently, so search engines carry their ranking over.
    if (to) permanentRedirect(to);
    notFound();
  }
  if ((s.siteVisibility === "private" || article.restricted || await collectionRestricted(article.collection_id)) && !signedIn) {
    redirect(`/help/signin?next=${encodeURIComponent(`/help/${slug}`)}`);
  }

  const h = await headers();
  await recordView(article.id);
  await recordPageView(article.id, visitorId(h), sp.src === "widget" ? "widget" : "help");
  if (sp.from === "search" && typeof sp.q === "string") await markSearchClick(sp.q);

  const lang = typeof sp.lang === "string" && s.languages.includes(sp.lang) ? sp.lang : "";
  const t = lang ? await getTranslation(article.id, lang) : undefined;
  const title = t?.title ?? article.title;
  const body = t?.body ?? article.body;
  const toc = headings(body);

  const collection = article.collection_id ? await getCollection(article.collection_id) : undefined;
  const siblings = collection
    ? (await listArticles({ status: "published", collectionId: collection.id, order: "position" }))
        .filter((a) => a.id !== article.id && (signedIn || !a.restricted))
        .slice(0, 6)
    : [];

  return (
    <div className="mx-auto grid max-w-[1100px] gap-16 px-4 pt-10 pb-16 md:px-12 xl:grid-cols-[minmax(0,656px)_240px]">
      <article className="min-w-0">
        <div className="flex min-h-7 flex-wrap items-center justify-between gap-3">
          {collection ? (
            <Link href={`/help/c/${collection.slug}`} className="text-[14px] font-medium text-ink transition-colors hover:text-accent-strong">
              {collection.name}
            </Link>
          ) : (
            <span />
          )}
          {s.contentActions && <ArticleMenu slug={article.slug} ai={s.aiAnswers && customerAiConfigured()} />}
        </div>
        <h1 className="display mt-2">{title}</h1>
        {lang && (
          <p className="notice mt-4">
            {t ? `Translated to ${LANGUAGES[lang]}.` : `Not yet available in ${LANGUAGES[lang]}.`}{" "}
            <Link href={`/help/${slug}`} className="link">
              Read in English
            </Link>
          </p>
        )}

        <div className="prose-doc mt-5" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />

        <p className="mt-10 text-[13px] text-faint">Updated {formatDate(article.updated_at)}</p>

        <div className={`mt-6 border-t border-line-soft pt-6 ${toc.length > 1 ? "xl:hidden" : ""}`}>
          <Feedback slug={article.slug} supportUrl={s.supportUrl} />
        </div>

        {siblings.length > 0 && collection && (
          <aside className="mt-12" aria-labelledby="more">
            <h2 id="more" className="mb-3 text-[13px] font-semibold tracking-wide text-faint uppercase">
              More in {collection.name}
            </h2>
            <ul className="grid gap-x-6 sm:grid-cols-2">
              {siblings.map((sib) => (
                <li key={sib.id} className="border-b border-line">
                  <Link href={`/help/${sib.slug}`} className="group flex items-center gap-2 py-3">
                    <span className="min-w-0 flex-1 truncate transition-colors group-hover:text-accent">{sib.title}</span>
                    <IconArrow size={14} className="text-faint transition-all group-hover:translate-x-0.5 group-hover:text-accent" />
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </article>
      {toc.length > 1 && (
        <aside className="hidden xl:block">
          <div className="sticky top-24 flex flex-col gap-8">
            <TableOfContents items={toc} />
            <Feedback slug={article.slug} supportUrl={s.supportUrl} />
          </div>
        </aside>
      )}
    </div>
  );
}
