"use client";

import Link from "next/link";
import { ActionForm, FormMessage, SubmitButton, useActionForm } from "../admin/ui";
import { signInAction } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const form = useActionForm(signInAction);
  return (
    <ActionForm form={form} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="email">
          Email <span className="font-normal text-muted">(leave empty for the owner password)</span>
        </label>
        <input id="email" name="email" type="email" autoComplete="username" className="field" />
      </div>
      <div>
        <span className="flex items-baseline justify-between">
          <label className="label" htmlFor="password">
            Password
          </label>
          <Link href="/login/forgot" className="text-[12px] text-muted hover:text-ink">
            Forgot password?
          </Link>
        </span>
        <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus className="field" />
      </div>
      <FormMessage state={form.state} />
      <SubmitButton pendingLabel="Signing in…" className="btn btn-primary w-full">
        Sign in
      </SubmitButton>
    </ActionForm>
  );
}
