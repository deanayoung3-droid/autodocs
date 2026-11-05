import { headers } from "next/headers";
import { connection } from "next/server";
import { IconChat, IconSearch, IconSlack, IconSpark } from "@/components/icons";
import { timeAgo } from "@/lib/format";
import { getIntegration, publicOrigin } from "@/lib/integrations";
import { slackSecretSource } from "@/lib/slack";
import { SLACK_TOPICS, slackAlerts, slackPeople } from "@/lib/slack-notify";
import {
  addSlackPersonAction,
  removeSlackAction,
  removeSlackAlertsAction,
  removeSlackPersonAction,
  saveSlackAlertsAction,
  saveSlackSecretAction,
  testSlackAlertsAction,
  testSlackPersonAction,
} from "../../integration-actions";
import { ActionPanel, CopyField } from "../../settings/platform-forms";
import { SubmitButton } from "../../ui";
import { Capabilities, ConnectionCard, ConnectionHeader, DetailsCard } from "../connection";
import { managerGate } from "../../managers-only";
import { HelpdeskPanels } from "../helpdesk/panels";

const CAPABILITIES = [
  { icon: <IconSpark size={15} />, text: "Post to a channel when drafts need review, articles go live, or readers ask for a person" },
  { icon: <IconChat size={15} />, text: "Ask Docs Agent to draft or fix an article with /docs from any channel" },
  { icon: <IconSpark size={15} />, text: "Get the result in Slack when the drafts are ready" },
  { icon: <IconSearch size={15} />, text: "Find doc gaps in resolved threads in your support channel" },
];

// Job: an owner is adding the /docs command to Slack, or pointing Docs Agent at the support
// channel; next someone runs /docs or a support thread resolves.
export default async function SlackIntegrationPage({ searchParams }: PageProps<"/admin/integrations/slack">) {
  await connection();
  const gate = await managerGate("integrations");
  if (gate) return gate;
  const sp = await searchParams;
  const h = await headers();
  const origin = publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`);
  const [meta, source, alerts, people] = await Promise.all([getIntegration("slack"), slackSecretSource(), slackAlerts(), slackPeople()]);
  const connected = Boolean(source);

  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 md:px-8 md:py-14">
      <ConnectionHeader
        icon={<IconSlack size={20} />}
        name={meta?.label || "Slack"}
        status={
          source === "saved"
            ? `Connected ${meta?.connected_at ? timeAgo(meta.connected_at) : ""} · /docs is on`
            : source === "environment"
              ? "Connected through SLACK_SIGNING_SECRET · /docs is on"
              : "Not connected"
        }
        actions={
          source === "saved" ? (
            <form action={removeSlackAction}>
              <SubmitButton className="btn btn-sm btn-danger" pendingLabel="Disconnecting…">
                Disconnect
              </SubmitButton>
            </form>
          ) : undefined
        }
      />
      {sp.disconnected && !connected && (
        <p role="status" className="notice mb-6">
          Slack is disconnected. /docs stops working until you add the signing secret again.
        </p>
      )}
      {sp.stopped && (
        <p role="status" className="notice mb-6">
          Docs Agent stopped reading the support channel and deleted its token. Threads already read, and drafts from them, stay.
        </p>
      )}
      {sp.alertsOff && !alerts.url && (
        <p role="status" className="notice mb-6">
          Notifications are off. Nothing more is posted to the channel.
        </p>
      )}
      <div className="flex flex-col gap-6">
        <Capabilities items={CAPABILITIES} />
        {connected && <DetailsCard kind="slack" label={meta?.label ?? ""} description={meta?.description ?? ""} defaultLabel="Slack" />}

        <ConnectionCard
          title="Notifications"
          description={
            alerts.url
              ? `Posting to ${alerts.channel || "your channel"}${alerts.source === "environment" ? " (SLACK_WEBHOOK_URL on the server)" : ""}.`
              : "Docs Agent posts to one channel through a Slack Incoming Webhook."
          }
        >
          {!alerts.url && (
            <ol className="flex flex-col divide-y divide-line">
              <li className="px-5 py-4 text-[13.5px]">
                <span className="num mr-2 font-semibold">1</span>
                In your Slack app (the one below, or a new one at{" "}
                <a href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noreferrer" className="link">
                  api.slack.com/apps
                </a>
                ), open <strong>Incoming Webhooks</strong>, turn it on, and click <strong>Add New Webhook</strong>.
              </li>
              <li className="px-5 py-4 text-[13.5px]">
                <span className="num mr-2 font-semibold">2</span>
                Pick the channel, such as <strong>#docs</strong>, and copy the webhook URL Slack shows.
              </li>
            </ol>
          )}
          <ActionPanel action={saveSlackAlertsAction} submitLabel={alerts.url ? "Save" : "Connect"} className="flex flex-col gap-4 border-t border-line px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
              <label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-medium">
                Webhook URL
                <input
                  name="webhookUrl"
                  type="password"
                  autoComplete="off"
                  required={!alerts.url}
                  placeholder={alerts.url ? "Saved. Paste a new one to change the channel." : "https://hooks.slack.com/services/…"}
                  className="field font-mono text-[13px] font-normal"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                Channel name
                <input name="channel" defaultValue={alerts.channel} placeholder="#docs" className="field text-[13px] font-normal" />
              </label>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[13px] font-medium">Post when</legend>
              {SLACK_TOPICS.map((t) => (
                <label key={t.key} className="flex cursor-pointer items-start gap-3 text-[13.5px]">
                  <input type="checkbox" name={`topic_${t.key}`} defaultChecked={alerts.topics[t.key]} className="mt-0.5 size-4 accent-[var(--accent)]" />
                  <span>
                    <span className="block">{t.label}</span>
                    <span className="block text-[12.5px] text-muted">{t.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </ActionPanel>
          {alerts.url && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
              <ActionPanel action={testSlackAlertsAction} submitLabel="Send a test message" className="flex items-center gap-3">
                <span className="sr-only">Send a test message to the channel</span>
              </ActionPanel>
              {alerts.source === "saved" && (
                <form action={removeSlackAlertsAction} className="ml-auto">
                  <SubmitButton className="btn btn-sm btn-danger" pendingLabel="Turning off…">
                    Turn off notifications
                  </SubmitButton>
                </form>
              )}
            </div>
          )}
        </ConnectionCard>

        <ConnectionCard
          title="Direct messages"
          description={
            people.length
              ? `${people.length} ${people.length === 1 ? "person gets" : "people get"} updates in their own Slack DMs, as well as the channel.`
              : "Teammates can get the same updates in their own Slack DMs, each choosing what they hear about."
          }
        >
          {people.length > 0 && (
            <ul className="flex flex-col divide-y divide-line">
              {people.map((p) => {
                const on = SLACK_TOPICS.filter((t) => p.topics[t.key]);
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium">{p.name}</p>
                      <p className="truncate text-[12.5px] text-muted">{on.length ? on.map((t) => t.label).join(" · ") : "Nothing turned on"}</p>
                    </div>
                    <ActionPanel action={testSlackPersonAction.bind(null, p.id)} submitLabel="Send a test" className="flex items-center gap-3">
                      <span className="sr-only">Send {p.name} a test message</span>
                    </ActionPanel>
                    <form action={removeSlackPersonAction.bind(null, p.id)}>
                      <SubmitButton className="btn btn-sm" pendingLabel="Removing…">
                        Remove
                      </SubmitButton>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
          <details className={people.length ? "border-t border-line" : ""}>
            <summary className="cursor-pointer px-5 py-3 text-[13px] text-muted hover:text-ink">Add a person</summary>
            <ol className="flex flex-col divide-y divide-line border-t border-line">
              <li className="px-5 py-4 text-[13.5px]">
                <span className="num mr-2 font-semibold">1</span>
                In the Slack app at{" "}
                <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="link">
                  api.slack.com/apps
                </a>
                , open <strong>Incoming Webhooks</strong> and click <strong>Add New Webhook</strong>. Whoever adds it picks themselves (&ldquo;you&rdquo;) as the
                destination, so the messages land in their own DMs.
              </li>
              <li className="px-5 py-4 text-[13.5px]">
                <span className="num mr-2 font-semibold">2</span>
                Copy the webhook URL Slack shows and paste it below with their name.
              </li>
            </ol>
            <ActionPanel action={addSlackPersonAction} submitLabel="Add person" className="flex flex-col gap-4 border-t border-line px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                  Name
                  <input name="name" required maxLength={60} placeholder="Alex" autoComplete="off" className="field text-[13px] font-normal" />
                </label>
                <label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-medium">
                  Webhook URL for their DM
                  <input name="webhookUrl" type="password" required autoComplete="off" placeholder="https://hooks.slack.com/services/…" className="field font-mono text-[13px] font-normal" />
                </label>
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-[13px] font-medium">Send them</legend>
                {SLACK_TOPICS.map((t) => (
                  <label key={t.key} className="flex cursor-pointer items-start gap-3 text-[13.5px]">
                    <input type="checkbox" name={`topic_${t.key}`} defaultChecked={t.on} className="mt-0.5 size-4 accent-[var(--accent)]" />
                    <span>{t.label}</span>
                  </label>
                ))}
              </fieldset>
            </ActionPanel>
          </details>
        </ConnectionCard>

        <ConnectionCard title={connected ? "Slack app" : "Set up the Slack app"} description="A small Slack app of your own carries the /docs command.">
          <ol className="flex flex-col divide-y divide-line">
            <li className="px-5 py-4 text-[13.5px]">
              <span className="num mr-2 font-semibold">1</span>
              Create an app at{" "}
              <a href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noreferrer" className="link">
                api.slack.com/apps
              </a>{" "}
              (From scratch), name it <strong>Docs Agent</strong>, and give it{" "}
              <a href="/api/agent-image" download="docs-agent.png" className="link">
                Docs Agent&rsquo;s picture
              </a>
              .
            </li>
            <li className="flex flex-col gap-2.5 px-5 py-4">
              <p className="text-[13.5px]">
                <span className="num mr-2 font-semibold">2</span>
                Under <strong>Slash Commands</strong>, create <code>/docs</code> with this request URL, then install the app to your workspace:
              </p>
              <CopyField value={`${origin}/api/slack/command`} />
            </li>
            <li className="flex flex-col gap-1 pt-4">
              <p className="px-5 text-[13.5px]">
                <span className="num mr-2 font-semibold">3</span>
                Paste the <strong>Signing Secret</strong> from Basic Information → App Credentials:
              </p>
              <ActionPanel action={saveSlackSecretAction} submitLabel={source === "saved" ? "Replace secret" : "Connect"} className="flex flex-col gap-3 px-5 py-4">
                <input
                  name="signingSecret"
                  type="password"
                  required
                  autoComplete="off"
                  aria-label="Signing secret"
                  placeholder={source ? "Saved. Paste a new one to replace it." : "32 letters and digits"}
                  className="field font-mono text-[13px]"
                />
              </ActionPanel>
            </li>
          </ol>
        </ConnectionCard>

        <ConnectionCard title="Using it">
          <p className="px-5 py-4 text-[13px] text-graphite">
            <code>/docs document how invoice reminders work</code> starts a task for Docs Agent. You get a link to follow along right away, and a
            message with the result when the drafts are ready to review.
          </p>
        </ConnectionCard>

        <h2 className="mt-4 text-[15px] font-semibold">Support channel</h2>
        <HelpdeskPanels id="slack-support" stoppable />
      </div>
    </div>
  );
}
