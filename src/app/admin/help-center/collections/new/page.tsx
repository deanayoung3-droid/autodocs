import { connection } from "next/server";
import { IconFolder } from "@/components/icons";
import { collectionTree, flattenTree } from "@/lib/articles";
import { PageBar, PageHeader } from "../../../secondary";
import { SectionForm } from "../../sections";

export default async function NewCollectionPage({ searchParams }: PageProps<"/admin/help-center/collections/new">) {
  await connection();
  const sp = await searchParams;
  const parent = Number(sp.parent) || null;
  return (
    <div>
      <PageBar>
        <IconFolder size={14} /> <span className="font-medium text-graphite">New section</span>
      </PageBar>
      <div className="mx-auto max-w-[640px] px-4 py-10 md:px-8">
        <PageHeader title="New section" description="Sections group articles in the help center's sidebar and on its home page." />
        <SectionForm options={flattenTree(await collectionTree()).map((n) => ({ id: n.id, name: n.name, depth: n.depth }))} defaultParent={parent} />
      </div>
    </div>
  );
}
