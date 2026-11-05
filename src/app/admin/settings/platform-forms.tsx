"use client";

import { useState, type ReactNode } from "react";
import { IconCheck, IconCopy } from "@/components/icons";
import type { PanelState } from "../platform-actions";
import { ActionForm, FormMessage, SubmitButton, useActionForm } from "../ui";

/** A settings form whose fields are rendered by the server; shows errors, success, and one-time secrets. */
/**
 * A settings form inside a Section card. By default its save button sits in the card's footer bar
 * (the form bleeds over the card's padding to reach the edges); forms with their own layout keep
 * the button inline.
 */
export function ActionPanel({
  action,
  submitLabel,
  children,
  className,
}: {
  action: (prev: PanelState, form: FormData) => Promise<PanelState>;
  submitLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const form = useActionForm(action);
  const bar = className === undefined;
  return (
    <ActionForm form={form} className={className ?? "flex flex-col gap-5"}>
      {children}
      <FormMessage state={form.state} />
      {form.state?.secret && <CopyField value={form.state.secret} />}
      {bar ? (
        <div className="card-footer -mx-5 -mb-5 justify-end">
          <SubmitButton className="btn btn-primary btn-sm" pendingLabel="Saving…">
            {submitLabel}
          </SubmitButton>
        </div>
      ) : (
        <div>
          <SubmitButton className="btn btn-primary btn-sm" pendingLabel="Saving…">
            {submitLabel}
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

/** A labelled code box with a Copy button in its header, for commands and URLs. */
export function CodeBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-md border border-line bg-sunken">
      <div className="flex items-center justify-between gap-3 border-b border-line-soft py-1.5 pr-1.5 pl-3">
        <span className="text-xs text-muted">{label}</span>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-well hover:text-ink"
          onClick={() => {
            navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <IconCheck size={13} className="text-success" /> : <IconCopy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-[12.5px] leading-relaxed text-ink">{value}</pre>
    </div>
  );
}

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="pop-in flex items-center gap-2 rounded-md border border-line bg-sunken p-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{value}</code>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <IconCheck size={14} className="text-success" /> : <IconCopy size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** A live preview of the help center at desktop or phone width. */
export function LivePreview({ src }: { src: string }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  return (
    <div>
      <div role="tablist" aria-label="Preview size" className="mb-3 inline-flex rounded-lg bg-sunken p-0.5">
        {(["desktop", "mobile"] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={device === d}
            onClick={() => setDevice(d)}
            className={`h-8 rounded-md px-3 text-[13px] capitalize transition-all ${
              device === d ? "bg-surface font-semibold shadow-[var(--shadow-sm)]" : "text-muted hover:text-ink"
            }`}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="flex justify-center overflow-hidden rounded-2xl border border-line bg-sunken p-3">
        <iframe
          title="Help center preview"
          src={src}
          className="h-[560px] rounded-xl border border-line bg-white shadow-[var(--shadow-md)] transition-[width] duration-300 ease-out"
          style={{ width: device === "desktop" ? "100%" : 390 }}
        />
      </div>
    </div>
  );
}
