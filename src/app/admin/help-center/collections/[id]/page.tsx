import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { IconChevronRight, IconExternal, IconFile, IconFolder, IconHome, IconLock, IconPlus } from "@/components/icons";
import { collectionPath, collectionTree, flattenTree, getCollection, listArticles } from "@/lib/articles";
import { timeAgo } from "@/lib/format";
import { deleteCollectionAction, moveCollectionAction } from "../../../actions";
import { PageBar } from "../../../secondary";
import { SubmitButton } from "../../../ui";
import { SectionForm } from "../../sections";
import { SectionIcon } from "@/components/section-icon";

const SAVED: Record<string, string> = { created: "Section created.", section: "Section saved." };

// Job: a person is organizing one section, and next they open an article or change the section's settings.
export default async function CollectionPage({ params, searchParams }: PageProps<"/admin/help-center/collections/[id]">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const c = await getCollection(Number(id));
  if (!c) notFound();
  const tab = sp.tab === "settings" ? "settings" : "content";

  const all = flattenTree(await collectionTree());
  const node = all.find((n) => n.id === c.id);
  const children = node?.children ?? [];
  const siblings = all.filter((n) => n.parent_id === c.parent_id);
  const pos = siblings.findIndex((n) => n.id === c.id);
  const articles = await listArticles({ collectionId: c.id, order: "position" });
  const trail = (await collectionPath(c.id)).slice(0, -1);
  // A section can't move inside itself or its own descendants.
  const descendants = new Set<number>();
  const collect = (ns: typeof children) => ns.forEach((n) => (descendants.add(n.id), collect(n.children)));
  collect(children);

  return (
    <div>
      <PageBar
        actions={
          <a href={`/help/c/${c.slug}`} target="_blank" className="btn h-8 px-3 text-[12px]">
            View <IconExternal size={13} />
          </a>
        }
      >
        <IconFolder size={14} /> <span className="font-medium text-graphite">Section</span>
      </PageBar>

      <div className="mx-auto max-w-[760px] px-4 py-10 md:px-8">
        <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
          <Link href="/admin/help-center" className="flex items-center gap-1 hover:text-ink">
            <IconHome size={13} /> Home
          </Link>
          {trail.map((t) => (
            <span key={t.id} className="flex items-center gap-1.5">
              <IconChevronRight size={12} className="text-faint" />
              <Link href={`/admin/help-center/collections/${t.id}`} className="hover:text-ink">
                {t.name}
              </Link>
            </span>
          ))}
        </nav>
        <div className="rise flex items-center gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-line bg-sunken text-[24px] text-graphite">
            <SectionIcon value={c.icon || "folder"} size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="title flex items-center gap-2 text-[28px]">
              {c.name}
              {c.restricted ? <IconLock size={16} className="text-faint" aria-label="Restricted" /> : null}
            </h1>
            {c.description && <p className="mt-0.5 text-muted">{c.description}</p>}
          </div>
        </div>

        {typeof sp.saved === "string" && SAVED[sp.saved] && (
          <p role="status" className="notice mt-6">
            {SAVED[sp.saved]}
          </p>
        )}

        <div role="tablist" className="mt-7 flex gap-1 border-b border-line">
          <Link href={`/admin/help-center/collections/${c.id}`} role="tab" aria-selected={tab === "content"} className="tab">
            Content
          </Link>
          <Link href={`/admin/help-center/collections/${c.id}?tab=settings`} role="tab" aria-selected={tab === "settings"} className="tab">
            Settings &amp; access
          </Link>
        </div>

        {tab === "content" ? (
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold">In this section</h2>
              <div className="flex gap-2">
                <Link href={`/admin/help-center/collections/new?parent=${c.id}`} className="btn h-8 px-3 text-[12px]">
                  <IconPlus size={13} /> Sub-section
                </Link>
                <Link href={`/admin/help-center/articles/new?collection=${c.id}`} className="btn btn-primary h-8 px-3 text-[12px]">
                  <IconPlus size={13} /> Article
                </Link>
              </div>
            </div>
            {children.length === 0 && articles.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong px-6 py-10 text-center text-muted">
                Nothing here yet. Add an article, or ask Docs Agent to write one.
              </p>
            ) : (
              <ul className="card divide-y divide-line overflow-hidden">
                {children.map((n) => (
                  <li key={`c${n.id}`}>
                    <Link href={`/admin/help-center/collections/${n.id}`} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-sunken">
                      <SectionIcon value={n.icon || "folder"} size={15} className="text-faint" />
                      <span className="min-w-0 flex-1 truncate font-medium">{n.name}</span>
                      <span className="num text-[12px] text-muted">{n.total} articles</span>
                      <IconChevronRight size={14} className="text-faint transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
                {articles.map((a) => (
                  <li key={`a${a.id}`}>
                    <Link href={`/admin/help-center/articles/${a.id}`} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-sunken">
                      <IconFile size={15} className="text-faint" />
                      <span className={`min-w-0 flex-1 truncate ${a.status === "draft" ? "text-muted" : ""}`}>{a.title}</span>
                      {a.status === "draft" && <span className="chip">Draft</span>}
                      <span className="hidden text-[12px] text-muted sm:inline">{timeAgo(a.updated_at)}</span>
                      <IconChevronRight size={14} className="text-faint transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-8">
            <SectionForm
              key={`${c.id}-${c.name}-${c.parent_id}`}
              options={all.filter((n) => n.id !== c.id && !descendants.has(n.id)).map((n) => ({ id: n.id, name: n.name, depth: n.depth }))}
              section={{ id: c.id, name: c.name, description: c.description, icon: c.icon, parent_id: c.parent_id, restricted: Boolean(c.restricted) }}
            />
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-6">
              <span className="mr-2 text-[13px] text-muted">Order among siblings</span>
              <form action={moveCollectionAction}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="direction" value="up" />
                <SubmitButton className="btn h-8 px-3 text-[12px]" disabled={pos <= 0}>
                  Move up
                </SubmitButton>
              </form>
              <form action={moveCollectionAction}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="direction" value="down" />
                <SubmitButton className="btn h-8 px-3 text-[12px]" disabled={pos === siblings.length - 1}>
                  Move down
                </SubmitButton>
              </form>
            </div>
            <form action={deleteCollectionAction} className="border-t border-line pt-6">
              <input type="hidden" name="id" value={c.id} />
              <p className="mb-2 text-[13px] text-muted">
                Deleting moves its {articles.length} {articles.length === 1 ? "article" : "articles"} and sub-sections up one level. Nothing is lost.
              </p>
              <SubmitButton className="btn btn-danger" pendingLabel="Deleting…">
                Delete section
              </SubmitButton>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
