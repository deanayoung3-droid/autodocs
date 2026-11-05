import { connection } from "next/server";
import { IconLanguage } from "@/components/icons";
import { aiConfigured } from "@/lib/ai";
import { getSettings } from "@/lib/settings";
import { LANGUAGES, translationProgress } from "@/lib/translations";
import { translateNowAction } from "../../platform-actions";
import { PageBar, PageHeader, Section } from "../../secondary";
import { savePanelAction } from "../../settings-actions";
import { ActionPanel } from "../../settings/platform-forms";
import { SubmitButton } from "../../ui";
import { managerGate } from "../../managers-only";

export default async function TranslatePage({ searchParams }: PageProps<"/admin/help-center/translate">) {
  await connection();
  const gate = await managerGate("translations");
  if (gate) return gate;
  const sp = await searchParams;
  const s = await getSettings();
  const progress = await translationProgress();

  return (
    <div>
      <PageBar>
        <IconLanguage size={14} /> <span className="font-medium text-graphite">Translate</span>
      </PageBar>
      <div className="mx-auto max-w-[760px] px-4 py-10 md:px-8">
        <PageHeader
          eyebrow="Help Center"
          title="Translate"
          description="Docs Agent translates every published article and keeps translations in step when you edit."
          actions={
            progress.length > 0 && (
              <form action={translateNowAction}>
                <SubmitButton className="btn" disabled={!aiConfigured()} pendingLabel="Starting…">
                  Translate now
                </SubmitButton>
              </form>
            )
          }
        />
        {sp.translating && (
          <p role="status" className="notice mb-6">
            Translating in the background. Refresh in a minute to see progress.
          </p>
        )}
        <div className="flex flex-col gap-10">
          <Section title="Languages" description="Readers pick a language from the switcher in the help center header.">
            <ActionPanel action={savePanelAction} submitLabel="Save languages">
              <input type="hidden" name="_fields" value="languages" />
              <input type="hidden" name="_saved" value="Languages saved. New ones translate within a few minutes." />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(LANGUAGES).map(([code, name]) => (
                  <label
                    key={code}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] transition-colors has-[:checked]:border-accent-line has-[:checked]:bg-accent-soft"
                  >
                    <input type="checkbox" name="languages" value={code} defaultChecked={s.languages.includes(code)} className="size-4 accent-[var(--accent)]" />
                    {name}
                  </label>
                ))}
              </div>
            </ActionPanel>
          </Section>

          {progress.length > 0 && (
            <Section title="Progress">
              <ul className="flex flex-col gap-3">
                {progress.map((p) => (
                  <li key={p.lang} className="flex items-center gap-3 text-[13px]">
                    <span className="w-24">{LANGUAGES[p.lang]}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
                      <span
                        className="block h-full rounded-full bg-accent transition-[width] duration-500"
                        style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }}
                      />
                    </span>
                    <span className="num w-16 text-right text-muted">
                      {p.done}/{p.total}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
