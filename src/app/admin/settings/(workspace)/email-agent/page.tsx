import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { publicOrigin } from "@/lib/integrations";
import { emailAgentKey, mailerReady } from "@/lib/mailer";
import { getSettings } from "@/lib/settings";
import { PageHeader, Section } from "../../../secondary";
import { savePanelAction, startEmailAgentAction, stopEmailAgentAction } from "../../../settings-actions";
import { SubmitButton } from "../../../ui";
import { ActionPanel, CodeBlock, CopyField } from "../../platform-forms";
import { managerGate } from "../../../managers-only";

// Job: an owner is giving the team an email address that turns requests into Docs Agent tasks; next someone emails it.
export default async function EmailAgentPage() {
  await connection();
  const gate = await managerGate("workspace settings");
  if (gate) return gate;
  const h = await headers();
  const origin = publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`);
  const [key, s, mail] = await Promise.all([emailAgentKey(), getSettings(), mailerReady()]);
  const url = key ? `${origin}/api/agent-email/${key}` : "";
  return (
    <>
      <PageHeader eyebrow="Docs Agent" title="Email Docs Agent" description="Forward a bug report, a customer email, or release notes to Docs Agent, and it starts a docs task." />
      <div className="flex flex-col gap-6">
        <Section
          title="Docs Agent's address"
          description="Pick an address on your domain, like docs@yourcompany.com, and have your email service forward it to this URL. Each email becomes a task."
        >
          {key ? (
            <div className="flex flex-col gap-4">
              <CopyField value={url} />
              <CodeBlock
                label="Cloudflare Email Routing: an Email Worker for docs@yourcompany.com"
                value={`export default {\n  async email(message) {\n    await fetch("${url}", {\n      method: "POST",\n      headers: { "Content-Type": "message/rfc822" },\n      body: message.raw,\n    });\n  },\n};`}
              />
              <p className="text-[13px] text-graphite">
                SendGrid Inbound Parse, Mailgun routes, and Postmark inbound can post here too. Anyone with this URL can send Docs Agent tasks, so keep it private.
              </p>
              <div className="flex gap-2">
                <form action={startEmailAgentAction}>
                  <SubmitButton className="btn btn-sm" pendingLabel="Replacing…">
                    New address
                  </SubmitButton>
                </form>
                <form action={stopEmailAgentAction}>
                  <SubmitButton className="btn btn-sm btn-danger" pendingLabel="Turning off…">
                    Turn off
                  </SubmitButton>
                </form>
              </div>
            </div>
          ) : (
            <form action={startEmailAgentAction}>
              <SubmitButton className="btn btn-primary" pendingLabel="Creating…">
                Create Docs Agent&rsquo;s address
              </SubmitButton>
            </form>
          )}
        </Section>

        <Section title="Who can email Docs Agent">
          <ActionPanel action={savePanelAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="emailAgentExternal,emailAgentReply" />
            <label className="flex items-start gap-2.5 text-[13.5px]">
              <input type="checkbox" name="emailAgentExternal" defaultChecked={s.emailAgentExternal} className="toggle mt-0.5" />
              <span>
                Accept email from people outside the team
                <span className="block text-[12.5px] text-muted">Off: only addresses of people on your Team can start tasks; anything else is ignored.</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-[13.5px]">
              <input type="checkbox" name="emailAgentReply" defaultChecked={s.emailAgentReply} className="toggle mt-0.5" />
              <span>
                Reply when the task is done
                <span className="block text-[12.5px] text-muted">
                  The summary and a link to the drafts, in the same email thread.{" "}
                  {!mail && (
                    <>
                      Needs{" "}
                      <Link href="/admin/settings/email" className="link">
                        email delivery
                      </Link>
                      .
                    </>
                  )}
                </span>
              </span>
            </label>
          </ActionPanel>
        </Section>
      </div>
    </>
  );
}
