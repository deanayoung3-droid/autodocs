import Link from "next/link";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getSettings, secretStatus } from "@/lib/settings";
import { fileUrl } from "@/lib/storage";
import { PageHeader, Section } from "../../secondary";
import { deleteWorkspaceContentAction, savePanelAction, uploadWorkspaceIconAction } from "../../settings-actions";
import { ActionPanel } from "../platform-forms";
import { managerGate } from "../../managers-only";

export default async function GeneralSettingsPage() {
  await connection();
  const gate = await managerGate("workspace settings");
  if (gate) return gate;
  const [s, user] = await Promise.all([getSettings(), requireAdmin()]);
  const secrets = secretStatus();

  const env: { name: string; set: boolean; purpose: string; optional?: boolean }[] = [
    { name: "ADMIN_PASSWORD", set: secrets.adminPassword, purpose: "Owner sign-in" },
    { name: "OPENAI_API_KEY", set: secrets.openaiKey, purpose: "Docs Agent, AI search, screenshots, and customer answers" },
    { name: "DATABASE_URL", set: secrets.database, purpose: "Cloud SQL in production (built-in Postgres when unset)", optional: true },
    { name: "GCS_BUCKET", set: secrets.cloudStorage, purpose: "Cloud Storage for images (local disk when unset)", optional: true },
    { name: "CAPTURE_EMAIL / CAPTURE_PASSWORD", set: secrets.captureLogin, purpose: "The test account screenshots sign in with (or set it on Integrations → Dashboard)", optional: true },
    { name: "SESSION_SECRET", set: Boolean(process.env.SESSION_SECRET), purpose: "Signs sessions and seals saved credentials", optional: true },
    { name: "PUBLIC_URL", set: Boolean(process.env.PUBLIC_URL), purpose: "The address GitHub, Linear, and Slack send events to", optional: true },
    { name: "READER_JWT_SECRET", set: secrets.readerJwt, purpose: "Readers signing in with their account on your product", optional: true },
  ];

  return (
    <>
      <PageHeader title="General" description="Your workspace and the server it runs on." />
      <div className="flex flex-col gap-6">
        <Section
          title="Workspace"
          description={
            <>
              Colors, logo, and links live in{" "}
              <Link href="/admin/help-center/customize" className="link">
                Help Center → Customize
              </Link>
              .
            </>
          }
        >
          <ActionPanel action={savePanelAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="brandName,websiteUrl,costPerTicket" />
            <input type="hidden" name="_saved" value="Workspace saved." />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="gs-name">
                  Name
                </label>
                <input id="gs-name" name="brandName" defaultValue={s.brandName} className="field" required />
                <p className="mt-1.5 text-[13px] text-muted">Shown in the help center, widget, and emails.</p>
              </div>
              <div>
                <label className="label" htmlFor="gs-site">
                  Website
                </label>
                <input id="gs-site" name="websiteUrl" type="url" defaultValue={s.websiteUrl} placeholder="https://example.com" className="field" />
                <p className="mt-1.5 text-[13px] text-muted">Docs Agent reads it to learn about your company.</p>
              </div>
              <div>
                <label className="label" htmlFor="gs-cost">
                  Cost of a support ticket ($)
                </label>
                <input id="gs-cost" name="costPerTicket" type="number" min={0} step="0.5" defaultValue={s.costPerTicket} className="field num" />
                <p className="mt-1.5 text-[13px] text-muted">Used to estimate what self-serve answers save.</p>
              </div>
            </div>
          </ActionPanel>
        </Section>

        <Section title="Workspace icon" description="Shown in the admin's sidebar and on the Linear and Slack apps you create.">
          <div className="flex flex-wrap items-center gap-4">
            {s.workspaceIcon ? (
              // eslint-disable-next-line @next/next/no-img-element -- served by our own file route
              <img src={fileUrl(s.workspaceIcon)} alt="" className="size-12 rounded-lg border border-line object-cover" />
            ) : (
              <span aria-hidden className="flex size-12 items-center justify-center rounded-lg bg-sunken text-[18px] font-semibold text-muted">
                {s.brandName.charAt(0).toUpperCase()}
              </span>
            )}
            <ActionPanel action={uploadWorkspaceIconAction} submitLabel="Upload" className="flex flex-wrap items-center gap-2">
              <input name="icon" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required aria-label="Workspace icon" className="text-[13px]" />
            </ActionPanel>
          </div>
        </Section>

        <Section
          title="Server"
          description="Secrets are read from the server's environment and never shown here. Change them in .env.local (or Secret Manager on Cloud Run) and restart."
        >
          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-line border-y border-line">
              {env.map((e) => (
                <tr key={e.name}>
                  <td className="py-2 font-mono text-[12.5px]">{e.name}</td>
                  <td className="hidden py-2 text-muted sm:table-cell">{e.purpose}</td>
                  <td className={`py-2 text-right ${e.set ? "text-graphite" : e.optional ? "text-muted" : "font-medium text-danger"}`}>
                    {e.set ? "Set" : e.optional ? "Optional" : "Not set"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        {user.role === "owner" && (
          <Section
            title="Danger zone"
            description="Deletes every article, section, Docs Agent thread, screenshot, and analytics record. Settings, the team, and integrations stay. This can't be undone; export first if you might want anything back."
          >
            <ActionPanel action={deleteWorkspaceContentAction} submitLabel="Delete all content" className="flex flex-col gap-3">
              <div className="max-w-sm">
                <label className="label" htmlFor="gs-danger">
                  Type <span className="font-mono">{s.brandName}</span> to confirm
                </label>
                <input id="gs-danger" name="confirm" autoComplete="off" className="field" />
              </div>
            </ActionPanel>
          </Section>
        )}
      </div>
    </>
  );
}
