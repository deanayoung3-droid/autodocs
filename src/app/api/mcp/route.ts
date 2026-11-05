import { authenticateRequest } from "@/lib/apikeys";
import { publicOrigin } from "@/lib/integrations";
import { OAUTH_HEADERS, oauthUser } from "@/lib/oauth";
import { PRODUCT_NAME } from "@/lib/product";
import { collectionTree, flattenTree, getArticle, getArticleBySlug, getCollectionBySlug } from "@/lib/articles";
import { HIT_END, HIT_START } from "@/lib/format";
import { addProposal, createThread, finishThread } from "@/lib/proposals";
import { hybridSearch } from "@/lib/search";

// A minimal MCP server over Streamable HTTP (JSON responses, no streaming). Signs in with an API key,
// or with OAuth for clients like Claude on the web and ChatGPT (see lib/oauth.ts).
// Writes never publish: drafts and edits land in Review as proposals.

const TOOLS = [
  {
    name: "search_articles",
    description: "Full-text search over the help center, drafts included.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "get_article",
    description: "Get an article's Markdown by id or slug.",
    inputSchema: { type: "object", properties: { id: { type: "integer" }, slug: { type: "string" } } },
  },
  { name: "list_sections", description: "List help center sections.", inputSchema: { type: "object", properties: {} } },
  {
    name: "draft_article",
    description: "Propose a new article. It waits in Review until a teammate approves it.",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, summary: { type: "string" }, body_markdown: { type: "string" }, section: { type: "string" }, reason: { type: "string" } },
      required: ["title", "body_markdown"],
    },
  },
  {
    name: "propose_edit",
    description: "Propose a new full body for an existing article. It waits in Review until approved.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer" }, body_markdown: { type: "string" }, reason: { type: "string" } },
      required: ["id", "body_markdown"],
    },
  },
];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], isError });

async function callTool(name: string, a: Record<string, unknown>) {
  switch (name) {
    case "search_articles": {
      const hits = await hybridSearch(String(a.query ?? ""), { publishedOnly: false, includeRestricted: true, limit: 10 });
      return text(
        hits.length
          ? hits.map((h) => `${h.id} · ${h.slug} · ${h.title} (${h.status})\n  ${h.snippet.replaceAll(HIT_START, "").replaceAll(HIT_END, "")}`).join("\n")
          : "No matches.",
      );
    }
    case "get_article": {
      const art = a.id ? await getArticle(Number(a.id)) : await getArticleBySlug(String(a.slug ?? ""));
      return art && !art.deleted_at ? text(`# ${art.title}\n\n${art.body}`) : text("Article not found.", true);
    }
    case "list_sections":
      return text(flattenTree(await collectionTree()).map((c) => `${"  ".repeat(c.depth)}${c.slug}: ${c.name} (${c.total})`).join("\n") || "No sections.");
    case "draft_article":
    case "propose_edit": {
      const target = name === "propose_edit" ? await getArticle(Number(a.id)) : undefined;
      if (name === "propose_edit" && !target) return text("Article not found.", true);
      const title = target?.title ?? String(a.title ?? "Untitled");
      const runId = await createThread({ kind: "task", title: `${target ? "Edit" : "New"}: ${title} (via MCP)`, prompt: String(a.reason ?? "From an AI tool over MCP."), status: "done" });
      const pid = await addProposal({
        runId,
        action: target ? "update" : "create",
        articleId: target?.id ?? null,
        collectionId: target ? target.collection_id : a.section ? ((await getCollectionBySlug(String(a.section)))?.id ?? null) : null,
        title,
        summary: target?.summary ?? String(a.summary ?? ""),
        body: String(a.body_markdown ?? ""),
        baseBody: target?.body ?? null,
        reason: String(a.reason ?? "Proposed from an AI tool over MCP."),
      });
      await finishThread(runId, { summary: "Proposed from an AI tool over MCP.", confidence: null });
      return text(`Proposal ${pid} is waiting in Review.`);
    }
    default:
      return text(`Unknown tool ${name}.`, true);
  }
}

async function handle(msg: Rpc) {
  switch (msg.method) {
    case "initialize":
      return {
        protocolVersion: (msg.params?.protocolVersion as string) ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: PRODUCT_NAME.toLowerCase(), version: "1.0.0" },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return callTool(String(msg.params?.name), (msg.params?.arguments as Record<string, unknown>) ?? {});
    default:
      return undefined;
  }
}

const CORS = { ...OAUTH_HEADERS, "Access-Control-Expose-Headers": "WWW-Authenticate" };

export async function POST(req: Request) {
  if (!(await authenticateRequest(req)) && !(await oauthUser(req))) {
    // Tells OAuth clients where to sign in (RFC 9728); API-key clients just read the message.
    const metadata = `${publicOrigin(new URL(req.url).origin)}/.well-known/oauth-protected-resource`;
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: sign in with OAuth, or send an API key as a bearer token." } },
      { status: 401, headers: { ...CORS, "WWW-Authenticate": `Bearer resource_metadata="${metadata}"` } },
    );
  }
  let payload: Rpc | Rpc[];
  try {
    payload = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS });
  }
  const one = async (m: Rpc) => {
    if (m.id === undefined) return null; // notification
    const result = await handle(m);
    return result === undefined
      ? { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } }
      : { jsonrpc: "2.0", id: m.id, result };
  };
  if (Array.isArray(payload)) {
    const out = (await Promise.all(payload.map(one))).filter(Boolean);
    return out.length ? Response.json(out, { headers: CORS }) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await one(payload);
  return out ? Response.json(out, { headers: CORS }) : new Response(null, { status: 202, headers: CORS });
}

export async function GET() {
  return new Response("This MCP server doesn't stream; use POST.", { status: 405, headers: { Allow: "POST", ...CORS } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
