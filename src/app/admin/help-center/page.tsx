import { headers } from "next/headers";
import { connection } from "next/server";
import { getArticle } from "@/lib/articles";
import { restoreArticleAction } from "../actions";
import { SubmitButton } from "../ui";
import { HelpCenterPreview } from "./preview";

// Job: a person is looking at the live help center, and next they open an article or section from the tree.
export default async function HelpCenterPage({ searchParams }: PageProps<"/admin/help-center">) {
  await connection();
  const sp = await searchParams;
  const h = await headers();
  const host = (process.env.PUBLIC_URL?.replace(/^https?:\/\//, "").replace(/\/$/, "") || h.get("host")) ?? "";
  const deleted = typeof sp.deleted === "string" ? await getArticle(Number(sp.deleted)) : undefined;

  return (
    <div className="dots flex h-dvh flex-col gap-4 px-4 pt-4 pb-8 md:px-8">
      {deleted?.deleted_at && (
        <div role="status" className="notice flex flex-wrap items-center justify-between gap-3">
          <span>
            &ldquo;{deleted.title}&rdquo; moved to Recently deleted. It&rsquo;s kept for 30 days.
          </span>
          <form action={restoreArticleAction}>
            <input type="hidden" name="id" value={deleted.id} />
            <SubmitButton className="btn h-8" pendingLabel="Restoring…">
              Undo
            </SubmitButton>
          </form>
        </div>
      )}
      {sp.sectionDeleted && (
        <p role="status" className="notice">
          Section deleted. Its articles and sub-sections moved up one level.
        </p>
      )}
      <div className="min-h-0 flex-1">
        <HelpCenterPreview host={host} />
      </div>
    </div>
  );
}
