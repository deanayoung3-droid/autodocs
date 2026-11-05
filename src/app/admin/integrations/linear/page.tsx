import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { IconChat, IconLinear, IconPencil, IconSpark } from "@/components/icons";
import { timeAgo } from "@/lib/format";
import { adminOrigin, getIntegration, publicOrigin, reachableFromInternet } from "@/lib/integrations";
import { linearSetupStatus, recentLinearSessions, type LinearConfig } from "@/lib/linear";
import { disconnectLinearAction, saveLinearCredentialsAction } from "../../integration-actions";
import { ActionPanel, CopyField } from "../../settings/platform-forms";
import { SubmitButton } from "../../ui";
import { Capabilities, ConnectionCard, ConnectionHeader, DetailsCard } from "../connection";
import { managerGate } from "../../managers-only";

const CAPABILITIES = [
  { icon: <IconChat size={15} />, text: "Mention or assign Docs Agent on an issue to start a docs task" },
  { icon: <IconSpark size={15} />, text: "Docs Agent shows its progress and the result right in the issue" },
  { icon: <IconPencil size={15} />, text: "Reply to Docs Agent in the issue to revise its drafts" },
];

const ERRORS: Record<string, string> = {
  signin: "Sign in first, then connect Linear again.",
  state: "That Linear link is out of date or didn't start here. Connect again from this page.",
  nocode: "Linear didn't send an authorization back. Connect again.",
  denied: "Linear's install was cancelled, so nothing changed.",
  credentials: "Save the Linear app's client ID and secret first.",
};

const STATUS: Record<string, { label: string; chip: string }> = {
  running: { label: "Working", chip: "chip chip-accent" },
  done: { label: "Drafted", chip: "chip chip-ok" },
  failed: { label: "Failed", chip: "chip chip-danger" },
  dismissed: { label: "Stopped", chip: "chip" },
};

// Job: an owner is installing Docs Agent in Linear so teammates can hand it docs work from issues; next
// they mention Docs Agent on an issue.
export default async function LinearIntegrationPage({ searchParams }: PageProps<"/admin/integrations/linear">) {
  await connection();
  const gate = await managerGate("integrations");
  if (gate) return gate;
  const sp = await searchParams;
  const h = await headers();
  const origin = publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`);
  const [meta, setup, sessions] = await Promise.all([getIntegration<LinearConfig>("linear"), linearSetupStatus(), recentLinearSessions(10)]);
  const config = meta?.config ?? {};
  const connected = Boolean(meta?.connected_at && config.organizationId);
  const ready = Boolean(setup.clientId && setup.hasSecret);
  const reachable = reachableFromInternet(origin);
  const error = typeof sp.error === "string" ? (ERRORS[sp.error] ?? sp.error) : "";
  const agentName = config.appUserName || "Docs Agent";

  const credentials = (
    <ActionPanel action={saveLinearCredentialsAction} submitLabel="Save credentials" className="flex flex-col gap-4 px-5 py-4">
      <div>
        <label className="label" htmlFor="ln-client">
          Client ID
        </label>
        <input id="ln-client" name="clientId" defaultValue={setup.clientId} required autoComplete="off" spellCheck={false} className="field font-mono text-[13px]" />
      </div>
      <div>
        <label className="label" htmlFor="ln-secret">
          Client secret
        </label>
        <input
          id="ln-secret"
          name="clientSecret"
          type="password"
          required={!setup.hasSecret}
          autoComplete="off"
          placeholder={setup.hasSecret ? "Saved. Leave empty to keep it." : ""}
          className="field font-mono text-[13px]"
        />
      </div>
      <div>
        <label className="label" htmlFor="ln-webhook">
          Webhook signing secret
        </label>
        <input
          id="ln-webhook"
          name="webhookSecret"
          type="password"
          autoComplete="off"
          placeholder={setup.hasWebhookSecret ? "Saved. Leave empty to keep it." : "Shown in Linear after you turn on webhooks"}
          className="field font-mono text-[13px]"
        />
      </div>
    </ActionPanel>
  );

  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 md:px-8 md:py-14">
      <ConnectionHeader
        icon={<IconLinear size={20} />}
        name={meta?.label || "Linear"}
        status={connected ? `Connected ${meta?.connected_at ? timeAgo(meta.connected_at) : ""} · ${config.organizationName} as ${agentName}` : "Not connected"}
        actions={
          connected ? (
            <>
              <form action="/api/linear/connect">
                <button type="submit" className="btn btn-sm">
                  Reconnect
                </button>
              </form>
              <form action={disconnectLinearAction}>
                <SubmitButton className="btn btn-sm btn-danger" pendingLabel="Disconnecting…">
                  Disconnect
                </SubmitButton>
              </form>
            </>
          ) : undefined
        }
      />
      {error && (
        <p role="alert" className="notice notice-error mb-6">
          {error}
        </p>
      )}
      {sp.connected && connected && (
        <p role="status" className="notice mb-6">
          Docs Agent is installed in {config.organizationName}. Mention {agentName} on any issue to try it.
        </p>
      )}
      {sp.disconnected && !connected && (
        <p role="status" className="notice mb-6">
          Linear is disconnected. Docs Agent no longer responds in Linear; its threads here stay.
        </p>
      )}

      <div className="flex flex-col gap-6">
        <Capabilities items={CAPABILITIES} />
        {connected && <DetailsCard kind="linear" label={meta?.label ?? ""} description={meta?.description ?? ""} defaultLabel="Linear" />}

        {connected && (
          <ConnectionCard title="Requests from Linear" description="Issues where someone asked Docs Agent for docs work, newest first.">
            {sessions.length ? (
              <ul className="divide-y divide-line">
                {sessions.map((s) => {
                  const st = STATUS[s.status] ?? STATUS.running;
                  return (
                    <li key={s.session_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                      <Link href={`/admin/agent/${s.run_id}`} className="min-w-0 flex-1 truncate text-[13.5px] hover:underline">
                        <span className="num font-mono text-[12.5px] text-muted">{s.issue_identifier}</span> {s.issue_title}
                      </Link>
                      <span className="text-[12.5px] text-muted">
                        {s.requested_by ? `${s.requested_by} · ` : ""}
                        {timeAgo(s.created_at)}
                      </span>
                      <span className={st.chip}>{st.label}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-4 text-[13px] text-muted">No requests yet. Mention {agentName} on any Linear issue, or assign the issue to {agentName}, and the task shows up here.</p>
            )}
          </ConnectionCard>
        )}

        {!connected && (
          <ConnectionCard
            title="Set up the Linear app"
            description="Linear installs Docs Agent from an app you create in your workspace, so it appears there as Docs Agent and only your workspace can use it. Takes about two minutes."
          >
            <ol className="flex flex-col divide-y divide-line">
              <li className="flex flex-col gap-2.5 px-5 py-4">
                <p className="text-[13.5px]">
                  <span className="num mr-2 font-semibold">1</span>
                  In Linear, go to{" "}
                  <a href="https://linear.app/settings/api/applications/new" target="_blank" rel="noreferrer" className="link">
                    Settings → API → New application
                  </a>
                  . Name it <strong>Docs Agent</strong> (the name people mention) and upload{" "}
                  <a href="/api/agent-image" download="docs-agent.png" className="link">
                    Docs Agent&rsquo;s picture
                  </a>
                  .
                </p>
              </li>
              <li className="flex flex-col gap-2.5 px-5 py-4">
                <p className="text-[13.5px]">
                  <span className="num mr-2 font-semibold">2</span>
                  Set the <strong>Callback URL</strong> to:
                </p>
                <CopyField value={`${adminOrigin(origin)}/api/linear/callback`} />
              </li>
              <li className="flex flex-col gap-2.5 px-5 py-4">
                <p className="text-[13.5px]">
                  <span className="num mr-2 font-semibold">3</span>
                  Turn on <strong>Webhooks</strong>, set the URL below, and tick <strong>Agent session events</strong>. Then create the app.
                </p>
                <CopyField value={`${origin}/api/linear/webhook`} />
                {!reachable && (
                  <p className="notice">
                    This server runs at {origin}, which Linear can&rsquo;t reach. Set this up from the deployed workspace at its public address so Linear can deliver mentions.
                  </p>
                )}
              </li>
              <li className="flex flex-col gap-1 pt-4">
                <p className="px-5 text-[13.5px]">
                  <span className="num mr-2 font-semibold">4</span>
                  Paste the app&rsquo;s credentials from Linear:
                </p>
                {credentials}
              </li>
              <li className="flex flex-col gap-2.5 px-5 py-4">
                <p className="text-[13.5px]">
                  <span className="num mr-2 font-semibold">5</span>
                  Install Docs Agent in your Linear workspace. Linear asks a workspace admin to approve it.
                </p>
                <div>
                  {ready ? (
                    <form action="/api/linear/connect">
                      <button type="submit" className="btn btn-primary">
                        <IconLinear size={14} /> Connect Linear
                      </button>
                    </form>
                  ) : (
                    <p className="text-[13px] text-muted">Save the client ID and secret above to continue.</p>
                  )}
                </div>
              </li>
            </ol>
          </ConnectionCard>
        )}

        {connected && (
          <ConnectionCard title="Linear app" description={`Client ID ${setup.clientId}. Replace these if you recreate the app in Linear.`}>
            <details className="group">
              <summary className="cursor-pointer px-5 py-3 text-[13px] text-muted hover:text-ink">Replace credentials</summary>
              {credentials}
            </details>
          </ConnectionCard>
        )}
      </div>
    </div>
  );
}
