"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Shows a browser notification when a thread you started finishes, while the admin is open in any tab. */
export function TaskNotifier({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    let since = new Date().toISOString();
    let stopped = false;
    const check = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/admin/finished?since=${encodeURIComponent(since)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { now: string; threads: { id: number; source_title: string; status: string; summary: string | null }[] };
        since = data.now;
        for (const t of data.threads) {
          const n = new Notification(t.status === "done" ? `Docs Agent finished: ${t.source_title}` : `Docs Agent couldn't finish: ${t.source_title}`, {
            body: (t.summary ?? "").slice(0, 180),
            icon: "/api/agent-image",
            tag: `thread-${t.id}`,
          });
          n.onclick = () => {
            window.focus();
            router.push(`/admin/agent/${t.id}`);
          };
        }
      } catch {
        // Offline or signed out; try again on the next tick.
      }
    };
    const timer = setInterval(check, 20_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [enabled, router]);
  return null;
}
