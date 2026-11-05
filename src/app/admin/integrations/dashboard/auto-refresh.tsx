"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes the page's server data every few seconds while background work is running. */
export function AutoRefresh({ active, every = 3000 }: { active: boolean; every?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [active, every, router]);
  return null;
}
