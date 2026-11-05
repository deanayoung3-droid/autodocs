import { connection } from "next/server";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { mailerReady } from "@/lib/mailer";
import { prefsFor } from "@/lib/notify";
import { canManage } from "@/lib/users";
import { PageHeader, Section } from "../../secondary";
import { saveNotificationsAction } from "../../settings-actions";
import { ActionPanel } from "../platform-forms";
import { BrowserPermission } from "./permission";

// Job: a person is choosing how they hear that Docs Agent finished their task; next they get on with something else.
export default async function NotificationsPage() {
  await connection();
  const user = await requireAdmin();
  const [prefs, mail] = await Promise.all([prefsFor(user.id), mailerReady()]);
  return (
    <>
      <PageHeader eyebrow="Account" title="Notifications" description="Hear when Docs Agent finishes a task you started." />
      <Section title="When Docs Agent finishes">
        <ActionPanel action={saveNotificationsAction} submitLabel="Save">
          <div className="flex flex-col gap-4">
            <label className="flex items-start gap-2.5 text-[13.5px]">
              <input type="checkbox" name="notifyEmail" defaultChecked={prefs.notify_email} className="toggle mt-0.5" />
              <span>
                Email me
                <span className="block text-[12.5px] text-muted">
                  The summary and a link to review the drafts.{" "}
                  {!mail &&
                    (canManage(user) ? (
                      <>
                        Email isn&rsquo;t set up yet:{" "}
                        <Link href="/admin/settings/email" className="link">
                          Email delivery
                        </Link>
                        .
                      </>
                    ) : (
                      "Email isn't set up yet; an admin can turn it on."
                    ))}
                </span>
              </span>
            </label>
            <div className="pl-[42px]">
              <label className="label" htmlFor="nt-address">
                Send to
              </label>
              <input
                id="nt-address"
                name="notifyAddress"
                type="email"
                defaultValue={prefs.notify_address}
                placeholder={user.email || "you@company.com"}
                className="field max-w-sm"
              />
              <p className="hint">{user.email ? "Leave empty to use your sign-in email." : "The built-in owner has no email, so add one here."}</p>
            </div>
            <label className="flex items-start gap-2.5 text-[13.5px]">
              <input type="checkbox" name="notifyBrowser" defaultChecked={prefs.notify_browser} className="toggle mt-0.5" />
              <span className="flex flex-col gap-1.5">
                <span>
                  Show a browser notification
                  <span className="block text-[12.5px] text-muted">While the admin is open in any tab.</span>
                </span>
                <BrowserPermission />
              </span>
            </label>
          </div>
        </ActionPanel>
      </Section>
    </>
  );
}
