import { connection } from "next/server";
import { EVENTS, listWebhooks, recentDeliveries } from "@/lib/events";
import { timeAgo } from "@/lib/format";
import { addWebhookAction, deleteWebhookAction } from "../../../platform-actions";
import { PageHeader, Section } from "../../../secondary";
import { ActionPanel } from "../../platform-forms";
import { managerGate } from "../../../managers-only";

export default async function WebhooksSettingsPage() {
  await connection();
  const gate = await managerGate("workspace settings");
  if (gate) return gate;
  const hooks = await listWebhooks();
  const deliveries = await recentDeliveries(12);

  return (
    <>
      <PageHeader eyebrow="Developers" title="Webhooks" description="Tell your other systems the moment docs change." />
      <div className="flex flex-col gap-6">
        <Section title="Endpoints" description="Each event is POSTed as JSON and signed with HMAC-SHA256 in the X-AutoDocs-Signature header.">
          <ActionPanel action={addWebhookAction} submitLabel="Add webhook">
            <div>
              <label className="label" htmlFor="wh-url">
                URL
              </label>
              <input id="wh-url" name="url" placeholder="https://example.com/hooks/docs" className="field max-w-md" />
            </div>
            <fieldset>
              <legend className="label">Events</legend>
              <div className="flex flex-wrap gap-2">
                {EVENTS.map((e) => (
                  <label
                    key={e}
                    className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 font-mono text-[12px] has-[:checked]:border-accent-line has-[:checked]:bg-accent-soft"
                  >
                    <input type="checkbox" name="events" value={e} defaultChecked className="size-3.5 accent-[var(--accent)]" />
                    {e}
                  </label>
                ))}
              </div>
            </fieldset>
          </ActionPanel>
          {hooks.length > 0 && (
            <ul className="card mt-5 divide-y divide-line">
              {hooks.map((w) => (
                <li key={w.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12.5px]">{w.url}</span>
                    <span className="block text-[12px] text-muted">{w.events === "*" ? "All events" : w.events.split(",").join(", ")}</span>
                  </span>
                  <form action={deleteWebhookAction}>
                    <input type="hidden" name="id" value={w.id} />
                    <button className="btn btn-quiet btn-danger h-7 px-2 text-[12px]">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recent deliveries">
          {deliveries.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing sent yet.</p>
          ) : (
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-line border-y border-line">
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="w-28 py-2 text-muted">{timeAgo(d.created_at)}</td>
                    <td className="py-2 font-mono text-[12.5px]">{d.event}</td>
                    <td className={`py-2 text-right ${d.status_code && d.status_code < 300 ? "text-success" : "text-danger"}`}>
                      {d.status_code ?? d.error}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </>
  );
}
