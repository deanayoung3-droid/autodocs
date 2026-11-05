"use client";

import { ActionForm, FormMessage, SubmitButton, useActionForm } from "../../admin/ui";
import { readerEmailLinkAction } from "../reader-actions";

export function EmailLinkForm({ next }: { next: string }) {
  const form = useActionForm(readerEmailLinkAction);
  return (
    <ActionForm form={form} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="re">
          Email
        </label>
        <input id="re" name="email" type="email" autoComplete="email" required className="field" />
      </div>
      <FormMessage state={form.state} />
      <SubmitButton pendingLabel="Sending…" className="btn btn-primary w-full">
        Email me a sign-in link
      </SubmitButton>
    </ActionForm>
  );
}
