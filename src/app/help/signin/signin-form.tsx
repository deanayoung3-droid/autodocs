"use client";

import { ActionForm, FormMessage, SubmitButton, useActionForm } from "../../admin/ui";
import { readerSignInAction } from "../reader-actions";

export function ReaderSignInForm({ next }: { next: string }) {
  const form = useActionForm(readerSignInAction);
  return (
    <ActionForm form={form} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="rp">
          Password
        </label>
        <input id="rp" name="password" type="password" required autoFocus className="field" />
      </div>
      <FormMessage state={form.state} />
      <SubmitButton pendingLabel="Signing in…" className="btn btn-primary w-full">
        Continue
      </SubmitButton>
    </ActionForm>
  );
}
