"use client";

import type { PanelState } from "../../../platform-actions";
import { ActionForm, FormMessage, SubmitButton, useActionForm } from "../../../ui";
import { CopyField } from "../../platform-forms";

/** A quiet row button that makes a link (an invitation, a password reset) and shows it under the row. */
export function LinkAction({
  action,
  id,
  label,
  pendingLabel,
}: {
  action: (prev: PanelState, form: FormData) => Promise<PanelState>;
  id: number;
  label: string;
  pendingLabel: string;
}) {
  const form = useActionForm(action);
  return (
    <ActionForm form={form} className="contents">
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="btn btn-quiet btn-sm" pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
      {form.state && (
        <div className="order-last flex min-w-0 basis-full flex-col gap-2 pt-1">
          <FormMessage state={form.state} />
          {form.state.secret && <CopyField value={form.state.secret} />}
        </div>
      )}
    </ActionForm>
  );
}
