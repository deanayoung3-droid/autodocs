"use client";

import { useState, useTransition } from "react";
import type { RepoRow } from "@/lib/github-app";
import { listBranchesAction, refreshRepositoriesAction, setProductionBranchAction, setRepositoryIncludedAction } from "../../integration-actions";

function BranchPicker({ repo }: { repo: RepoRow }) {
  const [branches, setBranches] = useState<string[] | null>(null);
  const [value, setValue] = useState(repo.production_branch ?? "");
  const [pending, start] = useTransition();
  return (
    <select
      aria-label={`Production branch for ${repo.full_name}`}
      value={value}
      disabled={pending}
      onFocus={() => {
        if (!branches) listBranchesAction(repo.full_name).then(setBranches, () => setBranches([]));
      }}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        start(() => setProductionBranchAction(repo.id, next || null));
      }}
      className="field h-8 w-auto max-w-[14rem] font-mono text-[12.5px]"
    >
      <option value="">{repo.default_branch} · Default</option>
      {value && !(branches ?? []).includes(value) && <option value={value}>{value}</option>}
      {(branches ?? []).filter((b) => b !== repo.default_branch).map((b) => (
        <option key={b} value={b}>
          {b}
        </option>
      ))}
      {!branches && <option disabled>Loading branches…</option>}
    </select>
  );
}

function IncludedToggle({ repo }: { repo: RepoRow }) {
  const [on, setOn] = useState(repo.included);
  const [pending, start] = useTransition();
  return (
    <label className="flex shrink-0 items-center gap-2 text-[13px] text-muted">
      {on ? "Included" : "Ignored"}
      <input
        type="checkbox"
        role="switch"
        aria-label={`Use ${repo.full_name}`}
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          start(() => setRepositoryIncludedAction(repo.id, next));
        }}
        className="toggle"
      />
    </label>
  );
}

/** Which repositories Docs Agent uses, and the branch that counts as shipped for each. Saves as you change it. */
export function Repositories({ repos }: { repos: RepoRow[] }) {
  const [q, setQ] = useState("");
  const [refreshing, start] = useTransition();
  const shown = repos.filter((r) => r.full_name.toLowerCase().includes(q.trim().toLowerCase()));
  const included = repos.filter((r) => r.included).length;
  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-graphite">
          <span className="num font-semibold text-ink">{included}</span> of <span className="num">{repos.length}</span> repositories included
        </p>
        {repos.length > 6 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search repositories" aria-label="Search repositories" className="field h-8 max-w-56 text-[13px]" />}
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {shown.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{r.full_name}</span>
            <BranchPicker repo={r} />
            <IncludedToggle repo={r} />
          </li>
        ))}
        {!shown.length && <li className="px-3.5 py-3 text-[13px] text-muted">{repos.length ? "No repositories match." : "The app can't see any repositories yet."}</li>}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
        <span>New repositories are included automatically. Changes save as you make them.</span>
        <button type="button" className="btn btn-sm" disabled={refreshing} onClick={() => start(() => refreshRepositoriesAction())}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}
