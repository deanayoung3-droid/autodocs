import { connection } from "next/server";
import { IconOpenAI } from "@/components/icons";
import { DEFAULT_MODELS, MODEL_CHOICES, aiConfigured } from "@/lib/ai";
import { all } from "@/lib/db";
import { usd } from "@/lib/format";
import { indexStatus } from "@/lib/search";
import { getSettings } from "@/lib/settings";
import { PageHeader, Section } from "../../../secondary";
import { chooseModelsAction, reindexAction } from "../../../settings-actions";
import { SubmitButton } from "../../../ui";
import { ActionPanel } from "../../platform-forms";
import { managerGate } from "../../../managers-only";

const PURPOSE: Record<string, string> = {
  agent: "Docs Agent tasks and pull requests",
  verify: "Verification",
  capture: "Screenshots",
  translate: "Translations",
  classify: "Support trends",
  answer: "Customer answers",
  embed: "Search index",
};

function ModelSelect({ name, value, fallback, label, hint }: { name: string; value: string; fallback: string; label: string; hint: string }) {
  const custom = value && !MODEL_CHOICES.some((m) => m.id === value);
  return (
    <div>
      <label className="label" htmlFor={`model-${name}`}>
        {label}
      </label>
      <select id={`model-${name}`} name={name} defaultValue={value} className="field max-w-md">
        <option value="">Default ({MODEL_CHOICES.find((m) => m.id === fallback)?.name ?? fallback})</option>
        {MODEL_CHOICES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} — {m.note}
          </option>
        ))}
        {custom && <option value={value}>{value}</option>}
      </select>
      <p className="mt-1.5 text-[13px] text-muted">{hint}</p>
    </div>
  );
}

// Job: an owner is checking that AI is set up and what it costs, and next they adjust a model or go use Docs Agent.
export default async function AISettingsPage() {
  await connection();
  const gate = await managerGate("workspace settings");
  if (gate) return gate;
  const [settings, index, usage] = await Promise.all([
    getSettings(),
    indexStatus(),
    all<{ purpose: string; requests: number; input: number; output: number; cost: number }>(
      `SELECT purpose, count(*) AS requests, sum(input_tokens) AS input, sum(output_tokens) AS output, sum(cost_usd) AS cost
       FROM ai_usage WHERE created_at >= now() - interval '30 days' GROUP BY purpose ORDER BY cost DESC, requests DESC`,
    ),
  ]);
  const ready = aiConfigured();
  const total = usage.reduce((s, u) => s + (u.cost ?? 0), 0);

  return (
    <>
      <PageHeader eyebrow="Docs Agent" title="AI" description="Docs Agent, screenshots, AI search, and customer answers run on the OpenAI API with the server's key." />

      <div className="flex flex-col gap-6">
        <section className="card rise overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4">
            <span className="flex size-10 items-center justify-center rounded-xl border border-line bg-sunken">
              <IconOpenAI size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">OpenAI API</p>
              <p className="truncate text-[13px] text-muted">
                {ready ? "The server has an API key. Usage is billed to that OpenAI account." : "No API key on the server yet. AI features are paused; search still works."}
              </p>
            </div>
            <span className="chip">
              <span className={`size-1.5 rounded-full ${ready ? "bg-success" : "bg-line-strong"}`} /> {ready ? "Connected" : "Not set"}
            </span>
          </div>
          {!ready && (
            <div className="border-t border-line px-5 py-4 text-[13px] text-graphite">
              <p>
                Create a key at <span className="font-medium">platform.openai.com → API keys</span>, then set it as <code>OPENAI_API_KEY</code>: in{" "}
                <code>.env.local</code> when running locally, or as a Secret Manager secret on Cloud Run. Restart the server after adding it.
              </p>
            </div>
          )}
        </section>

        <Section title="Models" description="Which OpenAI model each kind of work uses. Defaults balance quality and cost.">
          <ActionPanel action={chooseModelsAction} submitLabel="Save models" className="flex flex-col gap-4">
            <ModelSelect
              name="aiModel"
              value={settings.aiModel}
              fallback={DEFAULT_MODELS.team}
              label="Docs Agent"
              hint="Writing and updating articles, verification, audits, and the screenshot agent."
            />
            <ModelSelect
              name="answerModel"
              value={settings.answerModel}
              fallback={DEFAULT_MODELS.answer}
              label="Customer answers"
              hint="AI answers in the help center and widget. A fast model keeps answers quick."
            />
          </ActionPanel>
        </Section>

        <Section
          title="AI search"
          description="Every article is split into sections and indexed by meaning, so questions find the right answer even when they don't use the article's words."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-graphite">
              <span className="num font-semibold text-ink">{index.indexed}</span> of <span className="num">{index.articles}</span> articles indexed ·{" "}
              <span className="num">{index.sections}</span> sections
              {ready && index.indexed < index.articles && <span className="text-muted"> · indexing continues in the background</span>}
            </p>
            <form action={reindexAction}>
              <SubmitButton className="btn btn-sm" pendingLabel="Queuing…" disabled={!ready}>
                Rebuild index
              </SubmitButton>
            </form>
          </div>
        </Section>

        <Section title="Usage" description="Requests and cost in the last 30 days, at OpenAI's standard prices.">
          {usage.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing yet.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-muted">
                  <th className="pb-2 font-medium">Feature</th>
                  <th className="pb-2 text-right font-medium">Requests</th>
                  <th className="hidden pb-2 text-right font-medium sm:table-cell">Tokens in</th>
                  <th className="hidden pb-2 text-right font-medium sm:table-cell">Tokens out</th>
                  <th className="pb-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line border-y border-line">
                {usage.map((u) => (
                  <tr key={u.purpose}>
                    <td className="py-2">{PURPOSE[u.purpose] ?? u.purpose}</td>
                    <td className="num py-2 text-right">{u.requests.toLocaleString()}</td>
                    <td className="num hidden py-2 text-right text-muted sm:table-cell">{(u.input ?? 0).toLocaleString()}</td>
                    <td className="num hidden py-2 text-right text-muted sm:table-cell">{(u.output ?? 0).toLocaleString()}</td>
                    <td className="num py-2 text-right">{usd(u.cost ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-2 font-medium" colSpan={2}>
                    Total
                  </td>
                  <td className="hidden sm:table-cell" colSpan={2} />
                  <td className="num pt-2 text-right font-semibold">{usd(total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Section>
      </div>
    </>
  );
}
