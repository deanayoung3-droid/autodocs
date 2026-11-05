import Link from "next/link";
import { connection } from "next/server";
import { collectionTree, flattenTree } from "@/lib/articles";
import { findMatches } from "@/lib/bulk";
import { bulkReplaceAction } from "../../actions";
import { PageHeader } from "../../secondary";
import { SubmitButton } from "../../ui";

// Job: a person is changing a term or URL everywhere, and next they review the proposed edits.
export default async function ReplacePage({ searchParams }: PageProps<"/admin/help-center/replace">) {
  await connection();
  const sp = await searchParams;
  const find = typeof sp.find === "string" ? sp.find : "";
  const replace = typeof sp.replace === "string" ? sp.replace : "";
  const opts = {
    matchCase: sp.matchCase === "on",
    wholeWord: sp.wholeWord === "on",
    collectionId: Number(sp.collection) || null,
  };
  const matches = find ? await findMatches(find, opts) : [];
  const total = matches.reduce((n, m) => n + m.count, 0);
  const sections = flattenTree(await collectionTree());

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-8">
      <PageHeader
        eyebrow="Help Center"
        title="Find and replace"
        description={<>Change a term, product name, or link everywhere. You review every edit before it&rsquo;s published.</>}
      />

      <form className="mt-6 grid gap-4 sm:grid-cols-2" role="search">
        <div>
          <label className="label" htmlFor="fr-find">
            Find
          </label>
          <input id="fr-find" name="find" defaultValue={find} required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="fr-replace">
            Replace with
          </label>
          <input id="fr-replace" name="replace" defaultValue={replace} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="fr-section">
            Where
          </label>
          <select id="fr-section" name="collection" defaultValue={opts.collectionId ?? ""} className="field">
            <option value="">All articles</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {"  ".repeat(s.depth)}
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-5 pb-2">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="matchCase" defaultChecked={opts.matchCase} className="size-4 accent-[var(--accent)]" />
            Match case
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="wholeWord" defaultChecked={opts.wholeWord} className="size-4 accent-[var(--accent)]" />
            Whole words
          </label>
        </div>
        <div className="sm:col-span-2">
          <button className="btn">Find matches</button>
        </div>
      </form>

      {find && (
        <section className="mt-8" aria-labelledby="matches">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="matches" className="text-[13px] font-medium text-graphite">
              {matches.length === 0
                ? `No articles contain “${find}”`
                : `${total} ${total === 1 ? "match" : "matches"} in ${matches.length} ${matches.length === 1 ? "article" : "articles"}`}
            </h2>
            {matches.length > 0 && (
              <form action={bulkReplaceAction}>
                <input type="hidden" name="find" value={find} />
                <input type="hidden" name="replace" value={replace} />
                <input type="hidden" name="collection" value={opts.collectionId ?? ""} />
                {opts.matchCase && <input type="hidden" name="matchCase" value="on" />}
                {opts.wholeWord && <input type="hidden" name="wholeWord" value="on" />}
                <SubmitButton pendingLabel="Preparing…">
                  Propose {matches.length} {matches.length === 1 ? "edit" : "edits"}
                </SubmitButton>
              </form>
            )}
          </div>
          <ul className="divide-y divide-line border-y border-line">
            {matches.map((m) => (
              <li key={m.id} className="py-3">
                <p className="flex items-baseline gap-2">
                  <Link href={`/admin/help-center/articles/${m.id}`} className="font-medium hover:underline">
                    {m.title}
                  </Link>
                  <span className="num text-[12px] text-muted">{m.count}</span>
                  {m.status === "draft" && <span className="text-[12px] text-muted">Draft</span>}
                </p>
                {m.snippets.map((s, i) => (
                  <p key={i} className="mt-1 text-[13px] text-muted">
                    <Highlight text={s} term={find} matchCase={opts.matchCase} />
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Highlight({ text, term, matchCase }: { text: string; term: string; matchCase: boolean }) {
  const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, matchCase ? "g" : "gi");
  return (
    <>
      {text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>))}
    </>
  );
}
