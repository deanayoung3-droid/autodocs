import { Fragment } from "react";
import { timeAgo } from "@/lib/format";
import { helpdeskInfo, helpdeskState, type HelpdeskId, type HelpdeskState } from "@/lib/helpdesks";
import { listConversations, supportConfig, supportStats } from "@/lib/support";
import { disconnectHelpdeskAction, saveHelpdeskAction, syncHelpdeskNowAction } from "../../integration-actions";
import { ActionPanel } from "../../settings/platform-forms";
import { SubmitButton } from "../../ui";
import { ConnectionCard } from "../connection";
import { ConversationList, DraftingCard } from "../support/parts";

/** A helpdesk's tile mark: its initials ("Help Scout" → HS, "Intercom" → In). */
export function HelpdeskMark({ name }: { name: string }) {
  const words = name.split(/\s+/);
  return (
    <span aria-hidden className="text-[14px] font-semibold tracking-tight">
      {words.length > 1 ? words.map((w) => w[0]).join("") : name.slice(0, 2)}
    </span>
  );
}

/** A setup step, with [text](url) turned into links. */
function StepText({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        return m ? (
          <a key={i} href={m[2]} target="_blank" rel="noreferrer" className="link">
            {m[1]}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        );
      })}
    </>
  );
}

function CredentialsForm({ id, state }: { id: HelpdeskId; state: HelpdeskState }) {
  const info = helpdeskInfo(id);
  return (
    <ActionPanel action={saveHelpdeskAction.bind(null, id)} submitLabel={state.connected ? "Save and check" : `Connect ${info.name}`} className="flex flex-col gap-4 px-5 py-4">
      {info.fields.map((f) => {
        const fieldId = `hd-${id}-${f.name}`;
        return (
          <div key={f.name}>
            <label className="label" htmlFor={fieldId}>
              {f.label}
            </label>
            {f.options ? (
              <select id={fieldId} name={f.name} defaultValue={state.values?.[f.name] ?? f.options[0].value} className="field">
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={fieldId}
                name={f.name}
                type={f.secret ? "password" : "text"}
                required={!(f.secret && state.connected)}
                defaultValue={f.secret ? undefined : (state.values?.[f.name] ?? "")}
                placeholder={f.secret && state.connected ? "Saved. Leave empty to keep it." : f.placeholder}
                autoComplete="off"
                spellCheck={false}
                className={`field ${f.secret || /id|token|key/i.test(f.name) ? "font-mono text-[13px]" : ""}`}
              />
            )}
            {f.hint && <p className="hint mt-1">{f.hint}</p>}
          </div>
        );
      })}
    </ActionPanel>
  );
}

/**
 * Everything under a helpdesk's header: how to connect it, or how reading is going, then drafting
 * and what was read. The Slack page shows the same for its support channel, with its own Stop
 * button since the page header disconnects the /docs command.
 */
export async function HelpdeskPanels({ id, stoppable = false }: { id: HelpdeskId; stoppable?: boolean }) {
  const info = helpdeskInfo(id);
  const [state, stats, conversations, config] = await Promise.all([helpdeskState(id), supportStats(id), listConversations(15, id), supportConfig()]);

  return (
    <>
      {state.connected ? (
        <ConnectionCard
          title={`Reading ${info.items}`}
          description={
            state.lastSyncAt
              ? `Checked ${timeAgo(state.lastSyncAt)}: ${state.lastCount ? `${state.lastCount} new` : "nothing new"}. Checks again every 15 minutes.`
              : "Reading the last week now. Refresh in a minute to see what came in."
          }
          actions={
            <div className="flex shrink-0 gap-2">
              <form action={syncHelpdeskNowAction.bind(null, id)}>
                <SubmitButton className="btn btn-sm" pendingLabel="Queuing…">
                  Check now
                </SubmitButton>
              </form>
              {stoppable && (
                <form action={disconnectHelpdeskAction.bind(null, id)}>
                  <SubmitButton className="btn btn-sm btn-danger" pendingLabel="Stopping…">
                    Stop reading
                  </SubmitButton>
                </form>
              )}
            </div>
          }
        >
          {state.lastError && (
            <p role="alert" className="notice notice-error mx-5 my-3">
              {state.lastError}
            </p>
          )}
          <details className="group border-t border-line">
            <summary className="cursor-pointer px-5 py-3 text-[13px] text-muted hover:text-ink">Replace credentials</summary>
            <CredentialsForm id={id} state={state} />
          </details>
        </ConnectionCard>
      ) : (
        <ConnectionCard title={`Connect ${info.name}`} description={`Docs Agent only reads ${info.items}. Credentials are encrypted on this server.`}>
          <ol className="flex flex-col divide-y divide-line">
            {info.steps.map((s, i) => (
              <li key={i} className="px-5 py-3.5 text-[13.5px]">
                <span className="num mr-2 font-semibold">{i + 1}</span>
                <StepText text={s} />
              </li>
            ))}
            <li>
              <CredentialsForm id={id} state={state} />
            </li>
          </ol>
        </ConnectionCard>
      )}

      {(state.connected || stats.total > 0) && (
        <>
          <DraftingCard autoDraft={config.autoDraft} waiting={stats.waiting} />
          <ConversationList
            title={`Recent ${info.items}`}
            conversations={conversations}
            empty={`Nothing yet. ${info.items.charAt(0).toUpperCase()}${info.items.slice(1)} from the last week show up here after the first read.`}
          />
        </>
      )}
    </>
  );
}
