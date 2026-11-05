"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { IconBook, IconChat, IconCheck, IconChevronDown, IconCopy, IconDoc, IconGlobe, IconSpark } from "@/components/icons";
import { openAssistant } from "./assistant";

/**
 * The control beside the section name: Ask AI opens the Assistant, and the menu takes the
 * page to an AI tool (copy or view its Markdown, or open it in ChatGPT or Claude).
 */
export function ArticleMenu({ slug, ai }: { slug: string; ai: boolean }) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  async function copy() {
    try {
      const res = await fetch(`/help/md/${slug}`);
      if (!res.ok) throw new Error();
      await navigator.clipboard.writeText(await res.text());
      setState("done");
      setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }
  // The AI tools read the page from its public address.
  const askAbout = (base: string) => {
    const prompt = `Read ${window.location.origin}${window.location.pathname} so I can ask questions about it.`;
    window.open(`${base}${encodeURIComponent(prompt)}`, "_blank", "noopener,noreferrer");
  };
  const items: { icon: React.ReactNode; label: string; hint: string; run: () => void }[] = [
    { icon: <IconCopy size={15} />, label: "Copy as Markdown", hint: "Copy page content for LLMs", run: copy },
    { icon: <IconChat size={15} />, label: "Open in ChatGPT", hint: "Ask ChatGPT about this page", run: () => askAbout("https://chatgpt.com/?q=") },
    { icon: <IconSpark size={15} />, label: "Open in Claude", hint: "Ask Claude about this page", run: () => askAbout("https://claude.ai/new?q=") },
    {
      icon: <IconDoc size={15} />,
      label: "View as Markdown",
      hint: "Open raw Markdown in a new tab",
      run: () => window.open(`/help/md/${slug}`, "_blank", "noopener,noreferrer"),
    },
  ];
  const edge = "border border-line text-[12px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink";
  return (
    <div className="flex items-center">
      {ai && (
        <button type="button" onClick={() => openAssistant()} className={`flex h-7 items-center gap-1.5 rounded-l-md px-2 ${edge}`}>
          <IconSpark size={13} /> Ask AI
        </button>
      )}
      <details className="relative">
        <summary
          aria-label="Page actions"
          className={`flex h-7 cursor-pointer list-none items-center gap-1.5 ${ai ? "rounded-r-md border-l-0 px-1.5" : "rounded-md px-2"} ${edge}`}
        >
          {!ai && (state === "done" ? <IconCheck size={13} className="text-success" /> : <IconCopy size={13} />)}
          {!ai && (state === "done" ? "Copied" : state === "error" ? "Couldn't copy" : "Copy page")}
          {ai && state === "done" ? <IconCheck size={13} className="text-success" /> : <IconChevronDown size={12} className="text-faint" />}
        </summary>
        <div className="pop-in absolute right-0 z-30 mt-1 w-64 rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={(e) => {
                e.currentTarget.closest("details")?.removeAttribute("open");
                it.run();
              }}
              className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-graphite hover:bg-well hover:text-ink"
            >
              <span className="mt-0.5 text-muted">{it.icon}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{it.label}</span>
                <span className="block text-[12px] text-muted">{it.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

/** Language picker; the choice travels in ?lang= so links stay shareable. */
export function LanguageSwitcher({ languages }: { languages: { code: string; name: string }[] }) {
  const path = usePathname();
  const params = useSearchParams();
  const current = params.get("lang") ?? "";
  if (!languages.length) return null;
  const href = (code: string) => {
    const sp = new URLSearchParams(params.toString());
    if (code) sp.set("lang", code);
    else sp.delete("lang");
    const qs = sp.toString();
    return `${path}${qs ? `?${qs}` : ""}`;
  };
  return (
    <details className="relative">
      <summary className="btn btn-quiet h-8 list-none px-2 text-[13px]" aria-label="Language">
        <IconGlobe size={15} />
        <span className="uppercase">{current || "en"}</span>
      </summary>
      <ul className="pop-in absolute right-0 z-30 mt-1 w-40 rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-lg)]">
        {[{ code: "", name: "English" }, ...languages].map((l) => (
          <li key={l.code || "en"}>
            <Link
              href={href(l.code)}
              className={`block rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-sunken ${current === l.code ? "font-semibold text-accent" : ""}`}
            >
              {l.name}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Highlights the heading currently in view. */
export function TableOfContents({ items }: { items: { id: string; text: string; level: 2 | 3 }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => Boolean(e));
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -60% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [items]);
  return (
    <nav aria-label="On this page">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <IconBook size={14} className="text-muted" /> On this page
      </p>
      <ul className="mt-2 flex flex-col gap-0.5 pl-[22px]">
        {items.map((i) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              className={`block py-1 text-[13px] leading-5 transition-colors ${i.level === 3 ? "pl-3" : ""} ${
                active === i.id ? "font-medium text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {i.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
