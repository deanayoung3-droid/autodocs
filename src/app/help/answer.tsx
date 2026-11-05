"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconArrow, IconThumbDown, IconThumbUp } from "@/components/icons";

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
  /** Rated not helpful: under "AI decides", that's when contact is offered. */
  unhelpful?: boolean;
};

/** Wording the widget can override from its Text panel. */
export type AnswerText = { label: string; unanswered: string; handoff: string; followUp: string; helpful: string; thanks: string };
const ANSWER_TEXT: AnswerText = {
  label: "AI answer",
  unanswered: "The help center doesn’t cover this yet.",
  handoff: "This one’s best handled by a person.",
  followUp: "Ask a follow-up",
  helpful: "Helpful?",
  thanks: "Thanks for the feedback.",
};

/** Reads the answer stream: newline-delimited JSON events. The Assistant panel reads it too. */
export async function streamAnswer(
  body: Record<string, unknown>,
  onEvent: (e: { type: string; text?: string; html?: string; sources?: Source[]; answered?: boolean; handoff?: boolean; conversation?: number; message?: string }) => void,
) {
  const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    onEvent({ type: "error", message: data.error ?? "Couldn't get an answer right now." });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}

/**
 * AI answer drawn from published articles, with cited sources and follow-up questions.
 * `auto` asks immediately; otherwise it waits for a click.
 */
export function Answer({
  question,
  supportUrl,
  auto,
  linkTarget,
  widget,
  text,
  onContact,
  offerContact = "always",
  contactLabel = "Contact support",
}: {
  question: string;
  supportUrl: string;
  auto: boolean;
  linkTarget?: "_blank";
  widget?: number;
  text?: Partial<AnswerText>;
  /** The widget opens its own contact form or chat; without this, contact is a link to supportUrl. */
  onContact?: (c: { question: string; conversation: number | null }) => void;
  /** "always": under every answer. "ai": only when there's no answer, a handoff, or a thumbs down. "off": never. */
  offerContact?: "ai" | "always" | "off";
  contactLabel?: string;
}) {
  const T = { ...ANSWER_TEXT, ...text };
  const [turns, setTurns] = useState<Turn[]>([]);
  const [followUp, setFollowUp] = useState("");
  // Guards against duplicate (billed) requests from re-renders and dev double effects.
  const askedFor = useRef<string | null>(null);
  const busy = turns.some((t) => t.status === "loading" || t.status === "streaming");

  const ask = useCallback(
    (q: string, conversation: number | null) => {
      const index = { current: -1 };
      setTurns((prev) => {
        index.current = prev.length;
        return [...prev, { question: q, status: "loading", text: "", html: "", sources: [], conversation: null }];
      });
      const update = (patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) =>
        setTurns((prev) => prev.map((t, i) => (i === index.current ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)));
      streamAnswer({ question: q, widget, conversation }, (e) => {
        if (e.type === "delta") update((t) => ({ status: "streaming", text: t.text + (e.text ?? "") }));
        else if (e.type === "done") {
          update({ status: e.handoff ? "handoff" : e.answered ? "answered" : "unanswered", html: e.html ?? "", sources: e.sources ?? [], conversation: e.conversation ?? null });
          // In the widget, tell the page it's embedded in, so its own support tool can take over.
          if (e.handoff && window.parent !== window) {
            window.parent.postMessage({ type: "autodocs:escalationRequested", question: q, conversation: e.conversation ?? null }, "*");
          }
        }
        else if (e.type === "error") update({ status: "error", message: e.message });
      }).catch(() => update({ status: "error", message: "Couldn't reach the server. Check your connection and try again." }));
    },
    [widget],
  );

  useEffect(() => {
    if (!auto || askedFor.current === question) return;
    askedFor.current = question;
    ask(question, null);
  }, [auto, question, ask]);

  function rate(i: number, helpful: boolean) {
    const t = turns[i];
    if (!t.conversation || t.rated) return;
    setTurns((prev) => prev.map((x, k) => (k === i ? { ...x, rated: true, unhelpful: !helpful } : x)));
    void fetch("/api/ask/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversation: t.conversation, helpful }) });
  }

  function contact(conversation: number | null) {
    if (conversation) navigator.sendBeacon?.("/api/ask/feedback", JSON.stringify({ conversation, handoff: true }));
  }

  /** The way to reach a person after this turn, if this turn should offer one. */
  function contactFor(t: Turn) {
    if (offerContact === "off" || (!onContact && !supportUrl)) return null;
    const needed = t.status === "unanswered" || t.status === "handoff" || t.unhelpful;
    if (offerContact === "ai" && !needed) return null;
    return onContact ? (
      <button
        type="button"
        onClick={() => {
          contact(t.conversation);
          onContact({ question: t.question, conversation: t.conversation });
        }}
        className="link"
      >
        {contactLabel}
      </button>
    ) : (
      <a href={supportUrl} target={linkTarget} onClick={() => contact(t.conversation)} className="link">
        {contactLabel}
      </a>
    );
  }

  if (!turns.length) {
    return (
      <button
        type="button"
        onClick={() => {
          if (askedFor.current === question) return;
          askedFor.current = question;
          ask(question, null);
        }}
        className="btn w-full justify-start sm:w-auto"
      >
        Ask AI: &ldquo;{question.length > 60 ? `${question.slice(0, 60)}…` : question}&rdquo;
      </button>
    );
  }

  const last = turns[turns.length - 1];

  return (
    <section aria-live="polite" aria-busy={busy} className="pop-in rounded-2xl border border-accent-line bg-accent-soft px-5 py-4">
      <p className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-accent">
        {busy ? <span className="working-dot" /> : <span aria-hidden>✦</span>}
        {T.label}
      </p>
      <div className="flex flex-col gap-5">
        {turns.map((t, i) => (
          <div key={i} className={i > 0 ? "border-t border-accent-line pt-4" : ""}>
            {i > 0 && <p className="mb-2 text-[14px] font-semibold text-ink">{t.question}</p>}
            {t.status === "loading" && (
              <div aria-label="Finding an answer" className="flex flex-col gap-2 py-1">
                <div className="h-3 w-11/12 skeleton" />
                <div className="h-3 w-9/12 skeleton" />
                <div className="h-3 w-10/12 skeleton" />
              </div>
            )}
            {t.status === "streaming" && <div className="prose-doc prose-compact whitespace-pre-wrap">{t.text.replace(/\[\d{1,2}\]/g, "")}</div>}
            {t.status === "answered" && (
              <>
                <div className="prose-doc prose-compact" dangerouslySetInnerHTML={{ __html: t.html }} />
                {t.sources.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {t.sources.map((s, n) => (
                      <li key={s.slug}>
                        <a
                          href={`/help/${s.slug}`}
                          target={linkTarget}
                          className="inline-flex max-w-[22rem] items-center gap-1.5 rounded-md border border-accent-line bg-surface px-2 py-1 text-[12.5px] text-graphite transition-colors hover:border-accent hover:text-ink"
                        >
                          <span className="num text-[11px] text-faint">{n + 1}</span>
                          <span className="truncate">{s.title}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
                  {t.rated ? (
                    <span>{T.thanks}</span>
                  ) : (
                    <span className="flex items-center gap-1">
                      {T.helpful}
                      <button type="button" onClick={() => rate(i, true)} aria-label="Yes, this helped" className="btn btn-quiet size-7 px-0">
                        <IconThumbUp size={14} />
                      </button>
                      <button type="button" onClick={() => rate(i, false)} aria-label="No, this didn't help" className="btn btn-quiet size-7 px-0">
                        <IconThumbDown size={14} />
                      </button>
                    </span>
                  )}
                  {contactFor(t)}
                </div>
              </>
            )}
            {t.status === "handoff" && (
              <p className="text-graphite">
                {T.handoff} {contactFor(t) ?? (offerContact === "off" ? null : "Reach out to the team and they'll help.")}
              </p>
            )}
            {t.status === "unanswered" && (
              <p className="text-graphite">
                {T.unanswered} {contactFor(t) ?? "Try different words, or browse the topics."}
              </p>
            )}
            {t.status === "error" && <p className="text-danger">{t.message}</p>}
          </div>
        ))}
      </div>

      {last.status === "answered" && turns.length < 6 && (
        <form
          className="mt-4 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const q = followUp.trim();
            if (q.length < 3 || busy) return;
            setFollowUp("");
            ask(q, last.conversation);
          }}
        >
          <label htmlFor="ask-follow-up" className="sr-only">
            Ask a follow-up question
          </label>
          <input
            id="ask-follow-up"
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            maxLength={500}
            placeholder={T.followUp}
            className="field h-9 flex-1 bg-surface text-[14px]"
          />
          <button type="submit" className="btn btn-icon size-9" aria-label="Ask" disabled={busy || followUp.trim().length < 3}>
            <IconArrow size={15} />
          </button>
        </form>
      )}
    </section>
  );
}
