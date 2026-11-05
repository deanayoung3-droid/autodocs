import Link from "next/link";
import { BrandMark } from "@/components/icons";
import { Mascot } from "@/components/mascot";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4 text-center">
      <span className="text-ink-strong">
        <BrandMark size={28} />
      </span>
      <Mascot size={96} mood="sleeping" animate label="Docs Agent, asleep" />
      <div>
        <p className="text-[11px] font-semibold tracking-wider text-accent-strong uppercase">Error 404</p>
        <h1 className="title mt-1">This page wandered off.</h1>
        <p className="mt-2 max-w-sm text-muted">The link is broken or the page moved. Docs Agent fixes broken docs for a living, so this one stings a little.</p>
      </div>
      <div className="flex gap-2">
        <Link href="/help" className="btn btn-primary">
          Go to the help center
        </Link>
        <Link href="/admin" className="btn">
          Admin
        </Link>
      </div>
    </main>
  );
}
