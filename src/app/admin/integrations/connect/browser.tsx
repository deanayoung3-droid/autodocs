"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { IconCheck, IconChevronRight, IconSearch } from "@/components/icons";

type Item = { id: string; name: string; icon: ReactNode; href: string; categories: string[]; connected: boolean; pitch: string };

/** The catalog: filter by category or name, then open an integration to connect it. */
export function CatalogBrowser({ items, categories }: { items: Item[]; categories: string[] }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const matches = (i: Item) => !needle || `${i.name} ${i.pitch} ${i.categories.join(" ")}`.toLowerCase().includes(needle);
  const shown = categories
    .filter((c) => !category || c === category)
    .map((c) => ({ c, list: items.filter((i) => i.categories.includes(c) && matches(i)) }))
    .filter((g) => g.list.length);

  return (
    <div className="flex flex-col gap-8 md:flex-row">
      <nav aria-label="Categories" className="flex shrink-0 flex-row flex-wrap gap-1 md:w-44 md:flex-col">
        {[null, ...categories].map((c) => (
          <button
            key={c ?? "all"}
            type="button"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
            className={`rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${category === c ? "bg-well font-medium text-ink" : "text-muted hover:bg-sunken hover:text-ink"}`}
          >
            {c ?? "All integrations"}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        <label className="relative mb-6 block">
          <span className="sr-only">Search integrations</span>
          <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search integrations" className="field pl-9" />
        </label>
        {shown.length ? (
          <div className="flex flex-col gap-8">
            {shown.map(({ c, list }) => (
              <section key={c} aria-labelledby={`cat-${c}`}>
                <h2 id={`cat-${c}`} className="mb-3 text-[13px] font-semibold text-graphite">
                  {c} <span className="num font-normal text-muted">{list.length}</span>
                </h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {list.map((i) => (
                    <li key={i.id}>
                      <Link href={i.href} className="card group flex h-full items-start gap-3 p-4 transition-colors hover:border-line-strong">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink shadow-[var(--shadow-xs)]">{i.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 font-semibold">
                            {i.name}
                            {i.connected && (
                              <span className="flex items-center gap-0.5 text-[12px] font-normal text-success">
                                <IconCheck size={12} /> Connected
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-[13px] text-muted">{i.pitch}</span>
                        </span>
                        <IconChevronRight size={14} className="mt-1 shrink-0 text-faint group-hover:text-ink" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
            Nothing matches &ldquo;{q}&rdquo;. Helpdesks not listed can send conversations through the{" "}
            <Link href="/admin/integrations/support" className="link">
              Support Endpoint
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
