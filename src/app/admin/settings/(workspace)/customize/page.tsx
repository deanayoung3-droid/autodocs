import { connection } from "next/server";
import { MascotAvatar } from "@/components/mascot";
import { getSettings } from "@/lib/settings";
import { PageHeader, Section } from "../../../secondary";
import { savePanelAction } from "../../../settings-actions";
import { ActionPanel } from "../../platform-forms";
import { managerGate } from "../../../managers-only";

const SENSITIVITY = [
  { value: "strict", label: "Only clear customer-facing changes", hint: "Fewest drafts. Skips refactors, internal tools, and small copy tweaks." },
  { value: "balanced", label: "Anything customers would notice", hint: "The default. New options, changed labels, limits, and behavior." },
  { value: "eager", label: "Anything that might matter", hint: "More drafts to dismiss, but almost nothing slips through." },
];

export default async function CustomizeAgentPage() {
  await connection();
  const gate = await managerGate("workspace settings");
  if (gate) return gate;
  const s = await getSettings();
  return (
    <>
      <PageHeader eyebrow="Docs Agent" title="Customize" description="Teach Docs Agent how your team writes and what's worth documenting." />
      <div className="flex flex-col gap-6">
        <Section title="Drafting instructions" description="How Docs Agent writes. It reads this before every task, audit, and pull request.">
          <ActionPanel action={savePanelAction} submitLabel="Save guidance">
            <input type="hidden" name="_fields" value="agentGuidance" />
            <input type="hidden" name="_saved" value="Docs Agent will follow this from the next task." />
            <div className="flex gap-3">
              <MascotAvatar size={32} />
              <div className="min-w-0 flex-1">
                <label className="sr-only" htmlFor="agent-guidance">
                  Guidance for Docs Agent
                </label>
                <textarea
                  id="agent-guidance"
                  name="agentGuidance"
                  rows={8}
                  defaultValue={s.agentGuidance}
                  className="field"
                  placeholder={
                    "Call customers “firms”, never “clients”.\nUse sentence case for headings.\nPut billing articles in the Billing section.\nNever mention internal tools by name."
                  }
                />
              </div>
            </div>
          </ActionPanel>
        </Section>

        <Section title="Research instructions" description="Where Docs Agent should look, and what to trust, before it writes or checks an article.">
          <ActionPanel action={savePanelAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="researchGuidance" />
            <input type="hidden" name="_saved" value="Docs Agent will research this way from the next task." />
            <textarea
              name="researchGuidance"
              aria-label="Research instructions"
              rows={6}
              maxLength={4000}
              defaultValue={s.researchGuidance}
              className="field"
              placeholder={"Billing logic lives in api/src/billing; the web app only displays it.\nTrust the code over older articles when they disagree.\nFeature flags in flags.ts mean a feature isn't live for everyone yet."}
            />
          </ActionPanel>
        </Section>

        <Section title="Pull request sensitivity" description="How readily Docs Agent drafts changes from a merged pull request.">
          <ActionPanel action={savePanelAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="prSensitivity" />
            <input type="hidden" name="_saved" value="Sensitivity saved." />
            <div className="flex flex-col gap-2">
              {SENSITIVITY.map((o) => (
                <label
                  key={o.value}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-4 py-3 transition-colors has-[:checked]:border-accent-line has-[:checked]:bg-accent-soft"
                >
                  <input type="radio" name="prSensitivity" value={o.value} defaultChecked={s.prSensitivity === o.value} className="mt-1 size-4 accent-[var(--accent)]" />
                  <span>
                    <span className="block font-medium">{o.label}</span>
                    <span className="block text-[13px] text-muted">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </ActionPanel>
        </Section>

        <Section
          title="Pull request sorting"
          description="Before drafting, Docs Agent sorts each merged pull request by the files it touches and the code itself: front end, a back-end change customers notice, internal, or infrastructure. Pull requests that only touch tests, CI, dependencies, or infrastructure are skipped without drafting. Add your own folders here; they're checked first."
        >
          <ActionPanel action={savePanelAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="prPathRules" />
            <input type="hidden" name="_saved" value="Saved. The next pull request is sorted with these rules." />
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] text-muted">
                One rule per line: a path pattern, then <code>=&gt;</code> and <strong>frontend</strong>, <strong>backend</strong>, or <strong>internal</strong>. Internal paths never start a draft.
              </span>
              <textarea
                name="prPathRules"
                rows={5}
                defaultValue={s.prPathRules}
                spellCheck={false}
                className="field font-mono text-[13px]"
                placeholder={"apps/web/** => frontend\napps/api/** => backend\napps/api/src/admin/** => internal\npackages/analytics/** => internal"}
              />
            </label>
          </ActionPanel>
        </Section>
      </div>
    </>
  );
}
