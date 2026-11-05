import Link from "next/link";
import { timeAgo } from "@/lib/format";
import type { SupportConversation } from "@/lib/support";
import { reviewSupportNowAction, setSupportAutoDraftAction } from "../../integration-actions";
import { SubmitButton } from "../../ui";
import { ConnectionCard } from "../connection";

// The parts every source of support conversations shares: the Support Endpoint and each helpdesk.

/** Whether gaps get drafted or only flagged. One setting for every source. */
export function DraftingCard({ autoDraft, waiting }: { autoDraft: boolean; waiting: number }) {
  return (
    <ConnectionCard
      title="Drafting"
      description={
        autoDraft
          ? "Docs Agent drafts a fix for each gap it finds. Drafts wait for review; nothing is published on its own."
          : "Docs Agent only flags gaps. Turn drafting on to have it write the fixes."
      }
      actions={
        <form action={setSupportAutoDraftAction.bind(null, !autoDraft)}>
          <SubmitButton className="btn btn-sm" pendingLabel="Saving…">
            {autoDraft ? "Only flag gaps" : "Draft fixes"}
          </SubmitButton>
        </form>
      }
    >
      {waiting > 0 && (
        <div className="flex items-center justify-between gap-3 px-5 py-3 text-[13px] text-graphite">
          <span>
            <span className="num font-semibold">{waiting}</span> waiting to be read. Docs Agent reads new conversations a minute after they arrive.
          </span>
          <form action={reviewSupportNowAction}>
            <SubmitButton className="btn btn-sm" pendingLabel="Queuing…">
              Read now
            </SubmitButton>
          </form>
        </div>
      )}
    </ConnectionCard>
  );
}

/** Conversations as they were read: waiting, covered by the docs, or a gap (linked to its draft). */
export function ConversationList({ title = "Recent conversations", conversations, empty }: { title?: string; conversations: SupportConversation[]; empty: string }) {
  return (
    <ConnectionCard title={title}>
      {conversations.length ? (
        <ul className="divide-y divide-line">
          {conversations.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px]">{c.subject || `Conversation ${c.external_id}`}</p>
                <p className="truncate text-[12.5px] text-muted">
                  {[c.source, c.customer, timeAgo(c.received_at)].filter(Boolean).join(" · ")}
                  {c.gap_reason ? ` · ${c.gap_reason}` : ""}
                </p>
              </div>
              {!c.reviewed_at ? (
                <span className="chip">Waiting</span>
              ) : c.gap_topic ? (
                c.run_id ? (
                  <Link href={`/admin/agent/${c.run_id}`} className="chip chip-accent hover:underline">
                    Gap: {c.gap_topic}
                  </Link>
                ) : (
                  <span className="chip chip-accent">Gap: {c.gap_topic}</span>
                )
              ) : (
                <span className="chip">Covered</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-[13px] text-muted">{empty}</p>
      )}
    </ConnectionCard>
  );
}
