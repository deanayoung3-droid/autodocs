"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconSpark, IconThumbDown, IconThumbUp, IconTrash, IconX } from "@/components/icons";
import { greeting } from "@/lib/format";
import { streamAnswer } from "./answer";

type Source = { title: string; slug: string };
type Turn = {
  question: string;
  status: "loading" | "streaming" | "answered" | "unanswered" | "handoff" | "error";
  text: string;
  html: string;
  sources: Source[];
  conversation: number | null;
  message?: string;
  rated?: boolean;
};

const OPEN_EVENT = "autodocs:assistant";
const STORE = "autodocs:assistant";
const MAX_TURNS = 20;

/** Opens the Assistant from anywhere in the help center, optionally asking a question right away. */
export function openAssistant(question?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { question } }));
}

function savedTurns(): Turn[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) ?? "[]") as Turn[];
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

/**
 * The Assistant: a chat docked on the right under the header. Answers come from
 * the published articles, cite the sections they used, and list their sources; follow-ups keep the
 * conversation's context. The conversation lasts for the browser tab, across pages.
 */
export function Assistant({ supportUrl }: { supportUrl: string }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(savedTurns);
  const [draft, setDraft] = useState("");
  const [hello, setHello] = useState("Hello");
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const latest = useRef(turns);
  const router = useRouter();
  const busy = turns.some((t) => t.status === "loading" || t.status === "streaming");

  useEffect(() => {
    latest.current = turns;
    try {
      sessionStorage.setItem(STORE, JSON.stringify(turns.filter((t) => t.status !== "loading" && t.status !== "streaming")));
    } catch {
      // Private windows can refuse storage; the chat still works for this page.
    }
  }, [turns]);

  const ask = useCallback((question: string) => {
    const previous = latest.current;
    // Follow-ups carry the conversation, so the answer (and the search behind it) knows the topic.
    const parent = [...previous].reverse().find((t) => t.conversation)?.conversation ?? null;
    const index = previous.length;
    setTurns([...previous, { question, status: "loading", text: "", html: "", sources: [], conversation: null }]);
    const update = (patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) =>
      setTurns((all) => all.map((t, i) => (i === index ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)));
    streamAnswer({ question, conversation: parent }, (e) => {
      if (e.type === "delta") update((t) => ({ status: "streaming", text: t.text + (e.text ?? "") }));
      else if (e.type === "done") {
        update({
          status: e.handoff ? "handoff" : e.answered ? "answered" : "unanswered",
          html: e.html ?? "",
          sources: e.sources ?? [],
          conversation: e.conversation ?? null,
        });
      } else if (e.type === "error") update({ status: "error", message: e.message });
    }).catch(() => update({ status: "error", message: "Couldn't reach the server. Check your connection and try again." }));
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const question = (e as CustomEvent<{ question?: string }>).detail?.question?.trim();
      setHello(greeting());
      setOpen(true);
      if (question && question.length >= 3) ask(question.slice(0, 500));
      else requestAnimationFrame(() => input.current?.focus());
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [ask]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Keep the newest message in view as it streams in.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, open]);

  function send() {
    const question = draft.trim();
    if (question.length < 3 || busy || turns.length >= MAX_TURNS) return;
    setDraft("");
    if (input.current) input.current.style.height = "";
    ask(question.slice(0, 500));
  }

  function rate(i: number, helpful: boolean) {
    const t = turns[i];
    if (!t.conversation || t.rated) return;
    setTurns((all) => all.map((x, k) => (k === i ? { ...x, rated: true } : x)));
    void fetch("/api/ask/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversation: t.conversation, helpful }) });
  }

  // Links to articles (citations and sources) open in place, like any page of the help center.
  function followLinks(e: React.MouseEvent) {
    const link = (e.target as HTMLElement).closest("a");
    const href = link?.getAttribute("href");
    if (!link || !href?.startsWith("/help") || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    setOpen(false);
    router.push(href);
  }

  if (!open) return null;

  const contact = (turn: Turn, words: string) =>
    supportUrl ? (
      <>
        {words}{" "}
        <a
          href={supportUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => turn.conversation && navigator.sendBeacon?.("/api/ask/feedback", JSON.stringify({ conversation: turn.conversation, handoff: true }))}
          className="font-medium text-ink underline underline-offset-2"
        >
          Contact us
        </a>
      </>
    ) : (
      words
    );

  return (
    <aside aria-label="Assistant" className="fixed inset-x-0 top-16 bottom-0 z-30 flex flex-col border-l border-line-soft bg-surface sm:left-auto sm:w-[360px]">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line-soft px-6">
        <h2 className="flex-1 text-[14px] font-medium text-ink">Assistant</h2>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setTurns([]);
              input.current?.focus();
            }}
            disabled={busy}
            aria-label="New chat"
            title="New chat"
            className="flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-well hover:text-ink disabled:opacity-40"
          >
            <IconTrash size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close the assistant"
          className="flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-well hover:text-ink"
        >
          <IconX size={16} />
        </button>
      </header>

      <div ref={scroller} onClick={followLinks} aria-live="polite" aria-busy={busy} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <IconSpark size={28} className="text-faint" />
            <p className="mt-4 text-[16px] font-medium text-ink">{hello},</p>
            <p className="mt-2 text-[14px] leading-[21px] text-muted">I&rsquo;m here to help. Ask me anything about our product.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {turns.map((t, i) => (
              <div key={i} className="flex flex-col gap-3">
                <p className="ml-auto max-w-[85%] rounded-2xl bg-ink-strong px-4 py-2.5 text-[14px] leading-[21px] whitespace-pre-wrap text-surface">{t.question}</p>
                {t.status === "loading" && (
                  <p className="flex items-center gap-2 text-[14px] text-muted">
                    <span className="working-dot" /> Looking through the help center…
                  </p>
                )}
                {t.status === "streaming" && <div className="assistant-answer whitespace-pre-wrap">{t.text.replace(/\[\d{1,2}\]/g, "")}</div>}
                {t.status === "answered" && (
                  <>
                    <div className="assistant-answer" dangerouslySetInnerHTML={{ __html: t.html }} />
                    <div className="flex items-center gap-1 text-muted">
                      {t.rated ? (
                        <span className="text-[12px]">Thanks for the feedback.</span>
                      ) : (
                        <>
                          <button type="button" onClick={() => rate(i, true)} aria-label="Yes, this helped" className="flex size-6 items-center justify-center rounded-md hover:bg-well hover:text-ink">
                            <IconThumbUp size={14} />
                          </button>
                          <button type="button" onClick={() => rate(i, false)} aria-label="No, this didn't help" className="flex size-6 items-center justify-center rounded-md hover:bg-well hover:text-ink">
                            <IconThumbDown size={14} />
                          </button>
                        </>
                      )}
                    </div>
                    {t.sources.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <p className="text-[12px] font-medium text-muted">Sources</p>
                        <ul className="flex list-disc flex-col gap-1 pl-4 text-[12px] text-graphite">
                          {t.sources.map((s) => (
                            <li key={s.slug}>
                              <a href={`/help/${s.slug}`} className="underline decoration-line underline-offset-2 transition-colors hover:text-ink">
                                {s.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
                {t.status === "unanswered" && <p className="text-[14px] leading-6 text-graphite">{contact(t, "The help center doesn’t cover this yet. Try other words, or")}</p>}
                {t.status === "handoff" && <p className="text-[14px] leading-6 text-graphite">{contact(t, "This one’s best handled by a person.")}</p>}
                {t.status === "error" && <p className="text-[14px] leading-6 text-danger">{t.message}</p>}
              </div>
            ))}
            {turns.length >= MAX_TURNS && <p className="text-center text-[12px] text-muted">That&rsquo;s a long conversation. Start a new chat to keep going.</p>}
          </div>
        )}
      </div>

      <form
        className="shrink-0 px-3 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div
          onClick={() => input.current?.focus()}
          className="flex cursor-text items-end gap-2 rounded-2xl border border-line bg-sunken py-2 pr-2 pl-4 transition-colors focus-within:border-line-strong"
        >
          <textarea
            ref={input}
            rows={1}
            value={draft}
            maxLength={500}
            aria-label="Ask a question"
            placeholder="Ask, search, or explain..."
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            className="min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[14px] text-ink outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={busy || draft.trim().length < 3 || turns.length >= MAX_TURNS}
            className="shrink-0 rounded-full bg-well px-4 py-1.5 text-[14px] font-medium text-graphite transition-colors hover:bg-line hover:text-ink disabled:opacity-50 disabled:hover:bg-well"
          >
            Send
          </button>
        </div>
      </form>
    </aside>
  );
}
