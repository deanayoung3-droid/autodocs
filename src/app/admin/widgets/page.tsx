import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { IconChevronDown, IconChevronRight, IconCode, IconPencil, IconPlus, IconSearch } from "@/components/icons";
import { timeAgo } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { listWidgets, type Widget } from "@/lib/widgets";
import { createWidgetAction, deleteWidgetAction } from "../platform-actions";
import { PageHeader } from "../secondary";
import { SubmitButton } from "../ui";
import { managerGate } from "../managers-only";

/** A drawing of the widget's panel, so the list shows each widget's look without counting a real open. */
function WidgetMock({ w, accent }: { w: Widget; accent: string }) {
  const color = w.settings.color || accent;
  const header = w.settings.headerBg === "gradient" ? `linear-gradient(135deg, ${w.settings.headerGradientFrom}, ${w.settings.headerGradientTo})` : w.settings.headerColor || color;
  const left = w.settings.position === "left";
  return (
    <div className="dots flex h-full min-h-[290px] items-center justify-center border-line p-8 sm:border-r" aria-hidden>
      <div className="relative">
        <div className="w-44 overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow-md)]">
          <div className="px-3 pt-3 pb-6 text-white" style={{ background: header }}>
            <div className="mb-3 size-4 rounded-xs bg-white/40" />
            <p className="truncate text-[11px] font-semibold">{w.settings.greeting}</p>
          </div>
          <div className="-mt-3 px-2.5 pb-3">
            <div className="flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-1 text-[9px] text-faint">
              <IconSearch size={8} /> Search for help
            </div>
            <div className="mt-2.5 flex flex-col">
              {["w-16", "w-12", "w-14"].map((wd) => (
                <div key={wd} className="flex items-center gap-1.5 border-t border-line-soft py-1.5 first:border-t-0">
                  <span className="size-2 rounded-[2px] bg-line-strong" />
                  <span className={`h-1 rounded bg-line-strong ${wd}`} />
                  <IconChevronRight size={8} className="ml-auto text-faint" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <span
          className={`absolute -bottom-3 flex size-7 items-center justify-center rounded-full text-white shadow-[var(--shadow-md)] ${left ? "-left-3" : "-right-3"}`}
          style={{ background: w.settings.launcherColor || color, color: w.settings.launcherIconColor }}
        >
          <IconChevronDown size={12} />
        </span>
      </div>
    </div>
  );
}

// Job: a person is putting help inside the product, and next they customize a widget or copy its snippet.
export default async function WidgetsPage({ searchParams }: PageProps<"/admin/widgets">) {
  await connection();
  const gate = await managerGate("the widget");
  if (gate) return gate;
  const sp = await searchParams;
  const widgets = await listWidgets();
  const accent = (await getSettings()).accent;
  // Older links opened a widget here; the customizer is its own page now.
  if (sp.id) redirect(`/admin/widgets/${Number(sp.id)}/customize${sp.view === "install" ? "?panel=install" : ""}`);

  return (
    <div className="mx-auto max-w-[904px] px-4 pt-10 pb-16 md:px-8 md:pt-16">
      <PageHeader
        eyebrow="Widget"
        title="Instant answers, anywhere"
        description="Help customers help themselves by adding the help widget to your product."
        actions={
          <form action={createWidgetAction}>
            <SubmitButton pendingLabel="Creating…">
              <IconPlus size={15} /> New widget
            </SubmitButton>
          </form>
        }
      />
      <ul className="flex flex-col gap-4">
        {widgets.map((w, i) => (
          <li key={w.id} className="card rise grid overflow-hidden sm:grid-cols-[300px_1fr]" style={{ "--i": i } as React.CSSProperties}>
            <WidgetMock w={w} accent={accent} />
            <div className="flex flex-col justify-center gap-5 p-6 md:px-12">
              <div>
                <p className="heading text-xl">{w.name}</p>
                <p className="mt-0.5 text-sm text-muted">Created {timeAgo(w.created_at)}</p>
              </div>
              <dl className="num flex gap-8 text-sm">
                {[
                  ["Opens", w.impressions],
                  ["Searches", w.searches],
                  ["Article views", w.views],
                ].map(([label, n]) => (
                  <div key={label}>
                    <dt className="text-muted">{label}</dt>
                    <dd className="text-lg font-medium text-ink">{n}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex gap-2">
                <Link href={`/admin/widgets/${w.id}/customize`} className="btn btn-primary btn-sm">
                  <IconPencil size={13} /> Customize
                </Link>
                <Link href={`/admin/widgets/${w.id}/customize?panel=install`} className="btn btn-sm">
                  <IconCode size={13} /> Install
                </Link>
                {widgets.length > 1 && (
                  <form action={deleteWidgetAction} className="ml-auto">
                    <input type="hidden" name="id" value={w.id} />
                    <SubmitButton className="btn btn-quiet btn-danger btn-sm" pendingLabel="Deleting…">
                      Delete
                    </SubmitButton>
                  </form>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[12px] text-muted">Stats cover the last 30 days.</p>
    </div>
  );
}
