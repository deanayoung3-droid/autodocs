import "server-only";
import { parseSqlDate } from "@/lib/format";
import { listThreads, type Thread } from "@/lib/proposals";

export const KIND_LABEL: Record<string, string> = {
  pr: "Code change",
  diff: "Code change",
  notes: "Support notes",
  task: "Task",
  audit: "Audit",
  verify: "Verification fix",
  bulk: "Bulk edit",
};

const GROUPS = ["Today", "Yesterday", "Last 7 days", "Last 30 days", "Older"] as const;

export type ThreadItem = { id: number; title: string; kind: string; status: string; pending: number };
export type ThreadGroup = { label: string; items: ThreadItem[] };

function group(t: Thread, now: Date): (typeof GROUPS)[number] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const at = parseSqlDate(t.created_at).getTime();
  if (at >= startOfToday) return "Today";
  if (at >= startOfToday - 86_400_000) return "Yesterday";
  if (at >= startOfToday - 6 * 86_400_000) return "Last 7 days";
  if (at >= startOfToday - 29 * 86_400_000) return "Last 30 days";
  return "Older";
}

/** Docs Agent's threads, newest first, grouped by date, as plain data for the sidebar. */
export async function threadGroups(): Promise<ThreadGroup[]> {
  const now = new Date();
  const grouped = new Map<string, ThreadItem[]>();
  for (const t of await listThreads({ limit: 300 })) {
    const g = group(t, now);
    grouped.set(g, [
      ...(grouped.get(g) ?? []),
      { id: t.id, title: t.source_title, kind: t.kind, status: t.status, pending: t.pending_count },
    ]);
  }
  return GROUPS.filter((g) => grouped.has(g)).map((label) => ({ label, items: grouped.get(label)! }));
}
