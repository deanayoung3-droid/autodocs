"use client";

import { useState, useSyncExternalStore } from "react";
import { IconThumbDown, IconThumbUp } from "@/components/icons";

const KEY = "autodocs:voted";

function readVotes(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

const noSubscribe = () => () => {};

export function Feedback({ slug, supportUrl }: { slug: string; supportUrl: string }) {
  // A vote from an earlier visit, read after hydration (null on the server).
  const stored = useSyncExternalStore(
    noSubscribe,
    () => readVotes()[slug] ?? null,
    () => null,
  );
  const [current, setVote] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const vote = current ?? stored;

  async function send(helpful: boolean) {
    setVote(helpful);
    setFailed(false);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, helpful }),
      });
      if (!res.ok) throw new Error();
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...readVotes(), [slug]: helpful }));
      } catch {
        // Storage can be unavailable (private mode); the vote still counted.
      }
    } catch {
      setVote(null);
      setFailed(true);
    }
  }

  if (vote !== null) {
    return (
      <p className="text-[13px] text-muted" role="status">
        {vote ? "Thanks for letting us know." : "Thanks. We'll use this to improve the article."}
        {!vote && supportUrl && (
          <>
            {" "}
            <a href={supportUrl} className="link">
              Contact support
            </a>{" "}
            if you&rsquo;re still stuck.
          </>
        )}
      </p>
    );
  }

  const thumb = "flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-well hover:text-ink";
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted">Was this helpful?</p>
        <div className="flex gap-0.5">
          <button type="button" className={thumb} onClick={() => send(true)} aria-label="Yes, this was helpful">
            <IconThumbUp size={16} />
          </button>
          <button type="button" className={thumb} onClick={() => send(false)} aria-label="No, this wasn't helpful">
            <IconThumbDown size={16} />
          </button>
        </div>
      </div>
      {failed && <p className="mt-1 text-[13px] text-danger">Your answer didn&rsquo;t send. Try again.</p>}
    </div>
  );
}
