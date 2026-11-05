import Link from "next/link";
import { connection } from "next/server";
import { aiConfigured } from "@/lib/ai";
import { getInsights, hoursSaved } from "@/lib/analytics";
import { requireAdmin } from "@/lib/auth";
import { get } from "@/lib/db";
import { greeting } from "@/lib/format";
import { canResearch } from "@/lib/github";
import { getSettings } from "@/lib/settings";
import { Composer } from "./composer";

async function publishedLast30Days(): Promise<number> {
  return (
    (await get<{ n: number }>(
      "SELECT count(*) AS n FROM articles WHERE deleted_at IS NULL AND status = 'published' AND updated_at >= now() - interval '30 days'",
    ))?.n ?? 0
  );
}

// Job: a person is giving Docs Agent work, and next they review what it proposes in the thread.
export default async function AgentPage({ searchParams }: PageProps<"/admin/agent">) {
  await connection();
  const user = await requireAdmin();
  const params = await searchParams;
  const prompt = typeof params.prompt === "string" ? params.prompt : "";
  const settings = await getSettings();
  const ai = aiConfigured();
  const published = await publishedLast30Days();
  const hours = await hoursSaved();

  return (
    <div className="px-4 pt-12 pb-16 md:px-8 md:pt-28">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <h1 className="title">
          {greeting()}, {user.name.split(" ")[0]} <span aria-hidden>👋</span>
        </h1>
        <p className="mb-2 text-lg text-faint">
          Your team has published <strong className="font-medium text-ink">{published === 0 ? "no" : published}</strong>{" "}
          {published === 1 ? "article" : "articles"} and saved <strong className="num font-medium text-ink">{hours}</strong>{" "}
          {hours === 1 ? "hour" : "hours"} in the last 30 days.
        </p>

        {params.audit === "started" && (
          <p role="status" className="notice">
            Audit started. It shows up in the sidebar when Docs Agent finishes gathering signals.
          </p>
        )}
        {!ai && (
          <div className="notice notice-accent flex flex-wrap items-center justify-between gap-3">
            <span>Add an OpenAI API key on the server so Docs Agent can research and write.</span>
            <Link href="/admin/settings/ai" className="btn btn-primary btn-sm">
              Set up AI
            </Link>
          </div>
        )}

        <Composer
          disabled={!ai}
          initialPrompt={prompt}
          unanswered={(await getInsights()).unanswered.slice(0, 10).map((u) => u.text)}
          github={canResearch(settings.githubRepo) ? settings.githubRepo : ""}
          openai={ai}
        />
      </div>
    </div>
  );
}
