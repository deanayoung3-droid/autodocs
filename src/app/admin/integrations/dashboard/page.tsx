import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { IconChevronLeft, IconMonitor } from "@/components/icons";
import { aiConfigured } from "@/lib/ai";
import { captureLogin, listDashboards, listScreenshots, screenshotMarkdown, screenshotUrl, type Dashboard } from "@/lib/capture";
import { timeAgo } from "@/lib/format";
import { inboxStatus } from "@/lib/inbox";
import { publicOrigin } from "@/lib/integrations";
import { recentJobs } from "@/lib/jobs";
import {
  captureAction,
  deleteDashboardAction,
  deleteScreenshotAction,
  forgetSessionAction,
  retakeAction,
  saveCaptureLoginAction,
  saveDashboardAction,
  testDashboardAction,
} from "../../capture-actions";
import { PageHeader, Section } from "../../secondary";
import { ActionPanel, CopyField } from "../../settings/platform-forms";
import { SubmitButton } from "../../ui";
import { AutoRefresh } from "./auto-refresh";
import { LoginEmail } from "./login-email";
import { managerGate } from "../../managers-only";

const Step = ({ done, children }: { done: boolean; children: React.ReactNode }) => (
  <li className="flex items-start gap-2.5">
    <span
      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
        done ? "bg-success-soft text-success" : "border border-line-strong text-muted"
      }`}
    >
      {done ? "✓" : ""}
    </span>
    <span className="min-w-0">{children}</span>
  </li>
);

const STEPS_PLACEHOLDER = `1. Click "Log in"
2. Enter {{email}} in the "Email" field
3. Click "Continue"
4. Enter {{password}} in the "Password" field
5. Click "Log in"`;

function DashboardFields({ d }: { d?: Dashboard }) {
  const key = d?.id ?? "new";
  return (
    <div className="flex flex-col gap-4">
      {d && <input type="hidden" name="id" value={d.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`db-name-${key}`}>
            Name
          </label>
          <input id={`db-name-${key}`} name="name" defaultValue={d?.name ?? ""} placeholder="Your product" className="field" required />
        </div>
        <div>
          <label className="label" htmlFor={`db-url-${key}`}>
            Start address
          </label>
          <input
            id={`db-url-${key}`}
            name="url"
            type="url"
            defaultValue={d?.url ?? ""}
            placeholder="https://app.example.com"
            className="field font-mono text-[13px]"
            required
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`db-steps-${key}`}>
          Login steps <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id={`db-steps-${key}`}
          name="loginSteps"
          rows={5}
          defaultValue={d?.login_steps ?? ""}
          placeholder={STEPS_PLACEHOLDER}
          className="field font-mono text-[12.5px] leading-relaxed"
        />
        <p className="mt-1.5 text-[13px] text-muted">
          Standard sign-in forms work on their own, including emailed codes and links once the login email is set up. For anything else, write the steps
          with the exact button and field names. Use{" "}
          <code>{"{{email}}"}</code> and <code>{"{{password}}"}</code> for the test account; the values are typed in from Test account and
          the AI never sees them.
        </p>
      </div>
    </div>
  );
}

const VERDICT: Record<string, { label: string; cls: string }> = {
  passed: { label: "Checked", cls: "bg-success-soft text-success" },
  failed: { label: "Needs a look", cls: "bg-warn-soft text-warn-strong" },
  unchecked: { label: "Not checked", cls: "bg-sunken text-muted" },
};

// Job: a teammate is connecting the product so Docs Agent can capture screenshots, and next they test it or take one.
export default async function DashboardIntegrationPage({ searchParams }: PageProps<"/admin/integrations/dashboard">) {
  await connection();
  const gate = await managerGate("integrations");
  if (gate) return gate;
  const sp = await searchParams;
  const h = await headers();
  const origin = publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`);
  const [dashboards, shots, jobs, inbox, account] = await Promise.all([
    listDashboards(),
    listScreenshots(30),
    recentJobs("capture", 8),
    inboxStatus(),
    captureLogin(),
  ]);
  const ai = aiConfigured();
  const login = Boolean(account.email);
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const recentFailures = jobs.filter((j) => j.recent_failure);
  const tested = dashboards.some((d) => d.session_saved_at);

  return (
    <div className="mx-auto max-w-[860px] px-4 py-10 md:px-8 md:py-14">
      <AutoRefresh active={active.length > 0} />
      <Link href="/admin/integrations" className="mb-5 flex w-fit items-center gap-1 text-[13px] text-muted hover:text-ink">
        <IconChevronLeft size={14} /> Integrations
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <IconMonitor size={24} /> Dashboard
          </span>
        }
        description="Docs Agent signs in to your product with a test account, finds the right screen, and captures it with a red box around the control the article talks about."
      />

      <div className="flex flex-col gap-6">
        <Section title="Setup">
          <ol className="flex flex-col gap-3 text-[13px] text-graphite">
            <Step done={ai}>
              Add an OpenAI API key on the server.{" "}
              <Link href="/admin/settings/ai" className="link">
                Settings → AI
              </Link>
            </Step>
            <Step done={login}>
              Create a dedicated test account in your product (a test workspace with sample data, never a real customer&rsquo;s) and add it under Test
              account below.
            </Step>
            <Step done={Boolean(inbox.imap || inbox.forwardingKey)}>
              If your product signs in with a code or link sent by email, set up the login email below so Docs Agent can read it.
            </Step>
            <Step done={dashboards.length > 0}>Connect the product below.</Step>
            <Step done={tested}>Test the sign-in. Docs Agent keeps the session and signs in again when it expires.</Step>
          </ol>
        </Section>

        <Section
          title="Test account"
          description="The account Docs Agent signs in to your product with. It's sealed in the database and only typed into your product's sign-in page; the AI never sees it."
        >
          {account.fromServer ? (
            <p className="text-[13px] text-graphite">
              Set on the server as <code>CAPTURE_EMAIL</code>: <span className="font-mono">{account.email}</span>. Remove it there to manage the
              account here.
            </p>
          ) : (
            <ActionPanel action={saveCaptureLoginAction} submitLabel="Save test account" className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="capture-email">
                    Email
                  </label>
                  <input
                    id="capture-email"
                    name="email"
                    type="email"
                    defaultValue={account.email ?? ""}
                    required
                    autoComplete="off"
                    className="field font-mono text-[13px]"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="capture-password">
                    Password
                  </label>
                  <input
                    id="capture-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    placeholder={account.password ? "Saved. Leave empty to keep it." : "Only if your product uses one"}
                    className="field font-mono text-[13px]"
                  />
                </div>
              </div>
              {account.password && (
                <label className="flex items-center gap-2 text-[13px] text-graphite">
                  <input type="checkbox" name="clearPassword" /> Remove the saved password (the product signs in with an emailed code)
                </label>
              )}
            </ActionPanel>
          )}
        </Section>

        <LoginEmail origin={origin} imap={inbox.imap} forwardingKey={inbox.forwardingKey} testEmail={account.email ?? ""} />

        {dashboards.map((d) => (
          <section key={d.id} className="card rise overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{d.name}</p>
                <p className="truncate font-mono text-[12.5px] text-muted">{d.url}</p>
              </div>
              <span className="chip">
                <span className={`size-1.5 rounded-full ${d.last_error ? "bg-danger" : d.session_saved_at ? "bg-success" : "bg-line-strong"}`} />
                {d.last_error ? "Sign-in failed" : d.session_saved_at ? `Signed in ${timeAgo(d.session_saved_at)}` : "Not tested"}
              </span>
              <form action={testDashboardAction}>
                <input type="hidden" name="id" value={d.id} />
                <SubmitButton className="btn btn-sm" pendingLabel="Starting…" disabled={!ai && !login}>
                  {sp.testing === String(d.id) && active.length ? "Testing…" : "Test sign-in"}
                </SubmitButton>
              </form>
            </div>
            {d.last_error && <p className="notice notice-error mx-5 mb-4">{d.last_error}</p>}
            <details className="border-t border-line">
              <summary className="cursor-pointer px-5 py-3 text-[13px] text-muted hover:text-ink">Edit connection</summary>
              <div className="px-5 pb-5">
                <ActionPanel action={saveDashboardAction} submitLabel="Save">
                  <DashboardFields d={d} />
                </ActionPanel>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                  {d.session_saved_at && (
                    <form action={forgetSessionAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <SubmitButton className="btn btn-sm" pendingLabel="Forgetting…">
                        Forget saved sign-in
                      </SubmitButton>
                    </form>
                  )}
                  <form action={deleteDashboardAction}>
                    <input type="hidden" name="id" value={d.id} />
                    <SubmitButton className="btn btn-sm btn-danger" pendingLabel="Removing…">
                      Remove dashboard
                    </SubmitButton>
                  </form>
                </div>
              </div>
            </details>
          </section>
        ))}

        <Section
          title={dashboards.length ? "Add another dashboard" : "Connect your product"}
          description={dashboards.length ? "Another product, or a staging copy of this one." : "Where Docs Agent should start, and how to sign in."}
        >
          <ActionPanel action={saveDashboardAction} submitLabel="Connect">
            <DashboardFields />
          </ActionPanel>
        </Section>

        {dashboards.length > 0 && (
          <Section
            title="Take a screenshot"
            description="Docs Agent also takes these on its own while writing articles. Use this to capture one directly."
          >
            <ActionPanel action={captureAction} submitLabel="Capture">
              <div className="flex flex-col gap-4">
                {dashboards.length > 1 ? (
                  <div>
                    <label className="label" htmlFor="cap-dashboard">
                      Dashboard
                    </label>
                    <select id="cap-dashboard" name="dashboard" className="field max-w-sm" defaultValue={dashboards[0].id}>
                      {dashboards.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <input type="hidden" name="dashboard" value={dashboards[0].id} />
                )}
                <div>
                  <label className="label" htmlFor="cap-goal">
                    Screen
                  </label>
                  <input id="cap-goal" name="goal" required placeholder="The Create Case form, open and empty" className="field" />
                </div>
                <div>
                  <label className="label" htmlFor="cap-highlight">
                    Box in red
                  </label>
                  <input id="cap-highlight" name="highlight" placeholder="The Save button" className="field" />
                </div>
              </div>
            </ActionPanel>
          </Section>
        )}

        {(active.length > 0 || recentFailures.length > 0) && (
          <Section title="In progress">
            <ul className="flex flex-col gap-2 text-[13px]">
              {active.map((j) => (
                <li key={j.id} className="flex items-center gap-2.5">
                  <span className="working-dot" />
                  <span className="min-w-0 flex-1 truncate text-graphite">
                    {j.payload.test ? "Testing sign-in" : j.payload.screenshotId ? "Retaking a screenshot" : String(j.payload.goal ?? "Screenshot")}
                  </span>
                  <span className="shrink-0 truncate text-muted">{j.status === "queued" ? "Waiting" : j.error?.startsWith("…") ? j.error.slice(2) : "Starting"}</span>
                </li>
              ))}
              {recentFailures.map((j) => (
                <li key={j.id} className="notice notice-error">
                  {j.payload.test ? "Sign-in test" : String(j.payload.goal ?? "Screenshot")}: {j.error}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {shots.length > 0 && (
          <section aria-labelledby="shots">
            <h2 id="shots" className="heading mb-4">
              Screenshots
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {shots.map((s) => {
                const verdict = VERDICT[s.verified] ?? VERDICT.unchecked;
                return (
                  <li key={s.id} className="card rise flex flex-col overflow-hidden">
                    <a href={screenshotUrl(s.id)} target="_blank" className="block border-b border-line bg-sunken">
                      {/* eslint-disable-next-line @next/next/no-img-element -- served by our own route, already sized */}
                      <img src={`${screenshotUrl(s.id)}?v=${encodeURIComponent(s.updated_at)}`} alt={s.alt} className="aspect-[16/10] w-full object-cover object-top" loading="lazy" />
                    </a>
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 text-[13.5px] font-medium">{s.alt || s.recipe.goal || "Screenshot"}</p>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${verdict.cls}`}>{verdict.label}</span>
                      </div>
                      <p className="truncate font-mono text-[12px] text-muted">{s.page_url ? new URL(s.page_url).pathname : ""}</p>
                      {s.verify_note && <p className="text-[12.5px] text-warn-strong">{s.verify_note}</p>}
                      <div className="mt-auto pt-1">
                        <CopyField value={screenshotMarkdown(s)} />
                      </div>
                      <div className="flex gap-2">
                        {s.recipe.goal && s.recipe.goal !== "Connection test" && (
                          <form action={retakeAction}>
                            <input type="hidden" name="id" value={s.id} />
                            <SubmitButton className="btn btn-sm" pendingLabel="Queuing…">
                              Retake
                            </SubmitButton>
                          </form>
                        )}
                        <form action={deleteScreenshotAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <SubmitButton className="btn btn-quiet btn-sm" pendingLabel="Deleting…">
                            Delete
                          </SubmitButton>
                        </form>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
