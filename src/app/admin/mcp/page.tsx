import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { IconChat, IconCode, IconKey, IconMcp, IconOpenAI } from "@/components/icons";
import { listKeys } from "@/lib/apikeys";
import { requireAdmin } from "@/lib/auth";
import { connectedApps } from "@/lib/oauth";
import { disconnectAppAction } from "../platform-actions";
import { SubmitButton } from "../ui";
import { timeAgo } from "@/lib/format";
import { PageHeader } from "../secondary";
import { CodeBlock } from "../settings/platform-forms";
import { subRow } from "../styles";
import { PRODUCT_NAME } from "@/lib/product";

type Client = { id: string; label: string; icon: ReactNode; title: string; steps: ReactNode[]; snippet?: string; note?: ReactNode };

const TOOLS = ["search_articles", "get_article", "list_sections", "draft_article", "propose_edit"];

// The AI clients people use most. Claude and ChatGPT sign in with
// OAuth (the consent page at /oauth/authorize); the rest send an API key.
function clients(url: string): Client[] {
  const reachable =
    "The app connects from the internet, so this works once the workspace runs at a public address (it does after deploying). Each person who connects approves it as themselves.";
  return [
    {
      id: "claude",
      label: "Claude",
      icon: <IconChat size={15} />,
      title: "Connect Claude",
      steps: [
        "In Claude on the web or the desktop app, open Settings → Connectors and choose Add custom connector.",
        `Name it ${PRODUCT_NAME} and paste the server URL below. Leave the advanced OAuth fields empty.`,
        "Claude opens a sign-in page from this workspace. Choose Allow, and the docs tools show up in your chats.",
      ],
      note: reachable,
    },
    {
      id: "claude-code",
      label: "Claude Code",
      icon: <IconCode size={15} />,
      title: "Connect Claude Code",
      steps: ["Run this in your terminal.", "In Claude Code, run /mcp and choose Authenticate. A browser tab opens here; choose Allow."],
      snippet: `claude mcp add --transport http ${PRODUCT_NAME.toLowerCase()} ${url}`,
      note: "On a machine without a browser, create an API key below instead and add --header \"Authorization: Bearer YOUR_KEY\" to the command.",
    },
    {
      id: "chatgpt",
      label: "ChatGPT",
      icon: <IconOpenAI size={15} />,
      title: "Connect ChatGPT",
      steps: [
        "In ChatGPT, open Settings → Apps & Connectors → Advanced settings and turn on Developer mode.",
        `Back in Apps & Connectors, choose Create, name it ${PRODUCT_NAME}, paste the server URL below, and choose OAuth for authentication.`,
        "ChatGPT opens a sign-in page from this workspace. Choose Allow.",
      ],
      note: reachable,
    },
    {
      id: "cursor",
      label: "Cursor",
      icon: <IconCode size={15} />,
      title: "Connect Cursor",
      steps: ["Create an API key below.", "Add this to ~/.cursor/mcp.json (or .cursor/mcp.json in a project), then restart Cursor."],
      snippet: JSON.stringify({ mcpServers: { [PRODUCT_NAME.toLowerCase()]: { url, headers: { Authorization: "Bearer YOUR_KEY" } } } }, null, 2),
    },
    {
      id: "codex",
      label: "Codex CLI",
      icon: <IconOpenAI size={15} />,
      title: "Connect Codex CLI",
      steps: ["Create an API key below and export it in your shell as AUTODOCS_KEY.", "Add this to ~/.codex/config.toml."],
      snippet: `[mcp_servers.${PRODUCT_NAME.toLowerCase()}]\nurl = "${url}"\nbearer_token_env_var = "AUTODOCS_KEY"`,
    },
    {
      id: "other",
      label: "Other MCP clients",
      icon: <IconMcp size={15} />,
      title: "Any MCP client",
      steps: [
        "Add a remote server using Streamable HTTP at the URL below.",
        "Clients that support MCP's OAuth sign-in connect on their own. Others send an API key as the bearer token: Authorization: Bearer YOUR_KEY.",
      ],
    },
  ];
}

// Job: a person is connecting their AI tool to the docs, and next they copy its setup and create a key.
export default async function McpPage({ searchParams }: PageProps<"/admin/mcp">) {
  await connection();
  const sp = await searchParams;
  const h = await headers();
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, "") || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const url = `${origin}/api/mcp`;
  const list = clients(url);
  const current = list.find((c) => c.id === sp.client) ?? list[0];
  const [keys, user] = await Promise.all([listKeys(), requireAdmin()]);
  const apps = await connectedApps(user.id);

  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-10 pb-16 md:px-8 md:pt-16">
      <PageHeader
        title={`Use ${PRODUCT_NAME} from your AI tools`}
        description="Search, read, and draft articles from Claude, ChatGPT, Cursor, or Codex. Drafts and edits wait in Review, like Docs Agent's."
      />

      <div className="grid gap-12 md:grid-cols-[184px_1fr]">
        <nav aria-label="Clients" className="min-w-0">
          <p className="kicker px-3 pt-2 pb-1.5">Clients</p>
          <ul className="flex gap-0.5 overflow-x-auto md:flex-col">
            {list.map((c) => (
              <li key={c.id} className="shrink-0">
                <Link
                  href={`/admin/mcp?client=${c.id}`}
                  aria-current={c.id === current.id ? "page" : undefined}
                  className={subRow(c.id === current.id)}
                >
                  <span className="flex text-faint">{c.icon}</span>
                  {c.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div key={current.id} className="fade-in min-w-0">
          <h2 className="text-xl font-semibold tracking-[-0.01em] text-ink">{current.title}</h2>
          <ol className="mt-5 flex flex-col">
            {current.steps.map((s, i) => (
              <li key={i} className="relative flex gap-3 pb-4 text-sm text-graphite last:pb-0">
                {i < current.steps.length - 1 && <span className="absolute top-6 bottom-1 left-[9.5px] w-px bg-line" aria-hidden />}
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface text-[11px] font-medium text-muted">
                  {i + 1}
                </span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-col gap-3">
            {current.snippet && <CodeBlock label="Command" value={current.snippet} />}
            <CodeBlock label="Server URL" value={url} />
          </div>
          {current.note && <p className="notice mt-4">{current.note}</p>}
          <p className="mt-4 text-[13px] text-muted">
            Tools: {TOOLS.map((t, i) => (
              <span key={t}>
                <code>{t}</code>
                {i < TOOLS.length - 1 ? ", " : ""}
              </span>
            ))}
          </p>
        </div>
      </div>

      <section className="mt-12 border-t border-line pt-10 md:ml-[232px]" aria-labelledby="clients">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 id="clients" className="text-xl font-semibold tracking-[-0.01em] text-ink">
              Connected clients
            </h2>
            <p className="mt-0.5 text-sm text-muted">Apps you allowed with OAuth, and the API keys other tools use. Disconnect or revoke one without touching the others.</p>
          </div>
          <Link href="/admin/settings/api" className="btn btn-sm">
            <IconKey size={13} /> Manage keys
          </Link>
        </div>
        {apps.length > 0 && (
          <ul className="card mb-3 divide-y divide-line">
            {apps.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <IconMcp size={14} className="text-faint" />
                <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                <span className="text-muted">Signed in as you</span>
                <span className="w-32 text-right text-muted">{a.last_used_at ? `Used ${timeAgo(a.last_used_at)}` : "Never used"}</span>
                <form action={disconnectAppAction.bind(null, a.id)}>
                  <SubmitButton className="btn btn-sm" pendingLabel="Disconnecting…">
                    Disconnect
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        {keys.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-6 py-8 text-center text-[13px] text-muted">
            No API keys yet. Tools that don&rsquo;t sign in with OAuth need one: create it in Settings → API, then paste it into the tool.
          </p>
        ) : (
          <ul className="card divide-y divide-line">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <IconKey size={14} className="text-faint" />
                <span className="min-w-0 flex-1 truncate font-medium">{k.name}</span>
                <code className="text-muted">{k.prefix}…</code>
                <span className="w-32 text-right text-muted">{k.last_used_at ? `Used ${timeAgo(k.last_used_at)}` : "Never used"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
