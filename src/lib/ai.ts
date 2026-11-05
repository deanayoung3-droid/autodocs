import "server-only";
import OpenAI from "openai";
import type {
  FunctionTool,
  Response as ModelResponse,
  ResponseFormatTextJSONSchemaConfig,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import { get, run } from "./db";
import { getSettings } from "./settings";

// Every AI feature runs on the OpenAI API with OPENAI_API_KEY, through the Responses API.
// Each job uses the model that suits it; Settings → AI can override the team and answer models.

export type Purpose = "answer" | "agent" | "verify" | "translate" | "classify" | "triage" | "capture" | "embed";
export type Effort = "low" | "medium" | "high";
export type { FunctionTool, ModelResponse, ResponseInputItem };

export class AIError extends Error {}

export const AI_SETUP_HINT = "Add an OpenAI API key (OPENAI_API_KEY) on the server to use Docs Agent.";

/** Defaults per job. Environment variables override them for the whole server. */
export const DEFAULT_MODELS = {
  team: process.env.OPENAI_MODEL || "gpt-6.1-sol",
  answer: process.env.OPENAI_ANSWER_MODEL || "gpt-6.1-terra",
  light: process.env.OPENAI_LIGHT_MODEL || "gpt-6-luna",
  embedding: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
};

/** Models offered in Settings → AI, best first. */
export const MODEL_CHOICES = [
  { id: "gpt-6-astra", name: "GPT-6 Astra", note: "Most capable, about 5× Sol's price" },
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", note: "Balanced; the default for Docs Agent" },
  { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", note: "Fast; the default for customer answers" },
  { id: "gpt-6-luna", name: "GPT-6 Luna", note: "Cheapest, for simple jobs" },
];

/**
 * USD per million tokens: input, cached input, output. Standard tier, from OpenAI's pricing page
 * (developers.openai.com/api/docs/pricing) in November 2026. Update when prices change.
 */
const PRICES: Record<string, [number, number, number]> = {
  "gpt-6-astra": [10, 1, 50],
  "gpt-6.1-sol": [2, 0.1, 10],
  "gpt-6-sol": [2, 0.2, 10],
  "gpt-6.1-terra": [1, 0.05, 5],
  "gpt-6-luna": [0.1, 0.01, 0.5],
  "gpt-5.6-sol": [4, 0.4, 20],
  "gpt-5.6-terra": [2, 0.2, 12],
  "gpt-5.6-luna": [0.2, 0.02, 1.2],
  "gpt-5-mini": [0.25, 0.025, 2],
  "text-embedding-3-small": [0.02, 0, 0],
  "text-embedding-3-large": [0.13, 0, 0],
};

/** Cost of a call. Dated snapshots ("gpt-6.1-sol-2026-09-01") use their family's price. */
export function costOf(model: string, input: number, cached: number, output: number): number {
  const key = Object.keys(PRICES)
    .filter((k) => model === k || model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return 0;
  const [inp, cache, out] = PRICES[key];
  return ((input - cached) * inp + cached * cache + output * out) / 1_000_000;
}

/** Daily cap on public AI answers, so an exposed server can't run up a bill. */
const DAILY_ASK_LIMIT = Number(process.env.AI_DAILY_ASK_LIMIT || 500);

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** Customer answers use the same key; kept separate so callers read clearly. */
export function customerAiConfigured(): boolean {
  return aiConfigured();
}

let client: OpenAI | null = null;

function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new AIError(AI_SETUP_HINT);
  // The SDK retries rate limits and server errors with backoff.
  client ??= new OpenAI({ maxRetries: 3, timeout: 10 * 60_000 });
  return client;
}

export async function modelFor(purpose: Purpose): Promise<string> {
  const s = await getSettings();
  switch (purpose) {
    case "answer":
      return s.answerModel || DEFAULT_MODELS.answer;
    case "translate":
    case "triage":
      // Sorting a pull request is a judgment call on code, but a short one: the fast model.
      return DEFAULT_MODELS.answer;
    case "classify":
      return DEFAULT_MODELS.light;
    case "embed":
      return DEFAULT_MODELS.embedding;
    default:
      return s.aiModel || DEFAULT_MODELS.team;
  }
}

export type ModelRequest = {
  instructions: string;
  input: ResponseInputItem[];
  tools?: FunctionTool[];
  toolChoice?: "auto" | "required" | { type: "function"; name: string };
  format?: ResponseFormatTextJSONSchemaConfig;
  effort?: Effort;
  maxOutputTokens?: number;
};

function body(model: string, req: ModelRequest) {
  return {
    model,
    instructions: req.instructions,
    input: req.input,
    tools: req.tools,
    tool_choice: req.tools ? (req.toolChoice ?? "auto") : undefined,
    text: req.format ? { format: req.format } : undefined,
    reasoning: req.effort ? { effort: req.effort } : undefined,
    max_output_tokens: req.maxOutputTokens,
    store: false,
  };
}

/** One Responses API call with usage logging and readable errors. */
export async function callModel(purpose: Purpose, req: ModelRequest): Promise<ModelResponse> {
  const model = await modelFor(purpose);
  let res: ModelResponse;
  try {
    res = await openai().responses.create({ ...body(model, req), stream: false });
  } catch (err) {
    throw toAIError(err);
  }
  await recordUsage(purpose, res);
  if (res.status === "incomplete") {
    throw new AIError(
      res.incomplete_details?.reason === "max_output_tokens"
        ? "The response ran out of room before it finished. Try a smaller request."
        : "The model stopped before it finished. Try again.",
    );
  }
  return res;
}

/** Streams the model's text as it's written. Resolves with the finished response. */
export async function streamModel(
  purpose: Purpose,
  req: ModelRequest,
  onText: (delta: string) => void,
  signal?: AbortSignal,
): Promise<ModelResponse> {
  const model = await modelFor(purpose);
  try {
    const stream = await openai().responses.create({ ...body(model, req), stream: true }, { signal });
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") onText(event.delta);
      else if (event.type === "response.completed" || event.type === "response.incomplete") {
        await recordUsage(purpose, event.response);
        return event.response;
      } else if (event.type === "response.failed") {
        throw new AIError(event.response.error?.message ?? "OpenAI couldn't finish the answer.");
      } else if (event.type === "error") {
        throw new AIError(`OpenAI reported an error: ${event.message}`);
      }
    }
  } catch (err) {
    throw toAIError(err);
  }
  throw new AIError("The connection to OpenAI dropped before the answer finished. Try again.");
}

/** Embeddings for a batch of texts, in order. */
export async function embed(texts: string[], dimensions: number): Promise<number[][]> {
  if (!texts.length) return [];
  const model = DEFAULT_MODELS.embedding;
  const out: number[][] = [];
  try {
    for (let i = 0; i < texts.length; i += 64) {
      const res = await openai().embeddings.create({ model, input: texts.slice(i, i + 64), dimensions });
      out.push(...res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
      await run(
        "INSERT INTO ai_usage (purpose, model, input_tokens, output_tokens, cost_usd) VALUES ('embed', $1, $2, 0, $3)",
        [res.model, res.usage.prompt_tokens, costOf(res.model, res.usage.prompt_tokens, 0, 0)],
      );
    }
  } catch (err) {
    throw toAIError(err);
  }
  return out;
}

function toAIError(err: unknown): unknown {
  if (err instanceof AIError) return err;
  if (err instanceof OpenAI.AuthenticationError) return new AIError("OpenAI rejected the API key. Check OPENAI_API_KEY on the server.");
  if (err instanceof OpenAI.PermissionDeniedError) {
    return new AIError("This OpenAI key can't use the chosen model. Pick another in Settings → AI or check the project's model access.");
  }
  if (err instanceof OpenAI.NotFoundError) return new AIError("OpenAI doesn't recognize the chosen model. Pick another in Settings → AI.");
  if (err instanceof OpenAI.RateLimitError) {
    return new AIError(
      /quota|billing/i.test(err.message)
        ? "The OpenAI account is out of credit. Add billing at platform.openai.com."
        : "OpenAI's rate limit was reached. Try again in a minute.",
    );
  }
  if (err instanceof OpenAI.BadRequestError) return new AIError(`OpenAI rejected the request: ${err.message}`);
  // Errors that arrive mid-stream carry no HTTP status; read what they say.
  if (err instanceof OpenAI.APIError && /no credits|credit balance|billing|insufficient_quota|exceeded your current quota/i.test(err.message)) {
    return new AIError("The OpenAI account is out of credit. Add billing at platform.openai.com.");
  }
  if (err instanceof OpenAI.APIError) return new AIError(`OpenAI returned an error (${err.status ?? "network"}). Try again shortly.`);
  return err;
}

/** The text the model wrote, across all of its message items. */
export function outputText(res: ModelResponse): string {
  return res.output
    .flatMap((item) => (item.type === "message" ? item.content.flatMap((c) => (c.type === "output_text" ? [c.text] : [])) : []))
    .join("");
}

export function assertNotRefused(res: ModelResponse) {
  const refused = res.output.some((item) => item.type === "message" && item.content.some((c) => c.type === "refusal"));
  if (refused) throw new AIError("The model declined this request.");
}

/** One call constrained to a JSON schema (strict structured output). */
export async function generateJSON<T>(opts: {
  purpose: Purpose;
  system: string;
  prompt: string | ResponseInputItem[];
  schema: Record<string, unknown>;
  effort: Effort;
  maxTokens?: number;
}): Promise<T> {
  const res = await callModel(opts.purpose, {
    instructions: opts.system,
    input: typeof opts.prompt === "string" ? [{ role: "user", content: opts.prompt }] : opts.prompt,
    format: { type: "json_schema", name: "result", schema: opts.schema, strict: true },
    effort: opts.effort,
    maxOutputTokens: opts.maxTokens,
  });
  assertNotRefused(res);
  try {
    return JSON.parse(outputText(res)) as T;
  } catch {
    throw new AIError("The model returned output that couldn't be read. Try again.");
  }
}

async function recordUsage(purpose: Purpose, res: ModelResponse) {
  const u = res.usage;
  const input = u?.input_tokens ?? 0;
  const cached = u?.input_tokens_details?.cached_tokens ?? 0;
  const output = u?.output_tokens ?? 0;
  await run(
    `INSERT INTO ai_usage (purpose, model, input_tokens, output_tokens, cache_read_tokens, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [purpose, res.model, input, output, cached, costOf(res.model, input, cached, output)],
  ).catch((err) => console.error("[ai] usage log", err));
}

/** Per-visitor (10 a minute) and per-day limits on public AI answers. Shared across instances. */
export async function askAllowed(visitor: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const r = await get<{ mine: number; today: number }>(
    `SELECT count(*) FILTER (WHERE visitor = $1 AND created_at > now() - interval '1 minute') AS mine,
            count(*) FILTER (WHERE created_at >= date_trunc('day', now())) AS today
     FROM ai_conversations WHERE created_at >= least(date_trunc('day', now()), now() - interval '1 minute')`,
    [visitor],
  );
  if ((r?.mine ?? 0) >= 10) return { ok: false, reason: "Too many questions in a minute. Wait a moment and try again." };
  if ((r?.today ?? 0) >= DAILY_ASK_LIMIT) return { ok: false, reason: "AI answers are paused for today. Search the articles instead." };
  return { ok: true };
}
