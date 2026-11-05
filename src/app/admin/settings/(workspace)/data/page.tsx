import { connection } from "next/server";
import type { ImportStatus } from "@/lib/importer";
import { getSettings } from "@/lib/settings";
import { AutoRefresh } from "../../../integrations/dashboard/auto-refresh";
import { importSiteAction } from "../../../platform-actions";
import { PageHeader, Section } from "../../../secondary";
import { ActionPanel } from "../../platform-forms";
import { managerGate } from "../../../managers-only";

export default async function DataSettingsPage() {
  await connection();
  const gate = await managerGate("workspace settings");
  if (gate) return gate;
  let imp: ImportStatus | null = null;
  try {
    const raw = (await getSettings()).lastImport;
    imp = raw ? (JSON.parse(raw) as ImportStatus) : null;
  } catch {
    imp = null;
  }

  return (
    <>
      <AutoRefresh active={imp?.status === "running"} />
      <PageHeader title="Import & export" description="Bring an existing help center in, or take everything with you." />
      <div className="flex flex-col gap-6">
        <Section
          title="Import a help center"
          description="Help centers that publish llms.txt import exactly: sections in order, each article's Markdown, images copied here, and old addresses redirected to the new pages. Other sites import from their sitemap. Importing again refreshes articles nobody has edited since."
        >
          <ActionPanel action={importSiteAction} submitLabel="Start import">
            <div>
              <label className="label" htmlFor="im-url">
                Help center address
              </label>
              <input id="im-url" name="url" placeholder="https://docs.example.com" className="field max-w-md" inputMode="url" />
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" name="publish" defaultChecked className="size-4 accent-[var(--accent)]" />
              Publish imported articles right away (otherwise they&rsquo;re drafts)
            </label>
          </ActionPanel>
          {imp && (
            <div className={`notice mt-4 ${imp.status === "failed" ? "notice-error" : ""}`}>
              <p className="flex items-center gap-2">
                {imp.status === "running" && <span className="working-dot" />}
                {imp.status === "running" ? "Importing" : imp.status === "done" ? "Last import finished" : "Last import failed"}
                {imp.source && <span className="truncate text-muted">· {imp.source}</span>}
              </p>
              <p className="num mt-1 text-[13px]">
                {imp.imported} new · {imp.updated ?? 0} refreshed · {imp.images ?? 0} images · {imp.skipped} skipped · {imp.total} total
              </p>
              {imp.errors.length > 0 && (
                <details className="mt-1 text-[13px]">
                  <summary className="cursor-pointer">
                    {imp.errors.length} {imp.errors.length === 1 ? "problem" : "problems"}
                  </summary>
                  <ul className="mt-1 list-disc pl-5">
                    {imp.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </Section>

        <Section title="Export" description="A copy of your help center you can keep or move elsewhere.">
          <div className="grid gap-4 text-[13px] sm:grid-cols-2">
            <div>
              <p className="mb-1.5 font-semibold">Included</p>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-graphite">
                <li>Every article, published and draft, as Markdown with its title and summary</li>
                <li>Sections and their order, in index.json</li>
                <li>Images and screenshots the articles use</li>
              </ul>
            </div>
            <div>
              <p className="mb-1.5 font-semibold">Not included</p>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-muted">
                <li>Docs Agent threads and drafts waiting for review</li>
                <li>Analytics, searches, and AI conversations</li>
                <li>Settings, the team, and integrations</li>
                <li>Revision history and translations</li>
              </ul>
            </div>
          </div>
          <a href="/api/admin/export" className="btn w-fit" download>
            Download export (.zip)
          </a>
        </Section>
      </div>
    </>
  );
}
