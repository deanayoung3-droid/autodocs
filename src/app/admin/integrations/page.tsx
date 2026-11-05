import Link from "next/link";
import { connection } from "next/server";
import { IconChevronRight, IconPlus } from "@/components/icons";
import { PageHeader } from "../secondary";
import { IntegrationTile, integrationCatalog } from "./catalog";
import { managerGate } from "../managers-only";

// Job: a person is checking which tools feed the docs, and next they open one or connect another.
export default async function IntegrationsPage() {
  await connection();
  const gate = await managerGate("integrations");
  if (gate) return gate;
  const all = await integrationCatalog();
  const connected = all.filter((i) => i.connected);
  const suggested = all.filter((i) => !i.connected && i.categories.includes("Get started"));

  return (
    <div className="mx-auto max-w-[904px] px-4 pt-10 pb-16 md:px-8 md:pt-16">
      <PageHeader
        title="Integrations"
        description="The tools connected to your docs."
        actions={
          <Link href="/admin/integrations/connect" className="btn btn-primary">
            <IconPlus size={14} /> Connect integration
          </Link>
        }
      />

      {connected.length > 0 ? (
        <ul className="card rise divide-y divide-line overflow-hidden">
          {connected.map((i) => (
            <li key={i.id}>
              <Link href={i.href} className="group flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-sunken">
                <IntegrationTile icon={i.icon} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{i.name}</span>
                  <span className="block truncate text-[13px] text-muted">{i.status}</span>
                </span>
                <span className="flex items-center gap-1 text-[13px] text-muted group-hover:text-ink">
                  Manage <IconChevronRight size={14} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card rise px-6 py-10 text-center">
          <p className="font-semibold">Nothing connected yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">Connect your product and your code first: Docs Agent writes better docs when it can see both.</p>
        </div>
      )}

      {suggested.length > 0 && (
        <section className="mt-12" aria-labelledby="start">
          <h2 id="start" className="mb-4 text-[15px] font-semibold">
            Get started
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {suggested.map((i, n) => (
              <li key={i.id} className="rise" style={{ "--i": n } as React.CSSProperties}>
                <div className="card flex h-full flex-col p-4">
                  <IntegrationTile icon={i.icon} />
                  <p className="mt-3 font-semibold">{i.name}</p>
                  <p className="mt-1 flex-1 text-[13px] text-muted">{i.pitch}</p>
                  <div className="mt-4">
                    <Link href={i.href} className="btn h-8 px-3 text-[12px]">
                      Connect <IconChevronRight size={13} />
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13px]">
            <Link href="/admin/integrations/connect" className="link">
              Browse all integrations
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
