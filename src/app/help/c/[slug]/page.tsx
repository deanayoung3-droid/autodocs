import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { connection } from "next/server";
import { IconArrow } from "@/components/icons";
import { collectionPath, collectionRestricted, collectionTree, flattenTree, getCollectionBySlug, listArticles } from "@/lib/articles";
import { redirectFor } from "@/lib/articles";
import { currentReader } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { visibleCount } from "../../page";
import { SectionIcon } from "@/components/section-icon";

export default async function CollectionPage({ params }: PageProps<"/help/c/[slug]">) {
  await connection();
  const { slug } = await params;
  const s = await getSettings();
  const signedIn = (await currentReader()) !== null;
  const collection = await getCollectionBySlug(slug);
  if (!collection) {
    const to = await redirectFor(`/help/c/${slug}`);
    if (to) permanentRedirect(to);
    notFound();
  }
  if ((s.siteVisibility === "private" || await collectionRestricted(collection.id)) && !signedIn) {
    redirect(`/help/signin?next=${encodeURIComponent(`/help/c/${slug}`)}`);
  }

  const node = flattenTree(await collectionTree()).find((n) => n.id === collection.id);
  const children = (node?.children ?? []).filter((c) => visibleCount(c, signedIn) > 0);
  const articles = (await listArticles({ status: "published", collectionId: collection.id, order: "position" })).filter(
    (a) => signedIn || !a.restricted,
  );
  const path = (await collectionPath(collection.id)).slice(0, -1);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-10 md:py-14">
      <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
        <Link href="/help" className="hover:text-ink">
          Help Center
        </Link>
        {path.map((p) => (
          <span key={p.id} className="flex items-center gap-1.5">
            <span className="text-faint">/</span>
            <Link href={`/help/c/${p.slug}`} className="hover:text-ink">
              {p.name}
            </Link>
          </span>
        ))}
      </nav>
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-[24px] text-graphite shadow-[var(--shadow-xs)]">
          <SectionIcon value={collection.icon} size={24} />
        </span>
        <div>
          <h1 className="display text-[34px] text-ink-strong">{collection.name}</h1>
          {collection.description && <p className="mt-1 text-[16px] text-graphite">{collection.description}</p>}
        </div>
      </div>

      {children.length > 0 && (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {children.map((c, i) => (
            <li key={c.id} className="rise" style={{ "--i": i } as React.CSSProperties}>
              <Link href={`/help/c/${c.slug}`} className="card card-hover group block px-4 py-3.5">
                <span className="block font-semibold transition-colors group-hover:text-accent">
                  <SectionIcon value={c.icon} size={15} className="mr-1.5 inline-block align-[-2px] text-faint" />
                  {c.name}
                </span>
                <span className="num block text-[13px] text-muted">
                  {visibleCount(c, signedIn)} {visibleCount(c, signedIn) === 1 ? "article" : "articles"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {articles.length === 0 && children.length === 0 ? (
        <p className="mt-8 text-muted">No articles in this topic yet.</p>
      ) : (
        articles.length > 0 && (
          <ul className="card mt-8 divide-y divide-line overflow-hidden">
            {articles.map((a, i) => (
              <li key={a.id} className="rise" style={{ "--i": i } as React.CSSProperties}>
                <Link href={`/help/${a.slug}`} className="group flex items-center gap-3 px-5 py-4 transition-colors hover:bg-sunken">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium transition-colors group-hover:text-accent">{a.title}</span>
                    {a.summary && <span className="block text-[14px] text-muted">{a.summary}</span>}
                  </span>
                  <IconArrow size={15} className="shrink-0 text-faint transition-all group-hover:translate-x-0.5 group-hover:text-accent" />
                </Link>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
