"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { IconChevronLeft, IconPencil } from "@/components/icons";
import type { IntegrationKind } from "@/lib/integrations";
import { saveConnectionDetailsAction } from "../integration-actions";

// The shared layout of a connection's page: a header with the tool and its
// actions, then cards for Capabilities, Details, and whatever the tool needs configured.

export function ConnectionHeader({ icon, name, status, actions }: { icon: ReactNode; name: string; status: string; actions?: ReactNode }) {
  return (
    <>
      <Link href="/admin/integrations" className="mb-5 flex w-fit items-center gap-1 text-[13px] text-muted hover:text-ink">
        <IconChevronLeft size={14} /> Back to integrations
      </Link>
      <header className="rise mb-6 flex flex-wrap items-center gap-3.5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink shadow-[var(--shadow-xs)]">{icon}</span>
        <div className="min-w-0 flex-1">
          <h1 className="title text-[24px]">{name}</h1>
          <p className="text-[13px] text-muted">{status}</p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
    </>
  );
}

export function ConnectionCard({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card rise overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 className="heading">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Capabilities({ items }: { items: { icon: ReactNode; text: string }[] }) {
  return (
    <ConnectionCard title="Capabilities">
      <ul className="divide-y divide-line">
        {items.map((c) => (
          <li key={c.text} className="flex items-center gap-2.5 px-5 py-2.5 text-[13.5px] text-graphite">
            <span className="flex shrink-0 text-accent">{c.icon}</span>
            {c.text}
          </li>
        ))}
      </ul>
    </ConnectionCard>
  );
}

function DetailRow({ kind, field, label, value, placeholder }: { kind: IntegrationKind; field: "label" | "description"; label: string; value: string; placeholder: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(value);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      await saveConnectionDetailsAction(kind, field, text);
      setSaved(text);
      setEditing(false);
    });
  return (
    <div className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
      <span className="w-40 shrink-0 text-[13px] text-muted">{label}</span>
      {editing ? (
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} autoFocus maxLength={field === "label" ? 60 : 500} className="field h-8 flex-1 text-[13px]" aria-label={label} />
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              setText(saved);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="group flex flex-1 items-center gap-2">
          <span className={`flex-1 text-[13.5px] ${saved ? "text-ink" : "text-faint"}`}>{saved || placeholder}</span>
          <button type="button" onClick={() => setEditing(true)} className="btn btn-quiet btn-sm text-muted">
            <IconPencil size={13} /> Edit
          </button>
        </div>
      )}
    </div>
  );
}

export function DetailsCard({ kind, label, description, defaultLabel }: { kind: IntegrationKind; label: string; description: string; defaultLabel: string }) {
  return (
    <ConnectionCard title="Details">
      <div className="divide-y divide-line">
        <DetailRow kind={kind} field="label" label="Label" value={label || defaultLabel} placeholder={defaultLabel} />
        <DetailRow kind={kind} field="description" label="Internal description" value={description} placeholder="Add a note for your team" />
      </div>
    </ConnectionCard>
  );
}
