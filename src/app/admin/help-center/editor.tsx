"use client";

import { useEffect, useState, type ReactNode } from "react";
import { IconCheck, IconCode, IconExternal, IconFile, IconGear, IconMore, IconPencil } from "@/components/icons";
import { SectionIcon } from "@/components/section-icon";
import { deleteArticleAction, saveArticleAction } from "../actions";
import { ActionForm, FormMessage, SubmitButton, useActionForm } from "../ui";
import { RichMarkdown } from "./rich-editor";

type EditorArticle = {
  id: number;
  slug: string;
  title: string;
  summary: string;
  body: string;
  collection_id: number | null;
  status: "draft" | "published";
  restricted: number;
};

const menuRow = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-graphite transition-colors hover:bg-well hover:text-ink";

/**
 * An article edited as the document it becomes: section, title, then the body in place, styled like
 * the help center. A slim bar on top holds the status and Save; the gear holds the summary,
 * address, and access; the menu holds the Markdown view, unpublish, and delete.
 */
export function ArticleEditor({
  article,
  collections,
  defaultCollection,
  updated,
  meta,
  notice,
  canPublish = true,
}: {
  article: EditorArticle | null;
  collections: { id: number; name: string; depth: number; icon: string }[];
  defaultCollection?: number | null;
  /** "updated 13h ago", shown in the top bar. */
  updated?: string;
  meta?: ReactNode;
  notice?: ReactNode;
  /** Contributors save drafts; their edits to live articles go to review. */
  canPublish?: boolean;
}) {
  const form = useActionForm(saveArticleAction);
  const [body, setBody] = useState(article?.body ?? "");
  const [collection, setCollection] = useState(String(article?.collection_id ?? defaultCollection ?? ""));
  const [markdown, setMarkdown] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const published = article?.status === "published";
  const section = collections.find((c) => String(c.id) === collection);
  const edit = (md: string) => {
    setBody(md);
    setDirty(true);
  };

  return (
    <>
      <ActionForm
        form={{
          ...form,
          onSubmit: (e) => {
            setDirty(false);
            form.onSubmit(e);
          },
        }}
        onChange={() => setDirty(true)}
      >
        {article && <input type="hidden" name="id" value={article.id} />}
        <input type="hidden" name="body" value={body} />

        <div className="sticky top-0 z-20 flex h-12 items-center justify-between gap-3 border-b border-line-soft bg-surface/90 px-4 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted">
            {published ? (
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-success text-white">
                <IconCheck size={10} strokeWidth={3} />
              </span>
            ) : (
              <span className="size-3.5 shrink-0 rounded-full border-[1.5px] border-dashed border-faint" />
            )}
            <span className="truncate">
              {article ? (published ? "Published" : "Draft") : "New article"}
              {updated && ` · ${updated}`}
            </span>
            {published && article && (
              <a href={`/help/${article.slug}`} target="_blank" className="flex shrink-0 items-center gap-1 transition-colors hover:text-ink">
                View <IconExternal size={12} />
              </a>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {dirty && <span className="mr-1 hidden text-xs text-faint sm:inline">Unsaved changes</span>}
            {published ? (
              <SubmitButton name="intent" value="save" className="btn btn-primary btn-sm" pendingLabel={canPublish ? "Saving…" : "Sending…"} disabled={!dirty}>
                {canPublish ? "Save changes" : "Suggest changes"}
              </SubmitButton>
            ) : !canPublish ? (
              <SubmitButton name="intent" value="save" className="btn btn-primary btn-sm" pendingLabel="Saving…">
                Save draft
              </SubmitButton>
            ) : (
              <>
                <SubmitButton name="intent" value="save" className="btn btn-sm" pendingLabel="Saving…">
                  Save draft
                </SubmitButton>
                <SubmitButton name="intent" value="publish" className="btn btn-primary btn-sm" pendingLabel="Publishing…">
                  Publish
                </SubmitButton>
              </>
            )}

            <details className="relative">
              <summary className="btn btn-quiet size-8 list-none px-0 text-muted" aria-label="Article settings" title="Article settings">
                <IconGear size={16} />
              </summary>
              <div className="pop-in absolute right-0 z-30 mt-1.5 flex w-80 flex-col gap-4 rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-pop)]">
                <div>
                  <label className="label" htmlFor="ed-summary">
                    Summary
                  </label>
                  <textarea
                    id="ed-summary"
                    name="summary"
                    defaultValue={article?.summary}
                    rows={2}
                    maxLength={300}
                    placeholder="One line, shown in search results"
                    className="field text-sm"
                  />
                </div>
                {article && (
                  <div>
                    <label className="label" htmlFor="ed-slug">
                      Address
                    </label>
                    <div className="field flex items-center gap-0.5 text-sm focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
                      <span className="text-faint">/help/</span>
                      <input id="ed-slug" name="slug" defaultValue={article.slug} className="min-w-0 flex-1 bg-transparent outline-none" />
                    </div>
                  </div>
                )}
                <label className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" name="restricted" defaultChecked={Boolean(article?.restricted)} className="mt-0.5 size-4 accent-[var(--accent)]" />
                  <span>
                    Restricted
                    <span className="block text-muted">Only signed-in readers can see it.</span>
                  </span>
                </label>
              </div>
            </details>

            <details className="relative">
              <summary className="btn btn-quiet size-8 list-none px-0 text-muted" aria-label="More" title="More">
                <IconMore size={16} />
              </summary>
              <div className="pop-in absolute right-0 z-30 mt-1.5 w-56 rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
                <button type="button" className={menuRow} onClick={() => setMarkdown((m) => !m)}>
                  {markdown ? <IconFile size={14} /> : <IconCode size={14} />}
                  {markdown ? "Edit as a document" : "Edit Markdown"}
                </button>
                {published && canPublish && (
                  <SubmitButton name="intent" value="unpublish" className={menuRow} pendingLabel="Unpublishing…">
                    Unpublish
                  </SubmitButton>
                )}
                {article && (
                  <button
                    type="submit"
                    form="article-delete"
                    className={`${menuRow} text-danger-strong hover:bg-danger-soft hover:text-danger-strong`}
                    onClick={(e) => {
                      if (!confirm(`Delete “${article.title}”? It stays in Recently deleted for 30 days.`)) e.preventDefault();
                    }}
                  >
                    Delete article
                  </button>
                )}
              </div>
            </details>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[760px] px-4 pt-10 pb-10 md:px-8">
          {notice}
          <div className="flex flex-wrap items-center gap-2">
            <label className="group inline-flex items-center gap-1.5 text-sm text-muted">
              <SectionIcon value={section?.icon || "folder"} size={14} />
              <span className="sr-only">Section</span>
              <select
                name="collection"
                value={collection}
                onChange={(e) => setCollection(e.target.value)}
                className="max-w-[16rem] cursor-pointer appearance-none bg-transparent text-ink outline-none"
              >
                <option value="">No section</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {"  ".repeat(c.depth)}
                    {c.name}
                  </option>
                ))}
                <option value="new">New section…</option>
              </select>
              <IconPencil size={12} className="text-faint transition-colors group-hover:text-muted" />
            </label>
            {collection === "new" && (
              <input name="newCollection" className="field h-8 max-w-[14rem] text-sm" placeholder="New section name" aria-label="New section name" autoFocus />
            )}
          </div>

          <input
            name="title"
            defaultValue={article?.title}
            placeholder="Article title"
            aria-label="Title"
            required
            maxLength={200}
            className="title mt-3 w-full bg-transparent outline-none placeholder:text-faint"
          />
          {meta && <div className="mt-2">{meta}</div>}

          <div className="mt-6">
            {markdown ? (
              <>
                <label className="sr-only" htmlFor="ed-body">
                  Body in Markdown
                </label>
                <textarea
                  id="ed-body"
                  value={body}
                  onChange={(e) => edit(e.target.value)}
                  className="field min-h-[560px] font-mono text-[13px] leading-relaxed"
                />
              </>
            ) : (
              <RichMarkdown value={body} onChange={edit} />
            )}
          </div>

          <div className="mt-4">
            <FormMessage state={form.state} />
          </div>
        </div>
      </ActionForm>

      {article && (
        <form id="article-delete" action={deleteArticleAction} hidden>
          <input type="hidden" name="id" value={article.id} />
        </form>
      )}
    </>
  );
}
