"use client";

import { createContext, startTransition, useActionState, useContext, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

type Pending = { pending: boolean; intent: string | null };
const PendingContext = createContext<Pending | null>(null);

/**
 * Like useActionState, but submits through a transition instead of the form's `action`
 * prop. React resets uncontrolled fields after an `action` submission, which would wipe
 * what the person typed whenever validation fails.
 */
export function useActionForm<S>(action: (prev: Awaited<S>, form: FormData) => Promise<S>) {
  const [state, dispatch, pending] = useActionState<S, FormData>(action, undefined as Awaited<S>);
  const [intent, setIntent] = useState<string | null>(null);
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(e.currentTarget, submitter);
    setIntent(submitter?.value || null);
    startTransition(() => dispatch(data));
  }
  return { state, pending, intent, onSubmit };
}

/** A form driven by useActionForm; its SubmitButtons show the pending state. */
export function ActionForm({
  form,
  children,
  ...rest
}: { form: Pending & { onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }; children: ReactNode } & Omit<
  React.FormHTMLAttributes<HTMLFormElement>,
  "onSubmit" | "action"
>) {
  return (
    // POST, so a form sent before the page's script has loaded never puts its fields (passwords,
    // keys) into the address bar, browser history, or server logs.
    <form method="post" {...rest} onSubmit={form.onSubmit}>
      <PendingContext.Provider value={{ pending: form.pending, intent: form.intent }}>{children}</PendingContext.Provider>
    </form>
  );
}

/** Submit button that disables itself and swaps its label while the form is pending. */
export function SubmitButton({
  children,
  pendingLabel,
  className = "btn btn-primary",
  name,
  value,
  disabled,
  onClick,
  formAction,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  formAction?: (form: FormData) => void | Promise<void>;
}) {
  const ctx = useContext(PendingContext);
  const status = useFormStatus();
  const pending = ctx ? ctx.pending : status.pending;
  // Only the button that submitted shows the pending label: buttons with their own
  // formAction match on the running action, named buttons on their submitted value.
  const mine = ctx
    ? pending && (!value || ctx.intent === value)
    : pending && (formAction ? status.action === formAction : name ? status.data?.get(name) === value : true);
  return (
    <button
      type="submit"
      className={className}
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={mine}
      onClick={onClick}
      formAction={formAction}
    >
      {mine && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export function FormMessage({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (state?.error) {
    return (
      <p role="alert" className="notice notice-error">
        {state.error}
      </p>
    );
  }
  if (state?.ok) {
    return (
      <p role="status" className="notice">
        {state.ok}
      </p>
    );
  }
  return null;
}
