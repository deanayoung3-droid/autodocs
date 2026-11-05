import { BrandLogo } from "@/components/icons";
import { getSettings } from "@/lib/settings";

/** The centered card that sign-in, invitations, password resets, and first-run setup share. */
export async function AuthCard({ title, description, children }: { title: string; description: React.ReactNode; children: React.ReactNode }) {
  const settings = await getSettings();
  return (
    <main className="flex min-h-dvh items-center justify-center px-4" style={{ "--accent": settings.accent } as React.CSSProperties}>
      <div className="card pop-in w-full max-w-sm p-7 shadow-[var(--shadow-lg)]">
        <div className="mb-6">
          <span className="flex items-center gap-2 text-ink-strong">
            <BrandLogo height={21} label={settings.brandName} />
            <span className="rounded-md border border-line-strong px-1.5 text-[11px] leading-[18px] font-medium text-muted">Docs</span>
          </span>
          <h1 className="title mt-7 text-[22px]">{title}</h1>
          <p className="mt-1 text-[13px] text-muted">{description}</p>
        </div>
        {children}
      </div>
    </main>
  );
}
