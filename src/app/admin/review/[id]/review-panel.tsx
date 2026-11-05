"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { IconCheck, IconChevronLeft, IconChevronRight } from "@/components/icons";
import type { DiffBlock } from "@/lib/markdown";
import { approveProposalAction, previewMarkdownAction, rejectProposalAction, renderDiffAction } from "../../actions";
import { FormMessage, SubmitButton } from "../../ui";

type Tab = "changes" | "preview" | "edit";

export function ReviewPanel({
  proposal,
  baseBody,
  initialHtml,
  initialDiff,
  collections,
  collectionId,
  returnTo,
  dismiss,
  actions,
  fields,
}: {
  proposal: { id: number; action: "create" | "update"; title: string; summary: string; body: string };
  baseBody: string | null;
  initialHtml: string;
  initialDiff: DiffBlock[];
  collections: { id: number; name: string; depth: number }[];
  collectionId: number | null;
  /** Where to land after publishing or rejecting, instead of the thread's next change. */
  returnTo?: string;
  /** Replaces Reject on the left of the footer, e.g. Verification's "Not an issue". */
  dismiss?: ReactNode;
  /** Extra footer buttons beside Publish. They submit this form, so they use formAction. */
  actions?: ReactNode;
  /** Extra hidden fields those buttons need. */
  fields?: Record<string, string | number>;
}) {
  const [state, formAction] = useActionState(approveProposalAction, undefined);
  const [tab, setTab] = useState<Tab>(baseBody === null ? "preview" : "changes");
  const [title, setTitle] = useState(proposal.title);
  const [summary, setSummary] = useState(proposal.summary);
  const [body, setBody] = useState(proposal.body);
  const [preview, setPreview] = useState({ source: proposal.body, html: initialHtml });
  const [diff, setDiff] = useState({ source: proposal.body, blocks: initialDiff });
  const edited = title !== proposal.title || summary !== proposal.summary || body !== proposal.body;

  // Server-rendered (and sanitized) preview and diff, refreshed after edits.
  useEffect(() => {
    if (tab === "preview" && preview.source !== body) {
      let live = true;
      previewMarkdownAction(body).then((html) => live && setPreview({ source: body, html }));
      return () => {
        live = false;
      };
    }
    if (tab === "changes" && baseBody !== null && diff.source !== body) {
      let live = true;
      renderDiffAction(baseBody, body).then((blocks) => live && setDiff({ source: body, blocks }));
      return () => {
        live = false;
      };
    }
  }, [tab, body, baseBody, preview.source, diff.source]);

  const tabs: { id: Tab; label: string }[] = [
    ...(baseBody === null ? [] : [{ id: "changes" as const, label: "Changes" }]),
    { id: "preview", label: "Preview" },
    { id: "edit", label: edited ? "Edit ·" : "Edit" },
  ];

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={proposal.id} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="summary" value={summary} />
      <input type="hidden" name="body" value={body} />
      {Object.entries(fields ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">{edited ? "You edited Docs Agent's draft" : proposal.action === "create" ? "New article" : ""}</p>
        <div role="tablist" aria-label="View" className="segmented">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-64">
        {tab === "changes" && <RenderedDiff blocks={diff.blocks} busy={diff.source !== body} />}
        {tab === "preview" && (
          <div className="rounded-lg border border-line px-5 py-5 md:px-9 md:py-8">
            <h2 className="heading mb-1">{title}</h2>
            {summary && <p className="mb-6 text-muted">{summary}</p>}
            <div className="prose-doc" aria-busy={preview.source !== body} dangerouslySetInnerHTML={{ __html: preview.html }} />
          </div>
        )}
        {tab === "edit" && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="label" htmlFor="rv-title">
                Title
              </label>
              <input id="rv-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="rv-summary">
                Summary
              </label>
              <input id="rv-summary" className="field" value={summary} onChange={(e) => setSummary(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="rv-body">
                Body (Markdown)
              </label>
              <textarea
                id="rv-body"
                className="field min-h-[420px] font-mono text-[13px]"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      {proposal.action === "create" && (
        <div className="mt-5 max-w-xs">
          <label className="label" htmlFor="rv-collection">
            Section
          </label>
          <select id="rv-collection" name="collection" className="field" defaultValue={collectionId ?? ""}>
            <option value="">No section</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {"  ".repeat(c.depth)}
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-5">
        <FormMessage state={state} />
      </div>

      <div className="sticky bottom-0 z-10 mt-4 flex items-center gap-2 border-t border-line bg-surface/95 py-3 backdrop-blur">
        {dismiss ?? (
          <SubmitButton formAction={rejectProposalAction} className="btn btn-quiet" pendingLabel="Rejecting…">
            Reject
          </SubmitButton>
        )}
        <span className="ml-auto" />
        {actions}
        <SubmitButton name="intent" value="approve" pendingLabel="Publishing…">
          <IconCheck size={15} /> {edited ? "Publish with edits" : "Publish changes"}
        </SubmitButton>
      </div>
    </form>
  );
}

/** Rendered article with added and removed blocks marked, long unchanged runs folded, and change-to-change navigation. */
function RenderedDiff({ blocks, busy }: { blocks: DiffBlock[]; busy: boolean }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [current, setCurrent] = useState(0);
  const changeRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Group consecutive changed blocks into one "change" for navigation.
  const items: ({ type: "block"; block: DiffBlock; change: number | null } | { type: "fold"; at: number; count: number })[] = [];
  let changeCount = 0;
  let prevChanged = false;
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.kind !== "same") {
      if (!prevChanged) changeCount++;
      items.push({ type: "block", block: b, change: prevChanged ? null : changeCount - 1 });
      prevChanged = true;
      i++;
      continue;
    }
    prevChanged = false;
    let j = i;
    while (j < blocks.length && blocks[j].kind === "same") j++;
    const run = blocks.slice(i, j);
    if (run.length > 3 && !expanded.has(i)) {
      if (i > 0) items.push({ type: "block", block: run[0], change: null });
      items.push({ type: "fold", at: i, count: run.length - (i > 0 ? 1 : 0) - (j < blocks.length ? 1 : 0) });
      if (j < blocks.length) items.push({ type: "block", block: run[run.length - 1], change: null });
    } else {
      run.forEach((block) => items.push({ type: "block", block, change: null }));
    }
    i = j;
  }

  function go(n: number) {
    const next = Math.max(0, Math.min(changeCount - 1, n));
    setCurrent(next);
    changeRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div aria-busy={busy} className="relative">
      <div className="rounded-lg border border-line px-5 py-5 md:px-9 md:py-8">
        {items.map((item, k) =>
          item.type === "fold" ? (
            <button
              key={`f${k}`}
              type="button"
              onClick={() => setExpanded(new Set(expanded).add(item.at))}
              className="my-3 block w-full rounded-md bg-sunken py-1.5 text-center text-[12px] text-muted hover:text-ink"
            >
              Show {item.count} unchanged {item.count === 1 ? "section" : "sections"}
            </button>
          ) : (
            <div
              key={`b${k}`}
              ref={item.change !== null ? (el) => void (changeRefs.current[item.change!] = el) : undefined}
              className={
                item.block.kind === "same"
                  ? "py-1"
                  : `-mx-2 my-1 rounded-lg px-2 py-1 transition-shadow ${
                      item.change !== null && item.change === current ? "shadow-[0_0_0_2px_var(--accent-line)]" : ""
                    } ${item.block.kind === "del" ? "text-[var(--del-ink)]" : ""}`
              }
              style={
                item.block.kind === "add"
                  ? { background: "var(--add-bg)" }
                  : item.block.kind === "del"
                    ? { background: "var(--del-bg)", textDecoration: "line-through", textDecorationColor: "var(--del-ink)" }
                    : undefined
              }
            >
              {item.block.kind !== "same" && (
                <span className="sr-only">{item.block.kind === "add" ? "Added:" : "Removed:"}</span>
              )}
              <div className="prose-doc prose-compact" dangerouslySetInnerHTML={{ __html: item.block.html }} />
            </div>
          ),
        )}
      </div>
      {changeCount > 0 && (
        <div className="pointer-events-none sticky bottom-20 z-10 mt-3 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-surface py-1 pr-1 pl-3.5 text-[12px] text-graphite shadow-[var(--shadow-lg)]">
            <span className="num mr-1">
              Change {current + 1} of {changeCount}
            </span>
            <button type="button" aria-label="Previous change" className="btn btn-quiet size-7 rounded-full px-0" onClick={() => go(current - 1)} disabled={current === 0}>
              <IconChevronLeft size={14} className="rotate-90" />
            </button>
            <button
              type="button"
              aria-label="Next change"
              className="btn btn-quiet size-7 rounded-full px-0"
              onClick={() => go(current + 1)}
              disabled={current >= changeCount - 1}
            >
              <IconChevronRight size={14} className="rotate-90" />
            </button>
          </div>
        </div>
      )}
      {changeCount === 0 && <p className="mt-3 text-center text-[13px] text-muted">No changes to the text.</p>}
    </div>
  );
}
