import { connection } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { PageHeader, Section } from "../../secondary";
import { changePasswordAction } from "../../settings-actions";
import { ActionPanel } from "../platform-forms";

// Job: a person is changing their password; next they sign in with it.
export default async function SecurityPage() {
  await connection();
  const user = await requireAdmin();
  return (
    <>
      <PageHeader eyebrow="Account" title="Security" description="Your password." />
      <Section title="Change password" description="At least 15 characters. A short phrase is easier to remember than symbols.">
        {user.id === 0 ? (
          <p className="notice">
            The built-in owner signs in with <code>ADMIN_PASSWORD</code> from the server&rsquo;s environment. Change it there (Secret Manager on Cloud
            Run) and restart.
          </p>
        ) : (
          <ActionPanel action={changePasswordAction} submitLabel="Change password">
            <input type="email" name="username" autoComplete="username" defaultValue={user.email} hidden readOnly />
            <div className="flex max-w-sm flex-col gap-4">
              <div>
                <label className="label" htmlFor="sec-current">
                  Current password
                </label>
                <input id="sec-current" name="current" type="password" required autoComplete="current-password" className="field" />
              </div>
              <div>
                <label className="label" htmlFor="sec-next">
                  New password
                </label>
                <input id="sec-next" name="next" type="password" required minLength={15} autoComplete="new-password" className="field" />
              </div>
              <div>
                <label className="label" htmlFor="sec-confirm">
                  Confirm new password
                </label>
                <input id="sec-confirm" name="confirm" type="password" required minLength={15} autoComplete="new-password" className="field" />
              </div>
            </div>
          </ActionPanel>
        )}
      </Section>
    </>
  );
}
