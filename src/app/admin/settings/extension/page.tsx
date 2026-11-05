import { connection } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listExtensionTokens } from "@/lib/extension";
import { timeAgo } from "@/lib/format";
import { PageHeader, Section } from "../../secondary";
import { disconnectExtensionAction } from "../../settings-actions";
import { SubmitButton } from "../../ui";
import { ConnectExtension } from "./connect";

// Job: a person is putting Docs Agent in their browser so they can answer customers from the
// docs; next they type !! in a reply box.
export default async function ExtensionPage({ searchParams }: PageProps<"/admin/settings/extension">) {
  await connection();
  const user = await requireAdmin();
  const sp = await searchParams;
  const tokens = await listExtensionTokens(user.id);

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Chrome extension"
        description="Docs Agent in any tab: answer customers from your docs, search articles, draft replies, and hand off docs tasks."
      />
      <Section title="Install" description="The extension is built for this workspace, so it isn't in the Chrome Web Store. It takes a minute to add.">
        <ol className="flex flex-col gap-3 text-[13.5px]">
          <li className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="num font-semibold">1</span>
            <a href="/api/extension/download" className="btn btn-sm" download>
              Download the extension
            </a>
            and unzip it.
          </li>
          <li>
            <span className="num mr-2 font-semibold">2</span>
            Open <code>chrome://extensions</code> and turn on <strong>Developer mode</strong> in the top right.
          </li>
          <li>
            <span className="num mr-2 font-semibold">3</span>
            Click <strong>Load unpacked</strong> and choose the unzipped folder. Pin it from the puzzle-piece menu so it&rsquo;s one click away.
          </li>
          <li>
            <span className="num mr-2 font-semibold">4</span>
            Reload this page and connect it below.
          </li>
        </ol>
      </Section>

      <Section title="Connect this browser" description="Signs the extension in as you. Each browser gets its own sign-in, which you can remove below.">
        <ConnectExtension autoConnect={sp.connect === "1"} />
      </Section>

      <Section title="Signed-in browsers">
        {tokens.length ? (
          <ul className="-my-2 divide-y divide-line">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">{t.name}</p>
                  <p className="text-[12.5px] text-muted">
                    Connected {timeAgo(t.created_at)}
                    {t.last_used_at ? ` · last used ${timeAgo(t.last_used_at)}` : " · not used yet"}
                  </p>
                </div>
                <form action={disconnectExtensionAction.bind(null, t.id)}>
                  <SubmitButton className="btn btn-sm" pendingLabel="Signing out…">
                    Sign out
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">No browsers yet. Connect one above.</p>
        )}
      </Section>

      <Section title="Using it">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-[13.5px] text-graphite">
          <li>
            <strong>Alt+F</strong> (<strong>⌥F</strong> on a Mac) or the toolbar button opens the side panel: chat with Docs Agent about your docs, search
            articles, and follow the tasks you started.
          </li>
          <li>
            Type <strong>!!</strong> in any reply box to search the help center, insert a link or a short answer, or draft a reply from the conversation on the
            page.
          </li>
          <li>Right-click selected text to ask Docs Agent about it, or right-click a reply box to draft a reply.</li>
          <li>Describe a docs change in the chat and choose &ldquo;Make it a docs task&rdquo;. Drafts wait for review here; nothing is published on its own.</li>
          <li>The panel&rsquo;s settings hold your reply drafting instructions and the sites where !! stays off.</li>
        </ul>
      </Section>
    </>
  );
}
