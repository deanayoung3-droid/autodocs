"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { followUpAction } from "../../actions";
import { ActionForm, FormMessage, SubmitButton, useActionForm } from "../../ui";

/** Re-renders the server page every few seconds while the agent is working. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

export function FollowUp({ runId, disabled }: { runId: number; disabled: boolean }) {
  const form = useActionForm(followUpAction);
  const state = form.state;
  return (
    <ActionForm form={form} className="card p-3">
      <input type="hidden" name="runId" value={runId} />
      <label htmlFor="fu-message" className="sr-only">
        Ask Docs Agent to change something
      </label>
      <textarea
        id="fu-message"
        name="message"
        rows={3}
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
        placeholder={disabled ? "Docs Agent is working…" : "Ask for changes, e.g. “Also mention the 25 MB limit” or “Merge these into one article”"}
        className="w-full resize-y bg-transparent text-[14px] outline-none placeholder:text-faint disabled:cursor-not-allowed"
      />
      <FormMessage state={state} />
      <div className="mt-2 flex justify-end">
        <SubmitButton className="btn btn-primary h-8" disabled={disabled} pendingLabel="Sending…">
          Send
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
