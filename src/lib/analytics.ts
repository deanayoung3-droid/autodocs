import "server-only";
import crypto from "node:crypto";
import { generateJSON } from "./ai";
import { all, get, insert, run, tx } from "./db";
import { getSettings } from "./settings";

/** Anonymous per-day visitor id: a salted hash of IP and user agent, never stored raw. */
export function visitorId(headers: Headers): string {
  const ip = headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip") || "local";
  const day = new Date().toISOString().slice(0, 10);
  return crypto
    .createHash("sha256")
    .update(`${ip}|${headers.get("user-agent") ?? ""}|${day}|${process.env.SESSION_SECRET ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

export async function recordPageView(articleId: number, visitor: string, source: "help" | "widget") {
  await run("INSERT INTO page_views (article_id, visitor, source) VALUES ($1, $2, $3)", [articleId, visitor, source]);
}

export async function logQuery(kind: "search" | "ask", text: string, resultCount: number, answered: boolean, source = "help") {
  const clean = text.trim().slice(0, 300);
  if (!clean) return;
  await run("INSERT INTO queries (kind, text, result_count, answered, source) VALUES ($1, $2, $3, $4, $5)", [
    kind,
    clean,
    resultCount,
    answered ? 1 : 0,
    source,
  ]);
}

/** Marks the latest matching search as having led to an article click. */
export async function markSearchClick(text: string) {
  await run(
    `UPDATE queries SET clicked = 1 WHERE id = (SELECT id FROM queries WHERE kind = 'search' AND text = $1
     AND created_at >= now() - interval '1 hour' ORDER BY id DESC LIMIT 1)`,
    [text.trim().slice(0, 300)],
  );
}

export async function logConversation(c: {
  question: string;
  answer: string;
  answered: boolean;
  sources: { title: string; slug: string }[];
  visitor: string;
  source: string;
  parentId?: number | null;
}): Promise<number> {
  return insert(
    `INSERT INTO ai_conversations (question, answer, answered, sources_json, visitor, source, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [c.question.slice(0, 500), c.answer, c.answered ? 1 : 0, JSON.stringify(c.sources), c.visitor, c.source, c.parentId ?? null],
  );
}

/** The earlier turns of a conversation, oldest first, so a follow-up has context. */
export async function conversationHistory(id: number, visitor: string, limit = 4): Promise<{ question: string; answer: string }[]> {
  const rows = await all<{ question: string; answer: string }>(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_id, question, answer, 0 AS depth FROM ai_conversations WHERE id = $1 AND visitor = $2
       UNION ALL
       SELECT c.id, c.parent_id, c.question, c.answer, chain.depth + 1
       FROM ai_conversations c JOIN chain ON c.id = chain.parent_id WHERE chain.depth < $3
     )
     SELECT question, answer FROM chain ORDER BY depth DESC`,
    [id, visitor, limit - 1],
  );
  return rows;
}

export async function markHandoff(id: number) {
  await run("UPDATE ai_conversations SET handed_off = 1 WHERE id = $1", [id]);
}

/** A reader's thumbs up or down on an AI answer. */
export async function rateAnswer(id: number, visitor: string, helpful: boolean) {
  await run("UPDATE ai_conversations SET helpful = $1 WHERE id = $2 AND visitor = $3", [helpful ? 1 : 0, id, visitor]);
}

/* Reporting */

type Totals = { visitors: number; views: number; searches: number; ctr: number; conversations: number; answered: number; savings: number };

async function totals(fromDays: number, toDays: number): Promise<Totals> {
  const range = `created_at >= now() - make_interval(days => $1) AND created_at < now() - make_interval(days => $2)`;
  const [pv, s, c, settings] = await Promise.all([
    get<{ views: number; visitors: number }>(
      `SELECT count(*) AS views, count(DISTINCT visitor) AS visitors FROM page_views WHERE ${range}`,
      [fromDays, toDays],
    ),
    get<{ n: number; clicked: number }>(
      `SELECT count(*) AS n, coalesce(sum(clicked), 0) AS clicked FROM queries WHERE kind = 'search' AND ${range}`,
      [fromDays, toDays],
    ),
    get<{ n: number; answered: number }>(
      `SELECT count(*) AS n, coalesce(sum(answered), 0) AS answered FROM ai_conversations WHERE ${range}`,
      [fromDays, toDays],
    ),
    getSettings(),
  ]);
  return {
    visitors: pv?.visitors ?? 0,
    views: pv?.views ?? 0,
    searches: s?.n ?? 0,
    ctr: s?.n ? s.clicked / s.n : 0,
    conversations: c?.n ?? 0,
    answered: c?.answered ?? 0,
    savings: (c?.answered ?? 0) * settings.costPerTicket,
  };
}

export type Report = {
  days: number;
  current: Totals;
  previous: Totals;
  daily: { date: string; views: number; searches: number; conversations: number }[];
  topArticles: { id: number; title: string; slug: string; views: number }[];
  topSearches: { text: string; count: number; results: number; clicks: number }[];
  emptySearches: { text: string; count: number; last: string }[];
  conversations: { id: number; question: string; answer: string; answered: number; sources_json: string; theme: string | null; created_at: string }[];
  feedback: { id: number; title: string; helpful_yes: number; helpful_no: number }[];
  themes: { theme: string; count: number; answered: number }[];
};

export async function report(days: number): Promise<Report> {
  const since = "created_at >= now() - make_interval(days => $1)";
  const dailyRows = async (table: string, extra = "") =>
    new Map(
      (
        await all<{ day: string; n: number }>(
          `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*) AS n
           FROM ${table} WHERE ${since} ${extra} GROUP BY 1`,
          [days],
        )
      ).map((r) => [r.day, r.n]),
    );
  const [views, searches, convos, current, previous, topArticles, topSearches, emptySearches, conversations, feedback, themes] =
    await Promise.all([
      dailyRows("page_views"),
      dailyRows("queries", "AND kind = 'search'"),
      dailyRows("ai_conversations"),
      totals(days, 0),
      totals(days * 2, days),
      all<Report["topArticles"][number]>(
        `SELECT a.id, a.title, a.slug, count(*) AS views FROM page_views v JOIN articles a ON a.id = v.article_id
         WHERE v.${since} GROUP BY a.id ORDER BY views DESC LIMIT 10`,
        [days],
      ),
      all<Report["topSearches"][number]>(
        `SELECT lower(trim(text)) AS text, count(*) AS count, max(result_count) AS results, sum(clicked) AS clicks
         FROM queries WHERE kind = 'search' AND ${since} GROUP BY lower(trim(text)) ORDER BY count DESC LIMIT 25`,
        [days],
      ),
      all<Report["emptySearches"][number]>(
        `SELECT lower(trim(text)) AS text, count(*) AS count, max(created_at) AS last FROM queries
         WHERE ${since} AND ((kind = 'search' AND result_count = 0) OR (kind = 'ask' AND answered = 0))
         GROUP BY lower(trim(text)) ORDER BY count DESC, last DESC LIMIT 25`,
        [days],
      ),
      all<Report["conversations"][number]>(
        `SELECT id, question, answer, answered, sources_json, theme, created_at FROM ai_conversations
         WHERE ${since} ORDER BY id DESC LIMIT 100`,
        [days],
      ),
      all<Report["feedback"][number]>(
        `SELECT id, title, helpful_yes, helpful_no FROM articles WHERE deleted_at IS NULL AND (helpful_yes + helpful_no) > 0
         ORDER BY helpful_no * 1.0 / (helpful_yes + helpful_no) DESC, helpful_no DESC LIMIT 25`,
      ),
      all<Report["themes"][number]>(
        `SELECT theme, count(*) AS count, sum(answered) AS answered FROM ai_conversations
         WHERE ${since} AND theme IS NOT NULL GROUP BY theme ORDER BY count DESC LIMIT 12`,
        [days],
      ),
    ]);
  const daily = Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date, views: views.get(date) ?? 0, searches: searches.get(date) ?? 0, conversations: convos.get(date) ?? 0 };
  });
  return { days, current, previous, daily, topArticles, topSearches, emptySearches, conversations, feedback, themes };
}

/** Groups recent questions into themes, so Support trends can show what people ask about. */
export async function classifyThemes(): Promise<number> {
  const rows = await all<{ id: number; question: string }>(
    "SELECT id, question FROM ai_conversations WHERE theme IS NULL ORDER BY id DESC LIMIT 60",
  );
  if (rows.length < 3) return 0;
  const existing = (await all<{ theme: string }>("SELECT DISTINCT theme FROM ai_conversations WHERE theme IS NOT NULL LIMIT 30")).map(
    (r) => r.theme,
  );
  const out = await generateJSON<{ items: { index: number; theme: string }[] }>({
    purpose: "classify",
    system:
      "Group customer questions into short themes of 1–3 words (e.g. 'Billing', 'Calendar sync'). Reuse an existing theme when it fits.",
    prompt: `Existing themes: ${existing.join(", ") || "(none)"}\n\nQuestions:\n${rows.map((r, i) => `${i}. ${r.question}`).join("\n")}`,
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { index: { type: "integer" }, theme: { type: "string" } },
            required: ["index", "theme"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
    effort: "low",
  });
  await tx(async () => {
    for (const item of out.items) {
      if (rows[item.index]) await run("UPDATE ai_conversations SET theme = $1 WHERE id = $2", [item.theme.slice(0, 40), rows[item.index].id]);
    }
  });
  return out.items.length;
}

/* Used by the agent's audit and composer. */

export type Insights = {
  unanswered: { text: string; count: number; last: string }[];
  leastHelpful: { id: number; title: string; helpful_yes: number; helpful_no: number }[];
};

export async function getInsights(): Promise<Insights> {
  const r = await report(30);
  return { unanswered: r.emptySearches.slice(0, 15), leastHelpful: r.feedback.filter((f) => f.helpful_no > 0).slice(0, 5) };
}

/** Rough time saved by the agent and verification in the last 30 days, in hours. */
export async function hoursSaved(): Promise<number> {
  const r = await get<{ approved: number; checks: number }>(
    `SELECT (SELECT count(*) FROM proposals WHERE status = 'approved' AND decided_at >= now() - interval '30 days') AS approved,
            (SELECT count(*) FROM verifications WHERE checked_at >= now() - interval '30 days') AS checks`,
  );
  return Math.round((((r?.approved ?? 0) * 25 + (r?.checks ?? 0) * 5) / 60) * 10) / 10;
}
