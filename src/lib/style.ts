import "server-only";
import { getArticle, popularArticles } from "./articles";
import { hybridSearch } from "./search";

// How the help center's articles are written: a plain, task-first house style. Docs Agent follows it
// and reads real examples from the help center before writing. Teams add their own rules in Settings.

export const WRITING_GUIDE = `How this help center's articles are written. Match it closely; the examples show it in practice.

Shape
- Open with one or two plain sentences, with no heading above them, that say what the feature is or what the reader will get done. Don't repeat the title.
- Keep articles short and single-purpose: most run 120–300 words. Past about 500 words, split into separate articles and link them.
- Task articles: an optional "**Before you start:**" line naming prerequisites, then a "## " heading phrased as the task ("## Create a case", "## Fix login issues"), then numbered steps.
- Overviews and reference articles: "## " sections. Bulleted lists for what someone can do. "**Term** — meaning." lines for statuses, roles, and options. Tables only for data that is truly tabular.

Steps
- One action per step, starting with a verb. Say where the control is and bold its exact label as the product shows it: "Go to **Cases** in the sidebar." "Click **+ Create Case**." "Under **Contact**, search for the client."
- Mark optional steps with "**Optional:**". After the last step, say what happens next ("The case opens immediately.").

Callouts
- Blockquote callouts: "> [!INFO]" for notes, "> [!TIP]" for shortcuts, "> [!WARNING]" for anything destructive, irreversible, or costly. Usually one, never more than two per article.

Troubleshooting
- Numbered checks from most to least likely cause. Self-contained questions can be collapsible: <details><summary>Question</summary>Answer</details>.

Screenshots
- Use them for screens a reader has to find their way around: the starting page of a task, a form, a result. Not for every step.
- Place each one right after the step it shows: ![Alt text naming the screen and the highlighted control](url), then a one-sentence caption paragraph.
- Use only screenshots you captured with the screenshot tool or that already exist in the article. Never invent image URLs.

Links
- End with "**Related:** [Title](/help/slug) · [Title](/help/slug)" linking two to four articles that exist (check with search_articles). Link inline only when a step depends on another article.

Voice
- Second person, present tense, plain words. Capitalize product areas as the product does (for example, Client Portal). No marketing language, no "simply", "just", or "easily", no emoji, no exclamation marks.`;

/**
 * Two published articles to show Docs Agent the house style: the closest matches for the request,
 * falling back to the most-read articles.
 */
export async function styleExamples(about: string): Promise<string> {
  const ids = new Set<number>();
  if (about.trim()) {
    for (const h of await hybridSearch(about.slice(0, 400), { limit: 4, includeRestricted: true })) {
      if (ids.size < 2) ids.add(h.id);
    }
  }
  for (const a of await popularArticles(4, true)) if (ids.size < 2) ids.add(a.id);
  const articles = (await Promise.all([...ids].map(getArticle))).filter((a) => a && a.status === "published");
  if (!articles.length) return "";
  return `<style_examples>
${articles.map((a) => `<example title="${a!.title.replace(/"/g, "'")}" slug="/help/${a!.slug}">\n${a!.body}\n</example>`).join("\n")}
</style_examples>`;
}
