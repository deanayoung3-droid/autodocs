import "server-only";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import {
  AIError,
  assertNotRefused,
  callModel,
  type Effort,
  type FunctionTool,
  type Purpose,
  type ResponseInputItem,
} from "./ai";
import { getArticle } from "./articles";
import { listDirectory, listMergedPullRequests, readFile, researchRepos, searchCode } from "./github";
import { hybridSearch } from "./search";
import { getSettings } from "./settings";

export type FinalTool = { name: string; description: string; input_schema: Record<string, unknown> };

/** A tool a caller adds to the loop (screenshots, for instance). Returns text for the model. */
export type ExtraTool = { tool: FunctionTool; run: (input: Record<string, unknown>) => Promise<string> };

export type StepFn = (label: string) => Promise<void> | void;

export function tool(name: string, description: string, properties: Record<string, unknown>): FunctionTool {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
  };
}

const ARTICLE_TOOLS: FunctionTool[] = [
  tool(
    "search_articles",
    "Search every help center article, drafts included, by meaning and keywords. Returns ids, titles, and the matching passage.",
    { query: { type: "string" } },
  ),
  tool("read_article", "Read one article's title, summary, and full Markdown body.", { id: { type: "integer" } }),
];

const REPO = { type: "string", description: "owner/name of the repository. Empty for the first one listed." };

const CODE_TOOLS: FunctionTool[] = [
  tool("search_code", "Search the product's source code on GitHub. Use specific identifiers, UI labels, or error strings.", {
    query: { type: "string" },
    repo: REPO,
  }),
  tool("read_file", "Read a source file from a repository by path.", { path: { type: "string" }, repo: REPO }),
  tool("list_directory", "List files in a repository directory. Use an empty string for the root.", {
    path: { type: "string" },
    repo: REPO,
  }),
  tool("list_merged_pull_requests", "List pull requests merged in the last N days, with titles and descriptions.", {
    days: { type: "integer" },
    repo: REPO,
  }),
];

async function runTool(name: string, input: Record<string, unknown>, repos: string[], step: StepFn): Promise<string> {
  const wanted = String(input.repo ?? "");
  const repo = repos.find((r) => r.toLowerCase() === wanted.toLowerCase()) ?? repos[0] ?? "";
  switch (name) {
    case "search_articles": {
      const q = String(input.query ?? "");
      await step(`Searched articles for “${q}”`);
      const hits = await hybridSearch(q, { publishedOnly: false, includeRestricted: true, limit: 8 });
      return hits.length
        ? hits.map((h) => `${h.id} · ${h.title} (${h.status}) — ${h.snippet.replace(/[\u0001\u0002]/g, "")}`).join("\n")
        : "No matching articles.";
    }
    case "read_article": {
      const a = await getArticle(Number(input.id));
      if (!a || a.deleted_at) return `No article with id ${input.id}.`;
      await step(`Read article “${a.title}”`);
      return `# ${a.title}\nSlug: /help/${a.slug}\nStatus: ${a.status}\nSummary: ${a.summary}\n\n${a.body}`;
    }
    case "search_code":
      await step(`Searched code for “${input.query}”`);
      return searchCode(repo, String(input.query ?? ""));
    case "read_file":
      await step(`Read ${input.path}`);
      return readFile(repo, String(input.path ?? ""));
    case "list_directory":
      await step(`Listed ${input.path || "the repository root"}`);
      return listDirectory(repo, String(input.path ?? ""));
    case "list_merged_pull_requests": {
      const days = Math.min(Math.max(Number(input.days) || 14, 1), 90);
      await step(`Listed pull requests merged in the last ${days} days`);
      const prs = await listMergedPullRequests(repo, new Date(Date.now() - days * 86_400_000));
      return prs.length
        ? prs.map((p) => `#${p.number} ${p.title} (merged ${p.merged_at.slice(0, 10)} by ${p.author})\n${p.body}`).join("\n\n")
        : `No pull requests merged in the last ${days} days.`;
    }
    default:
      return `Unknown tool ${name}.`;
  }
}

/**
 * Agent loop: the model researches with the tools above, then ends by calling the final
 * tool with its structured result. Returns that tool's arguments.
 */
export async function research<T>(opts: {
  purpose: Purpose;
  system: string;
  prompt: string;
  final: FinalTool;
  effort?: Effort;
  maxTurns?: number;
  onStep?: StepFn;
  tools?: ExtraTool[];
}): Promise<T> {
  const repos = await researchRepos();
  const codeAvailable = repos.length > 0;
  const finalTool: FunctionTool = {
    type: "function",
    name: opts.final.name,
    description: opts.final.description,
    parameters: opts.final.input_schema,
    strict: true,
  };
  const extra = opts.tools ?? [];
  const tools = [...ARTICLE_TOOLS, ...(codeAvailable ? CODE_TOOLS : []), ...extra.map((t) => t.tool), finalTool];
  const step: StepFn = opts.onStep ?? (() => {});
  const maxTurns = opts.maxTurns ?? 14;

  const guidance = (await getSettings()).researchGuidance.trim();
  const instructions = `${opts.system}

Research before you answer, but keep it focused: a handful of searches and reads is usually enough.${guidance ? `\nHow the team wants you to research:\n${guidance}\n` : ""}${
    codeAvailable
      ? ` You can read the product's code in ${repos.join(", ")}; check behavior there rather than guessing.`
      : " The codebase isn't connected, so work from the articles and the material provided."
  }
When you're done, call ${opts.final.name} exactly once with your result. Don't write the result as plain text.`;

  // Responses aren't stored on OpenAI's side, so each request carries the whole conversation.
  const input: ResponseInputItem[] = [{ role: "user", content: opts.prompt }];
  let nudges = 0;

  for (let turn = 0; turn <= maxTurns; turn++) {
    const last = turn === maxTurns;
    if (last) input.push({ role: "user", content: `You're out of research steps. Call ${opts.final.name} now with your best result.` });
    const res = await callModel(opts.purpose, {
      instructions,
      input,
      tools,
      toolChoice: last ? { type: "function", name: opts.final.name } : "auto",
      effort: opts.effort ?? "medium",
    });
    assertNotRefused(res);

    const calls: ResponseFunctionToolCall[] = [];
    for (const item of res.output) {
      if (item.type === "function_call") {
        calls.push(item);
        input.push({ type: "function_call", call_id: item.call_id, name: item.name, arguments: item.arguments });
      } else if (item.type === "message") {
        const text = item.content.map((c) => (c.type === "output_text" ? c.text : "")).join("");
        if (text) input.push({ role: "assistant", content: text });
      }
    }

    const final = calls.find((c) => c.name === opts.final.name);
    if (final) {
      try {
        return JSON.parse(final.arguments) as T;
      } catch {
        throw new AIError("Docs Agent's result couldn't be read. Try again.");
      }
    }

    if (calls.length === 0) {
      if (++nudges > 2) break;
      input.push({ role: "user", content: `Call ${opts.final.name} with your result.` });
      continue;
    }

    // Article and code lookups run together; caller tools (like the browser) run one at a time.
    const outputs: ResponseInputItem[] = [];
    const runOne = async (c: ResponseFunctionToolCall): Promise<ResponseInputItem> => {
      let output: string;
      try {
        const args = JSON.parse(c.arguments) as Record<string, unknown>;
        const own = extra.find((t) => t.tool.name === c.name);
        output = own ? await own.run(args) : await runTool(c.name, args, repos, step);
      } catch (err) {
        output = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      return { type: "function_call_output", call_id: c.call_id, output };
    };
    const builtIn = calls.filter((c) => !extra.some((t) => t.tool.name === c.name));
    outputs.push(...(await Promise.all(builtIn.map(runOne))));
    for (const c of calls.filter((c) => extra.some((t) => t.tool.name === c.name))) outputs.push(await runOne(c));
    input.push(...outputs);
  }
  throw new AIError("Docs Agent stopped without producing a result. Try again with a narrower request.");
}
