import Link from "next/link";
import { connection } from "next/server";
import { IconChevronLeft } from "@/components/icons";
import { PageHeader } from "../../secondary";
import { CATEGORIES, integrationCatalog } from "../catalog";
import { CatalogBrowser } from "./browser";
import { managerGate } from "../../managers-only";

// Job: someone is choosing a tool to connect; next they open it and follow its setup.
export default async function ConnectIntegrationPage() {
  await connection();
  const gate = await managerGate("integrations");
  if (gate) return gate;
  const items = await integrationCatalog();
  return (
    <div className="mx-auto max-w-[960px] px-4 pt-10 pb-16 md:px-8 md:pt-14">
      <Link href="/admin/integrations" className="mb-5 flex w-fit items-center gap-1 text-[13px] text-muted hover:text-ink">
        <IconChevronLeft size={14} /> Back to integrations
      </Link>
      <PageHeader title="Connect an integration" description="Give Docs Agent more context about your product, and more places to work from." />
      <CatalogBrowser items={items} categories={CATEGORIES} />
    </div>
  );
}
