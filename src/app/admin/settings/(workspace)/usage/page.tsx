import Link from "next/link";
import { connection } from "next/server";
import { all, get } from "@/lib/db";
import { usd } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { LANGUAGES } from "@/lib/translations";
import { PageHeader, Section } from "../../../secondary";
import { managerGate } from "../../../managers-only";

const PURPOSE: Record<string, string> = {
  agent: "Docs Agent tasks",
  answer: "Customer answers",
  verify: "Verification",
  capture: "Screenshots",
  translate: "Translation",
  classify: "Sorting and review",
  embed: "Search index",
};

// Job: an owner is checking how much the workspace uses (people, content, AI spend); next they adjust a setting or the team.
export default async function UsagePage() {
  await connection();
  const gate = await managerGate("workspace settings");
  if (gate) return gate;
  const [s, people, content, month, byPurpose] = await Promise.all([
    getSettings(),
    get<{ total: number; owners: number; admins: number; contributors: number }>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE role = 'owner') AS owners, count(*) FILTER (WHERE role = 'admin') AS admins,
              count(*) FILTER (WHERE role = 'contributor') AS contributors FROM users`,
    ),
    get<{ published: number; drafts: number; shots: number }>(
      `SELECT count(*) FILTER (WHERE status = 'published') AS published, count(*) FILTER (WHERE status <> 'published') AS drafts,
              (SELECT count(*) FROM screenshots) AS shots
       FROM articles WHERE deleted_at IS NULL`,
    ),
    get<{ answers: number; threads: number }>(
      `SELECT (SELECT count(*) FROM ai_conversations WHERE created_at >= date_trunc('month', now())) AS answers,
              (SELECT count(*) FROM agent_runs WHERE created_at >= date_trunc('month', now())) AS threads`,
    ),
    all<{ purpose: string; requests: number; cost: number }>(
      `SELECT purpose, count(*) AS requests, coalesce(sum(cost_usd), 0) AS cost FROM ai_usage
       WHERE created_at >= date_trunc('month', now()) GROUP BY purpose ORDER BY cost DESC`,
    ),
  ]);
  const total = byPurpose.reduce((n, r) => n + Number(r.cost), 0);
  const stat = (label: string, value: string | number, note?: string) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12.5px] text-muted">{label}</span>
      <span className="num text-[22px] font-semibold tracking-tight">{value}</span>
      {note && <span className="text-[12px] text-muted">{note}</span>}
    </div>
  );
  return (
    <>
      <PageHeader title="Usage" description="Your team, your content, and what AI cost this month." />
      <div className="flex flex-col gap-6">
        <Section title="Team">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            {stat("Seats", (people?.total ?? 0) + 1, "Including the built-in owner")}
            {stat("Admins and owners", (people?.owners ?? 0) + (people?.admins ?? 0) + 1)}
            {stat("Contributors", people?.contributors ?? 0)}
          </div>
          <p className="text-[13px]">
            <Link href="/admin/settings/team" className="link">
              Manage the team
            </Link>
          </p>
        </Section>
        <Section title="Help center">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            {stat("Published articles", content?.published ?? 0)}
            {stat("Drafts", content?.drafts ?? 0)}
            {stat("Screenshots", content?.shots ?? 0)}
            {stat("Languages", s.languages.length + 1, ["English", ...s.languages.map((l) => LANGUAGES[l] ?? l)].join(", "))}
            {stat("AI answers this month", month?.answers ?? 0)}
            {stat("Docs Agent tasks this month", month?.threads ?? 0)}
          </div>
        </Section>
        <Section title="AI this month" description="What the OpenAI API cost so far this month, by what it was used for. Your OpenAI bill is the source of truth.">
          {byPurpose.length ? (
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-line border-y border-line">
                {byPurpose.map((r) => (
                  <tr key={r.purpose}>
                    <td className="py-2">{PURPOSE[r.purpose] ?? r.purpose}</td>
                    <td className="num py-2 text-right text-muted">{Number(r.requests).toLocaleString()} requests</td>
                    <td className="num w-24 py-2 text-right">{usd(Number(r.cost))}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2 font-semibold">Total</td>
                  <td />
                  <td className="num py-2 text-right font-semibold">{usd(total)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="text-[13px] text-muted">No AI use yet this month.</p>
          )}
        </Section>
      </div>
    </>
  );
}
