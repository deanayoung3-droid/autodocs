"use client";

import { ActionForm, FormMessage, SubmitButton, useActionForm } from "../admin/ui";
import { acceptInvitationAction, createOwnerAction, forgotPasswordAction, resetPasswordAction } from "./actions";

function NewPassword({ label = "Password" }: { label?: string }) {
  return (
    <>
      <div>
        <label className="label" htmlFor="password">
          {label} <span className="font-normal text-muted">(15 or more characters)</span>
        </label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={15} required className="field" />
      </div>
      <div>
        <label className="label" htmlFor="confirm">
          Type it again
        </label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={15} required className="field" />
      </div>
    </>
  );
}

function Name() {
  return (
    <div>
      <label className="label" htmlFor="name">
        Your name
      </label>
      <input id="name" name="name" autoComplete="name" required autoFocus className="field" />
    </div>
  );
}

export function ForgotPasswordForm() {
  const form = useActionForm(forgotPasswordAction);
  return (
    <ActionForm form={form} className="flex flex-col gap-4">
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required autoFocus className="field" />
      </div>
      <FormMessage state={form.state} />
      <SubmitButton pendingLabel="Sending…" className="btn btn-primary w-full">
        Email me a reset link
      </SubmitButton>
    </ActionForm>
  );
}

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const form = useActionForm(resetPasswordAction);
  return (
    <ActionForm form={form} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {/* For password managers, which save the new password against this address. */}
      <input type="hidden" name="username" autoComplete="username" value={email} />
      <NewPassword label="New password" />
      <FormMessage state={form.state} />
      <SubmitButton pendingLabel="Saving…" className="btn btn-primary w-full">
        Save and sign in
      </SubmitButton>
    </ActionForm>
  );
}

export function AcceptInvitationForm({ token, email }: { token: string; email: string }) {
  const form = useActionForm(acceptInvitationAction);
  return (
    <ActionForm form={form} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" type="email" autoComplete="username" value={email} readOnly className="field text-muted" />
      </div>
      <Name />
      <NewPassword />
      <FormMessage state={form.state} />
      <SubmitButton pendingLabel="Joining…" className="btn btn-primary w-full">
        Join the team
      </SubmitButton>
    </ActionForm>
  );
}

export function CreateOwnerForm({ code }: { code: string }) {
  const form = useActionForm(createOwnerAction);
  return (
    <ActionForm form={form} className="flex flex-col gap-4">
      <input type="hidden" name="code" value={code} />
      <div>
        <label className="label" htmlFor="brand">
          Company or product name
        </label>
        <input id="brand" name="brand" required maxLength={60} placeholder="Acme" autoComplete="organization" className="field" />
        <p className="mt-1.5 text-[12.5px] text-muted">Shown across your help center. Change it, and add a logo and colour, in Settings any time.</p>
      </div>
      <Name />
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className="field" />
      </div>
      <NewPassword />
      <FormMessage state={form.state} />
      <SubmitButton pendingLabel="Creating…" className="btn btn-primary w-full">
        Create the owner account
      </SubmitButton>
    </ActionForm>
  );
}
