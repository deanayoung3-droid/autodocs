"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { subRow } from "./styles";

export type SubItem = {
  href: string;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
  external?: boolean;
  /** Active only on this exact path (and query, when the href has one). */
  exact?: boolean;
};
export type SubGroup = { label?: string; action?: ReactNode; items: SubItem[] };

function isActive(item: SubItem, path: string, query: string) {
  const [base, q] = item.href.split("?");
  if (q) return path === base && query.includes(q);
  return item.exact ? path === base : path === base || path.startsWith(`${base}/`);
}

export function SubLink({ item, className = "" }: { item: SubItem; className?: string }) {
  const path = usePathname();
  const query = useSearchParams().toString();
  const active = !item.external && isActive(item, path, query);
  return (
    <Link
      href={item.href}
      target={item.external ? "_blank" : undefined}
      aria-current={active ? "page" : undefined}
      className={`${subRow(active)} ${className}`}
    >
      {item.icon && <span className={`flex shrink-0 ${active ? "text-ink" : "text-faint group-hover:text-muted"}`}>{item.icon}</span>}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge}
    </Link>
  );
}

/** The header row of a section's sidebar: its name on the left, small icon actions on the right. */
export function SubnavHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line-soft px-4">
      <p className="flex min-w-0 items-center gap-2 truncate text-sm text-ink">{title}</p>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}

/** The second column: a title row, then labelled groups of links, then anything extra (trees, lists). */
export function SecondaryNav({
  title,
  actions,
  groups,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  groups: SubGroup[];
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <SubnavHeader title={title} actions={actions} />
      <div className="slim-scroll min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {groups.map((g, i) => (
          <div key={g.label ?? i} className={i > 0 ? "mt-3" : ""}>
            {g.label && (
              <div className="flex items-center justify-between px-3 pt-2 pb-1.5">
                <p className="kicker">{g.label}</p>
                {g.action}
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {g.items.map((item) => (
                <SubLink key={item.href} item={item} />
              ))}
            </div>
          </div>
        ))}
        {children}
      </div>
    </div>
  );
}

/** Lays out a section: its own sidebar column beside the page. Stacks on phones. */
export function SubnavShell({ nav, children, wide = false }: { nav: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside
        className={`border-b border-line bg-surface md:sticky md:top-0 md:h-dvh md:shrink-0 md:border-r md:border-b-0 ${wide ? "md:w-[320px]" : "md:w-[272px]"}`}
      >
        {nav}
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** The thin bar across the top of a detail page: what it is on the left, actions on the right. */
export function PageBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 flex h-12 items-center justify-between gap-3 border-b border-line-soft bg-surface/90 px-4 backdrop-blur md:px-6">
      <div className="flex min-w-0 items-center gap-2 text-sm text-muted">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Page header used across the app: the title, a one-line description, and actions on the right. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="rise mb-8 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="kicker mb-2 text-accent-strong">{eyebrow}</p>}
        <h1 className="title">{title}</h1>
        {description && <p className="mt-1.5 text-base text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A settings card: a heading and description, the fields, and an optional footer bar for the save button. */
export function Section({
  title,
  description,
  children,
  footer,
  id,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  id?: string;
}) {
  return (
    <section className="rise card flex flex-col overflow-hidden" aria-labelledby={id}>
      <div className="flex flex-col gap-5 p-5">
        <div>
          <h2 id={id} className="heading">
            {title}
          </h2>
          {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
        </div>
        {children}
      </div>
      {footer && <div className="card-footer">{footer}</div>}
    </section>
  );
}
