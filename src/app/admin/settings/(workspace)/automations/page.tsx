import Link from "next/link";
import { connection } from "next/server";
import { formatDate } from "@/lib/format";
import { canResearch } from "@/lib/github";
import { getSettings } from "@/lib/settings";
import { PageHeader, Section } from "../../../secondary";
import { savePanelAction } from "../../../settings-actions";
import { ActionPanel } from "../../platform-forms";
import { managerGate } from "../../../managers-only";

const check = "mt-0.5 size-4 accent-[var(--accent)]";

export default async function AutomationsPage() {
  await connection();
  const gate = await managerGate("workspace settings");
  if (gate) return gate;
  const s = await getSettings();
  const code = canResearch(s.githubRepo);

  return (
    <>
      <PageHeader eyebrow="Docs Agent" title="Automations" description="What Docs Agent does on its own, without being asked." />
      {!code && (
        <p className="notice mb-8">
          Most automations read your code.{" "}
          <Link href="/admin/integrations/github" className="link">
            Connect GitHub
          </Link>{" "}
          to turn them on.
        </p>
      )}
      <div className="flex flex-col gap-6">
        <Section title="Merged pull requests" description="Docs Agent screens each merged PR and drafts article updates when customers would notice the change.">
          <ActionPanel action={savePanelAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="autoScreenPRs" />
            <input type="hidden" name="_saved" value="Pull request screening saved." />
            <label className="flex items-start gap-2.5">
              <input type="checkbox" name="autoScreenPRs" defaultChecked={s.autoScreenPRs} className={check} />
              <span>
                Draft updates from merged pull requests
                <span className="block text-[13px] text-muted">How picky Docs Agent is lives in Customize.</span>
              </span>
            </label>
          </ActionPanel>
        </Section>

        <Section title="Audits" description="Docs Agent reviews search gaps, feedback, and recent releases, then proposes fixes in a thread.">
          <ActionPanel action={savePanelAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="auditFrequency" />
            <input type="hidden" name="_saved" value="Audit schedule saved." />
            <div>
              <label className="label" htmlFor="au-freq">
                Run an audit
              </label>
              <select id="au-freq" name="auditFrequency" defaultValue={s.auditFrequency} className="field max-w-xs">
                <option value="off">Only when I start one</option>
                <option value="weekly">Every week</option>
                <option value="biweekly">Every two weeks</option>
                <option value="monthly">Every month</option>
              </select>
              {s.lastAuditAt && <p className="mt-1.5 text-[13px] text-muted">Last audit {formatDate(s.lastAuditAt)}.</p>}
            </div>
          </ActionPanel>
        </Section>

        <Section title="Continuous verification" description="Docs Agent re-checks published articles against your code, oldest check first.">
          <ActionPanel action={savePanelAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="continuousVerification,verifyPerDay" />
            <input type="hidden" name="_saved" value="Verification schedule saved." />
            <label className="flex items-start gap-2.5">
              <input type="checkbox" name="continuousVerification" defaultChecked={s.continuousVerification} className={check} />
              <span>
                Keep verifying in the background
                <span className="block text-[13px] text-muted">Articles that stop matching the product land in Verification.</span>
              </span>
            </label>
            <div>
              <label className="label" htmlFor="au-per-day">
                Articles to check per day
              </label>
              <input id="au-per-day" name="verifyPerDay" type="number" min={1} max={200} defaultValue={s.verifyPerDay} className="field num max-w-[8rem]" />
            </div>
          </ActionPanel>
        </Section>
      </div>
    </>
  );
}
