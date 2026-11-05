import { connection } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { mailStatus } from "@/lib/mailer";
import { PageHeader, Section } from "../../../secondary";
import { removeSmtpAction, saveSmtpAction, sendTestEmailAction } from "../../../settings-actions";
import { SubmitButton } from "../../../ui";
import { ActionPanel } from "../../platform-forms";
import { managerGate } from "../../../managers-only";

// Job: an owner is letting the workspace send email (task notifications, Email Docs Agent replies); next they send a test.
export default async function EmailDeliveryPage() {
  await connection();
  const gate = await managerGate("workspace settings");
  if (gate) return gate;
  const [user, mail] = await Promise.all([requireAdmin(), mailStatus()]);
  const smtp = mail.smtp;
  return (
    <>
      <PageHeader title="Email delivery" description="How the workspace sends email: task notifications and Email Docs Agent's replies. Any SMTP service works." />
      <div className="flex flex-col gap-6">
        <Section
          title="SMTP server"
          description={
            mail.source === "environment"
              ? "Set by SMTP_URL and MAIL_FROM on the server. Saving here takes over from them."
              : smtp
                ? `Sending as ${smtp.from} through ${smtp.host}.`
                : "Google Workspace (smtp.gmail.com with an app password), SendGrid, Postmark, Mailgun, and Amazon SES all work."
          }
        >
          <ActionPanel action={saveSmtpAction} submitLabel={smtp ? "Save and reconnect" : "Connect"}>
            <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
              <div>
                <label className="label" htmlFor="sm-host">
                  Server
                </label>
                <input id="sm-host" name="host" required defaultValue={smtp?.host ?? ""} placeholder="smtp.gmail.com" className="field font-mono text-[13px]" />
              </div>
              <div>
                <label className="label" htmlFor="sm-port">
                  Port
                </label>
                <input id="sm-port" name="port" inputMode="numeric" defaultValue={smtp?.port ?? 587} className="field font-mono text-[13px]" />
              </div>
              <div>
                <label className="label" htmlFor="sm-user">
                  Username
                </label>
                <input id="sm-user" name="user" defaultValue={smtp?.user ?? ""} autoComplete="off" className="field font-mono text-[13px]" />
              </div>
              <div>
                <label className="label" htmlFor="sm-pass">
                  Password
                </label>
                <input
                  id="sm-pass"
                  name="password"
                  type="password"
                  autoComplete="off"
                  placeholder={mail.source === "saved" ? "Saved" : ""}
                  className="field font-mono text-[13px]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="sm-from">
                  From
                </label>
                <input id="sm-from" name="from" required defaultValue={smtp?.from ?? ""} placeholder="Docs Agent <docs@yourcompany.com>" className="field" />
              </div>
            </div>
          </ActionPanel>
          {mail.source === "saved" && (
            <form action={removeSmtpAction} className="mt-3">
              <SubmitButton className="btn btn-sm btn-danger" pendingLabel="Removing…">
                Stop sending email
              </SubmitButton>
            </form>
          )}
        </Section>

        {smtp && (
          <Section title="Send a test">
            <ActionPanel action={sendTestEmailAction} submitLabel="Send test" className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <label className="label" htmlFor="sm-to">
                  To
                </label>
                <input id="sm-to" name="to" type="email" required defaultValue={user.email} className="field" />
              </div>
            </ActionPanel>
          </Section>
        )}
      </div>
    </>
  );
}
