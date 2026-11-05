import Link from "next/link";
import { connection } from "next/server";
import { getSettings } from "@/lib/settings";
import { PageHeader, Section } from "../../../secondary";
import { regenerateAboutAction, savePanelAction } from "../../../settings-actions";
import { ActionPanel } from "../../platform-forms";
import { managerGate } from "../../../managers-only";

// Job: an owner is telling Docs Agent about the company so drafts and answers use the right words; next they save or regenerate it.
export default async function AboutYouPage() {
  await connection();
  const gate = await managerGate("workspace settings");
  if (gate) return gate;
  const s = await getSettings();
  return (
    <>
      <PageHeader eyebrow="Docs Agent" title="About you" description="What Docs Agent remembers about your company. It reads this before drafting articles and answering customers." />
      <div className="flex flex-col gap-6">
        <Section title="Your company" description="What the product is, who uses it, and what you call things. A few short paragraphs is plenty.">
          <ActionPanel action={savePanelAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="aboutCompany" />
            <textarea
              key={`${s.aboutCompany.length}:${s.aboutCompany.slice(0, 40)}`}
              name="aboutCompany"
              aria-label="About your company"
              rows={10}
              maxLength={6000}
              defaultValue={s.aboutCompany}
              placeholder={`${s.brandName} is invoicing software for small agencies. Founders and account managers use it to…`}
              className="field text-[13.5px] leading-relaxed"
            />
          </ActionPanel>
        </Section>
        <Section
          title="Regenerate with AI"
          description={
            s.websiteUrl ? (
              <>
                Docs Agent reads <span className="font-mono">{s.websiteUrl}</span> and rewrites the text above. It replaces what&rsquo;s there.
              </>
            ) : (
              <>
                Add your website in{" "}
                <Link href="/admin/settings" className="link">
                  General
                </Link>{" "}
                and Docs Agent can write this for you.
              </>
            )
          }
        >
          {s.websiteUrl && (
            <ActionPanel action={regenerateAboutAction} submitLabel="Regenerate" className="flex flex-col gap-3">
              <span />
            </ActionPanel>
          )}
        </Section>
      </div>
    </>
  );
}
