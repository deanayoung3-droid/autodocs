"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconArrow, IconFile, IconSearch, IconSpark } from "@/components/icons";
import { openAssistant } from "./assistant";
import { SectionIcon } from "@/components/section-icon";

export type NavSection = { slug: string; name: string; icon: string; articles: { slug: string; title: string }[] };

/** The left column on every help center page: each section and its articles. */
export function HelpSidebar({ sections }: { sections: NavSection[] }) {
  const path = usePathname();
  if (path.startsWith("/help/signin") || sections.length === 0) return null;
  return (
    <nav
      aria-label="Sections"
      className="slim-scroll hidden w-[300px] shrink-0 border-r border-line-soft lg:sticky lg:top-16 lg:block lg:h-[calc(100dvh-4rem)] lg:overflow-y-auto"
    >
      <div className="px-5 py-6">
        {sections.map((s) => {
          const sectionActive = path === `/help/c/${s.slug}`;
          return (
            <div key={s.slug} className="mb-5">
              <Link
                href={`/help/c/${s.slug}`}
                className={`flex items-center gap-2 px-2 py-1.5 text-[14px] font-semibold ${sectionActive ? "text-accent-strong" : "text-ink hover:text-accent-strong"}`}
              >
                <SectionIcon value={s.icon} size={16} className="text-faint" />
                {s.name}
              </Link>
              <ul className="flex flex-col">
                {s.articles.map((a) => {
                  const active = path === `/help/${a.slug}`;
                  return (
                    <li key={a.slug}>
                      <Link
                        href={`/help/${a.slug}`}
                        aria-current={active ? "page" : undefined}
                        className={`block truncate rounded-md py-2 pr-2 pl-2 text-[14px] leading-5 transition-colors ${
                          active ? "font-medium text-ink" : "text-muted hover:text-ink"
                        }`}
                      >
                        {a.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

type Result = { slug: string; title: string; summary: string };

/** "Search or ask AI": a button in the header that opens a quick-search dialog. ⌘K opens it anywhere. */
export function SearchPalette({ ai }: { ai: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ q: string; items: Result[] }>({ q: "", items: [] });
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`)
        .then((r) => r.json())
        .then((d: { results: Result[] }) => setResults({ q: term, items: d.results }))
        .catch(() => setResults({ q: term, items: [] }));
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const term = q.trim();
  const items = term.length >= 2 && results.q === term ? results.items : [];
  // Rows: an "ask" row when AI answers are on, then matching articles, then "see all".
  const rows: { href: string; label: string; sub?: string; kind: "ask" | "article" | "all" }[] = [
    ...(ai && term.length >= 3 ? [{ href: `/help/search?q=${encodeURIComponent(term)}`, label: `Ask AI: “${term}”`, kind: "ask" as const }] : []),
    ...items.map((r) => ({ href: `/help/${r.slug}`, label: r.title, sub: r.summary, kind: "article" as const })),
    ...(term.length >= 2 ? [{ href: `/help/search?q=${encodeURIComponent(term)}`, label: `See all results for “${term}”`, kind: "all" as const }] : []),
  ];

  function close() {
    setOpen(false);
    setQ("");
    setActive(0);
  }
  function go(row: { href: string; kind: string }) {
    close();
    // Asking AI opens the Assistant with the question; the rest are pages.
    if (row.kind === "ask") openAssistant(term);
    else router.push(row.href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-[38px] w-full max-w-[380px] items-center gap-2.5 rounded-lg border border-line bg-surface pr-1.5 pl-3.5 text-left text-[14px] text-faint transition-colors hover:border-line-strong hover:text-muted"
      >
        <IconSearch size={15} />
        <span className="flex-1 truncate">{ai ? "Search or ask AI" : "Search articles"}</span>
        <span className="flex gap-1" aria-hidden>
          <kbd className="flex size-6 items-center justify-center rounded-md border border-line bg-sunken font-sans text-[11px] text-muted">⌘</kbd>
          <kbd className="flex size-6 items-center justify-center rounded-md border border-line bg-sunken font-sans text-[11px] text-muted">K</kbd>
        </span>
      </button>
      {ai && (
        <button
          type="button"
          onClick={() => openAssistant()}
          className="ml-2 flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-[14px] text-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          <IconSpark size={15} /> Ask AI
        </button>
      )}

      {/* Rendered into the help center's root, outside the header: the header's backdrop blur
          would otherwise trap this fixed layer inside it, so the dimming stopped at the header's
          bottom edge. The root (not <body>) carries the theme and accent colour. */}
      {open &&
        createPortal(
        <div
          className="fade-in fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-[2px]"
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <div role="dialog" aria-modal="true" aria-label="Search the help center" className="pop-in w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-lg)]">
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              {ai ? <IconSpark size={16} className="text-accent" /> : <IconSearch size={16} className="text-faint" />}
              <input
                ref={input}
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") close();
                  else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, rows.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter" && rows[active]) {
                    e.preventDefault();
                    go(rows[active]);
                  }
                }}
                placeholder={ai ? "Ask, search, or explain…" : "Search articles…"}
                aria-label="Search"
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
              />
              <kbd className="rounded border border-line px-1.5 text-[11px] text-muted">Esc</kbd>
            </div>
            {rows.length > 0 ? (
              <ul className="max-h-[50vh] overflow-y-auto p-1.5">
                {rows.map((r, i) => (
                  <li key={`${r.kind}-${r.href}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(r)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${i === active ? "bg-accent-soft" : ""}`}
                    >
                      <span className="shrink-0 text-faint">
                        {r.kind === "ask" ? <IconSpark size={15} className="text-accent" /> : r.kind === "all" ? <IconSearch size={15} /> : <IconFile size={15} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[14px] ${r.kind === "article" ? "font-medium" : ""}`}>{r.label}</span>
                        {r.sub && <span className="block truncate text-[12px] text-muted">{r.sub}</span>}
                      </span>
                      {i === active && <IconArrow size={14} className="shrink-0 text-muted" />}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-[13px] text-muted">{term.length >= 2 ? "Searching…" : "Type to search every article."}</p>
            )}
          </div>
        </div>,
          document.querySelector(".help-root") ?? document.body,
        )}
    </>
  );
}
