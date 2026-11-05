import Link from "next/link";
import { connection } from "next/server";
import { getSettings } from "@/lib/settings";
import { PageHeader, Section } from "../../../secondary";
import { savePanelAction } from "../../../settings-actions";
import { ActionPanel, CodeBlock } from "../../platform-forms";
import { managerGate } from "../../../managers-only";

const TONES = [
  { value: "friendly", label: "Friendly", example: "Happy to help! Open the case and choose More → Export." },
  { value: "professional", label: "Professional", example: "To export a case, open it and select More → Export." },
  { value: "plainspoken", label: "Plainspoken", example: "Open the case. Click More → Export." },
  { value: "playful", label: "Playful", example: "Easy one! Pop open the case and hit More → Export." },
] as const;

const LENGTHS = [
  { value: "concise", label: "Concise", hint: "About 80 words" },
  { value: "standard", label: "Standard", hint: "About 150 words" },
  { value: "thorough", label: "Thorough", hint: "About 300 words" },
] as const;

// Job: an owner is shaping how AI answers sound and when they hand off to a person; next they try a question in the help center.
export default async function AssistantSettingsPage() {
  await connection();
  const gate = await managerGate("workspace settings");
  if (gate) return gate;
  const s = await getSettings();
  return (
    <>
      <PageHeader
        eyebrow="Docs Agent"
        title="AI Assistant"
        description="How AI answers in the help center and widget sound, what they won't discuss, and when they hand off to your team."
      />
      <div className="flex flex-col gap-6">
        <Section title="Personality">
          <ActionPanel action={savePanelAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="assistantTone,assistantEmoji,assistantOwnWords,assistantLength,assistantScreenshots" />
            <input type="hidden" name="_saved" value="Saved. New answers use it right away." />
            <fieldset>
              <legend className="label">Tone</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {TONES.map((t) => (
                  <label key={t.value} className="flex cursor-pointer gap-2.5 rounded-lg border border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                    <input type="radio" name="assistantTone" value={t.value} defaultChecked={s.assistantTone === t.value} className="mt-0.5 accent-[var(--accent)]" />
                    <span>
                      <span className="block text-[13.5px] font-medium">{t.label}</span>
                      <span className="block text-[12.5px] text-muted">&ldquo;{t.example}&rdquo;</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label">Answer length</legend>
              <div className="inline-flex rounded-lg bg-sunken p-0.5">
                {LENGTHS.map((l) => (
                  <label key={l.value} title={l.hint} className="cursor-pointer rounded-md px-3 py-1.5 text-[13px] text-muted has-[:checked]:bg-surface has-[:checked]:text-ink has-[:checked]:shadow-[var(--shadow-xs)]">
                    <input type="radio" name="assistantLength" value={l.value} defaultChecked={s.assistantLength === l.value} className="sr-only" />
                    {l.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-col gap-3">
              {[
                { name: "assistantOwnWords", on: s.assistantOwnWords, label: "Answer in its own words", hint: "Explain rather than copy articles word for word. Button and field names stay exact." },
                { name: "assistantScreenshots", on: s.assistantScreenshots, label: "Show screenshots in answers", hint: "When an article has a screenshot of the step, the answer includes it." },
                { name: "assistantEmoji", on: s.assistantEmoji, label: "Use emoji", hint: "An emoji now and then. Off keeps answers plain." },
              ].map((o) => (
                <label key={o.name} className="flex items-start gap-2.5 text-[13.5px]">
                  <input type="checkbox" name={o.name} defaultChecked={o.on} className="toggle mt-0.5" />
                  <span>
                    {o.label}
                    <span className="block text-[12.5px] text-muted">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </ActionPanel>
        </Section>

        <Section title="Instructions" description="Anything else the assistant should know or do. Answers still come only from your help center.">
          <ActionPanel action={savePanelAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="assistantInstructions" />
            <textarea
              name="assistantInstructions"
              aria-label="Instructions"
              rows={6}
              maxLength={4000}
              defaultValue={s.assistantInstructions}
              placeholder={"Call cases \"matters\" for customers on the Firm plan.\nWhen someone asks about pricing, point them to the Plans page."}
              className="field text-[13.5px] leading-relaxed"
            />
          </ActionPanel>
        </Section>

        <Section title="Off-limits topics" description="One per line. The assistant won't discuss these, and offers to connect the customer with your team instead.">
          <ActionPanel action={savePanelAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="assistantOffLimits" />
            <textarea
              name="assistantOffLimits"
              aria-label="Off-limits topics"
              rows={4}
              defaultValue={s.assistantOffLimits.join("\n")}
              placeholder={"Legal advice\nCompetitors\nUnreleased features"}
              className="field text-[13.5px] leading-relaxed"
            />
          </ActionPanel>
        </Section>

        <Section
          title="Handoff triggers"
          description="Up to 10, one per line. When a question matches one, the assistant stops and hands the customer to your team."
        >
          <ActionPanel action={savePanelAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="assistantHandoffTriggers" />
            <textarea
              name="assistantHandoffTriggers"
              aria-label="Handoff triggers"
              rows={4}
              defaultValue={s.assistantHandoffTriggers.join("\n")}
              placeholder={"The customer asks for a refund\nThe customer is upset or threatens to cancel\nThe customer reports losing data"}
              className="field text-[13.5px] leading-relaxed"
            />
            <div className="flex flex-col gap-2 text-[13px] text-graphite">
              <p>
                A handoff shows the customer your{" "}
                <Link href="/admin/help-center/customize" className="link">
                  contact link
                </Link>
                , sends the <code>conversation.escalation_requested</code>{" "}
                <Link href="/admin/settings/webhooks" className="link">
                  webhook
                </Link>
                , and, in the widget, fires an event on your page so your chat tool can open:
              </p>
              <CodeBlock
                label="On your site"
                value={`window.addEventListener("autodocs:escalationRequested", (e) => {\n  // e.detail.question, e.detail.conversation\n  Intercom("showNewMessage", e.detail.question);\n});`}
              />
            </div>
          </ActionPanel>
        </Section>
      </div>
    </>
  );
}
