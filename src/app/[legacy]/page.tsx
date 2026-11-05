import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { redirectFor } from "@/lib/articles";

// Addresses from the previous help center (docs.example.com/create-a-case-0nki5, and the
// .md copies AI tools fetch) go permanently to their new pages, so links and rankings carry over.
export default async function LegacyAddress({ params }: PageProps<"/[legacy]">) {
  await connection();
  const legacy = decodeURIComponent((await params).legacy);
  const markdown = legacy.endsWith(".md");
  const to = await redirectFor(`/${markdown ? legacy.slice(0, -3) : legacy}`);
  if (to) permanentRedirect(markdown && to.startsWith("/help/") && !to.startsWith("/help/c/") ? to.replace("/help/", "/help/md/") : to);
  notFound();
}
