"use client";

import { useEffect, useRef } from "react";
import { MascotAvatar } from "@/components/mascot";
import { startTaskAction } from "./actions";
import { ActionForm, FormMessage, SubmitButton, useActionForm } from "./ui";

/** One-line way to hand Docs Agent a task from Home. ⌘K focuses it. */
export function HomeAsk({ disabled }: { disabled: boolean }) {
  const form = useActionForm(startTaskAction);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);

  return (
    <ActionForm
      form={form}
      className="rounded-md border border-line bg-surface shadow-[var(--shadow-xs)] transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]"
    >
      <div className="flex items-center gap-3 py-2.5 pr-2.5 pl-4">
        <MascotAvatar size={20} mood={form.pending ? "thinking" : "idle"} />
        <label htmlFor="home-ask" className="sr-only">
          Ask Docs Agent
        </label>
        <input
          id="home-ask"
          ref={input}
          name="prompt"
          disabled={disabled}
          placeholder={disabled ? "Add an OpenAI API key (Settings → AI) to use Docs Agent" : "Ask Docs Agent to write, rewrite, or check anything…"}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        />
        <kbd className="hidden rounded-xs border border-line bg-sunken px-1.5 py-0.5 font-sans text-2xs text-muted sm:block">⌘K</kbd>
        <SubmitButton className="btn btn-dark h-7 px-2.5 text-xs" disabled={disabled} pendingLabel="Starting…">
          Ask
        </SubmitButton>
      </div>
      {form.state?.error && (
        <div className="px-2.5 pb-2.5">
          <FormMessage state={form.state} />
        </div>
      )}
    </ActionForm>
  );
}
