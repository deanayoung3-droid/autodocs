import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { listKeys } from "@/lib/apikeys";
import { timeAgo } from "@/lib/format";
import { createApiKeyAction, revokeApiKeyAction } from "../../../platform-actions";
import { PageHeader, Section } from "../../../secondary";
import { ActionPanel } from "../../platform-forms";
import { managerGate } from "../../../managers-only";

export default async function ApiSettingsPage() {
  await connection();
  const gate = await managerGate("workspace settings");
  if (gate) return gate;
  const h = await headers();
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, "") || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const keys = await listKeys();

  return (
    <>
      <PageHeader eyebrow="Developers" title="API" description="Read and search articles from your own code, or let AI tools draft changes." />
      <div className="flex flex-col gap-6">
        <Section title="API keys" description="Send a key as Authorization: Bearer cd_… with every request. Only owners can create keys.">
          <ActionPanel action={createApiKeyAction} submitLabel="Create key" className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label className="label" htmlFor="api-name">
                Name
              </label>
              <input id="api-name" name="name" placeholder="What will use it, e.g. Claude Code" className="field" />
            </div>
          </ActionPanel>
          {keys.length === 0 ? (
            <p className="mt-4 text-[13px] text-muted">No keys yet.</p>
          ) : (
            <ul className="card mt-4 divide-y divide-line">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{k.name}</span> <code className="text-muted">{k.prefix}…</code>
                  </span>
                  <span className="text-muted">{k.last_used_at ? `Used ${timeAgo(k.last_used_at)}` : "Never used"}</span>
                  <form action={revokeApiKeyAction}>
                    <input type="hidden" name="id" value={k.id} />
                    <button className="btn btn-quiet btn-danger h-7 px-2 text-[12px]">Revoke</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="REST API" description="JSON over HTTPS. Restricted articles are included, so treat keys like passwords.">
          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-line border-y border-line">
              {[
                ["GET", "/api/v1/articles", "Every article; add ?status=published or ?status=draft to filter"],
                ["GET", "/api/v1/articles/{id}", "One article with its Markdown body"],
                ["GET", "/api/v1/search?q=", "Full-text search, best match first; add &drafts=1 to include drafts"],
              ].map(([method, path, what]) => (
                <tr key={path}>
                  <td className="w-14 py-2 font-mono text-[12px] text-muted">{method}</td>
                  <td className="py-2 font-mono text-[12.5px]">
                    {origin}
                    {path}
                  </td>
                  <td className="hidden py-2 text-muted md:table-cell">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-[13px] text-muted">
            Connecting Claude, ChatGPT, Cursor, or Codex? See{" "}
            <Link href="/admin/mcp" className="link">
              MCP
            </Link>
            .
          </p>
        </Section>
      </div>
    </>
  );
}
