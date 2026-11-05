"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { IconArrow, IconFile, IconGithub, IconPalette, IconPencil, IconSearch, IconShield, IconWarning, IconX } from "@/components/icons";
import { runAuditAction } from "../actions";
import { SubnavHeader } from "../secondary";
import { subRow } from "../styles";
import { SubmitButton } from "../ui";
import type { ThreadGroup, ThreadItem } from "./thread-list";

function ThreadIcon({ t }: { t: ThreadItem }) {
  if (t.status === "running") return <span className="spinner size-3 text-accent" aria-label="Working" />;
  if (t.status === "failed") return <IconWarning size={14} className="text-danger" aria-label="Failed" />;
  if (t.kind === "pr" || t.kind === "diff") return <IconGithub size={14} />;
  if (t.kind === "verify") return <IconShield size={14} />;
  if (t.kind === "audit") return <IconSearch size={14} />;
  return <IconFile size={14} />;
}

/** Docs Agent's sidebar: start something new, then every thread by date. Unread changes get a square. */
export function AgentNav({ groups, ai }: { groups: ThreadGroup[]; ai: boolean }) {
  const path = usePathname();
  const activeId = Number(path.match(/^\/admin\/agent\/(\d+)/)?.[1] ?? 0);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, items: needle ? g.items.filter((t) => t.title.toLowerCase().includes(needle)) : g.items }))
    .filter((g) => g.items.length > 0);
  const row = (active: boolean) => `${subRow(active)} w-full py-2`;

  return (
    <div className="flex h-full flex-col">
      <SubnavHeader
        title="Docs Agent"
        actions={
          <button
            type="button"
            onClick={() => {
              setSearching((s) => !s);
              setQ("");
            }}
            aria-label={searching ? "Close search" : "Search threads"}
            className="btn btn-quiet size-7 px-0 text-muted"
          >
            {searching ? <IconX size={15} /> : <IconSearch size={15} />}
          </button>
        }
      />
      {searching && (
        <div className="border-b border-line-soft p-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search threads"
            aria-label="Search threads"
            className="field h-8 text-sm"
          />
        </div>
      )}
      <div className="slim-scroll min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {!searching && (
          <div className="flex flex-col gap-0.5">
            <Link href="/admin/agent" aria-current={path === "/admin/agent" ? "page" : undefined} className={row(path === "/admin/agent")}>
              <IconPencil size={14} className="shrink-0" /> Create task
            </Link>
            <form action={runAuditAction}>
              <SubmitButton className={`${row(false)} disabled:opacity-50`} pendingLabel="Starting audit…" disabled={!ai}>
                <IconSearch size={14} className="shrink-0" /> Create audit
              </SubmitButton>
            </form>
            <Link href="/admin/settings/customize" className={row(false)}>
              <IconPalette size={14} className="shrink-0" />
              <span className="flex-1">Customize</span>
              <IconArrow size={12} className="-rotate-45 text-faint" />
            </Link>
          </div>
        )}

        {shown.length === 0 ? (
          <p className="px-3 py-6 text-sm text-muted">{needle ? `No threads match “${q}”.` : "No threads yet. Start a task and it shows up here."}</p>
        ) : (
          shown.map((g) => (
            <section key={g.label} className="mt-3">
              <h2 className="kicker px-3 pt-2 pb-1.5">{g.label}</h2>
              <ul className="flex flex-col gap-0.5">
                {g.items.map((t) => {
                  const active = t.id === activeId;
                  return (
                    <li key={t.id}>
                      <Link href={`/admin/agent/${t.id}`} aria-current={active ? "page" : undefined} className={row(active)}>
                        <span className="flex size-4 shrink-0 items-center justify-center text-faint">
                          <ThreadIcon t={t} />
                        </span>
                        <span className={`min-w-0 flex-1 truncate ${t.status === "dismissed" ? "text-faint line-through decoration-faint/50" : ""}`}>
                          {t.title}
                        </span>
                        {t.pending > 0 && t.status !== "dismissed" && (
                          <span className="size-1.5 shrink-0 rounded-[1px] bg-accent" aria-label={`${t.pending} to review`} />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
