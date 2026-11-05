"use client";

import { IconArrow, IconSpark } from "@/components/icons";
import { openAssistant } from "./assistant";

/** The home page's big box: it opens the Assistant, ready for the question. */
export function AskBox() {
  return (
    <button
      type="button"
      onClick={() => openAssistant()}
      className="flex w-full items-center gap-3 rounded-xl bg-surface py-2 pr-2 pl-4 text-left shadow-[0_1px_2px_rgb(10_13_18/0.03)] ring-1 ring-line transition-shadow hover:ring-line-strong focus-visible:ring-line-strong focus-visible:outline-none"
    >
      <IconSpark size={20} className="shrink-0 text-faint" />
      <span className="flex h-10 min-w-0 flex-1 items-center truncate text-[16px] text-faint">Ask, search, or explain…</span>
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg text-faint">
        <IconArrow size={16} />
      </span>
    </button>
  );
}
