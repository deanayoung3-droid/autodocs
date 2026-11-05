"use client";

import { useSyncExternalStore } from "react";

type Scheme = "system" | "light" | "dark";
const NEXT: Record<Scheme, Scheme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Scheme, string> = { system: "match your device", light: "light", dark: "dark" };

const root = () => document.querySelector<HTMLElement>(".help-root");
const subscribe = (onChange: () => void) => {
  window.addEventListener("help-scheme", onChange);
  return () => window.removeEventListener("help-scheme", onChange);
};

const ICONS: Record<Scheme, React.ReactNode> = {
  system: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 13.75h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  light: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  dark: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
};

/**
 * Switches the help center between the device's scheme, light, and dark. The choice is a cookie,
 * so the server renders the right colors from the first paint.
 */
export function SchemeToggle() {
  const scheme = useSyncExternalStore(subscribe, () => (root()?.dataset.scheme as Scheme | undefined) ?? "system", () => null);
  if (!scheme) return <span className="size-8" aria-hidden />;
  const next = NEXT[scheme];
  return (
    <button
      type="button"
      onClick={() => {
        const el = root();
        if (!el) return;
        el.dataset.scheme = next;
        document.cookie = `help-scheme=${next}; path=/; max-age=31536000; samesite=lax`;
        window.dispatchEvent(new Event("help-scheme"));
      }}
      aria-label={`Colors: ${LABEL[scheme]}. Switch to ${LABEL[next]}.`}
      title={`Colors: ${LABEL[scheme]}`}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-well hover:text-ink"
    >
      {ICONS[scheme]}
    </button>
  );
}
