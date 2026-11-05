import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Script from "next/script";
import { connection } from "next/server";
import { Suspense } from "react";
import { BrandLogo } from "@/components/icons";
import { customerAiConfigured } from "@/lib/ai";
import { collectionRestricted, collectionTree, flattenTree, listArticles } from "@/lib/articles";
import { currentReader } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { LANGUAGES } from "@/lib/translations";
import { LanguageSwitcher } from "./article-actions";
import { Assistant } from "./assistant";
import { HelpSidebar, SearchPalette, type NavSection } from "./help-nav";
import { readerSignOutAction } from "./reader-actions";
import { SchemeToggle } from "./scheme-toggle";
import { PRODUCT_NAME } from "@/lib/product";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const s = await getSettings();
  const title = s.seoTitle || `${s.brandName} Help Center`;
  const description = s.seoDescription || `Guides and answers for ${s.brandName}.`;
  return {
    title: { default: title, template: `%s | ${s.brandName} Help Center` },
    description,
    openGraph: { title, description, type: "website" },
    robots: s.siteVisibility === "private" ? { index: false, follow: false } : undefined,
  };
}

export default async function HelpLayout({ children }: LayoutProps<"/help">) {
  await connection();
  const s = await getSettings();
  const reader = await currentReader();
  const languages = s.languages.filter((c) => LANGUAGES[c]).map((code) => ({ code, name: LANGUAGES[code] }));
  const signedIn = reader !== null;
  // A reader's own choice (the header toggle) wins over the workspace default.
  const pref = (await cookies()).get("help-scheme")?.value;
  const scheme = pref === "system" || pref === "light" || pref === "dark" ? pref : s.helpColorScheme;

  // The sidebar lists only what this reader may see; a private help center shows nothing until sign-in.
  const sections: NavSection[] = [];
  if (s.siteVisibility === "public" || signedIn) {
    const articles = (await listArticles({ status: "published", order: "position" })).filter((a) => signedIn || !a.restricted);
    for (const c of flattenTree(await collectionTree())) {
      if (!signedIn && await collectionRestricted(c.id)) continue;
      const mine = articles.filter((a) => a.collection_id === c.id).map((a) => ({ slug: a.slug, title: a.title }));
      if (mine.length) sections.push({ slug: c.slug, name: c.name, icon: c.icon, articles: mine });
    }
  }
  const ai = s.aiAnswers && customerAiConfigured();

  return (
    <div className="help-root flex min-h-dvh flex-col bg-surface text-ink" data-scheme={scheme} style={{ "--accent": s.accent } as React.CSSProperties}>
      {s.customCss && <style>{s.customCss}</style>}
      <header className="sticky top-0 z-20 border-b border-line-soft bg-surface/80 backdrop-blur-md">
        <div className="flex h-16 items-center gap-4 px-4 md:px-10">
          <Link href="/help" className="flex shrink-0 items-center gap-3 text-ink-strong">
            {s.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary external logo URL
              <img src={s.logoUrl} alt={s.brandName} className="h-7 w-auto" />
            ) : (
              <BrandLogo height={24} label={s.brandName} />
            )}
            <span className="hidden text-[18px] font-semibold tracking-[-0.01em] text-ink sm:inline">Help Center</span>
          </Link>
          <div className="hidden flex-1 justify-center md:flex">
            <SearchPalette ai={ai} />
          </div>
          <nav aria-label="Links" className="ml-auto flex min-w-0 items-center gap-2 text-[14px] font-medium">
            <Suspense>
              <LanguageSwitcher languages={languages} />
            </Suspense>
            <SchemeToggle />
            {reader && reader !== "team" && (
              <form action={readerSignOutAction}>
                <button className="text-muted transition-colors hover:text-ink">Sign out</button>
              </form>
            )}
            {/* The header links (such as a sign-in link to your product), then Contact us, which opens in a new tab. */}
            <div className="hidden items-center gap-6 pl-3 md:flex">
              {s.headerLinks.map((l) => (
                <a key={l.url} href={l.url} className="whitespace-nowrap text-graphite transition-colors hover:text-ink">
                  {l.label}
                </a>
              ))}
            </div>
            {s.supportUrl && (
              <a
                href={s.supportUrl}
                target={s.supportUrl.startsWith("mailto:") ? undefined : "_blank"}
                rel="noopener noreferrer"
                className="rounded-xl px-3 py-1.5 whitespace-nowrap text-ink transition-colors hover:bg-well"
              >
                Contact us
              </a>
            )}
          </nav>
        </div>
      </header>
      <div className="flex w-full flex-1">
        <HelpSidebar sections={sections} />
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1">{children}</main>
          <footer className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line-soft px-4 py-8 text-[14px] text-muted md:px-8">
            {s.footerLinks.length ? (
              s.footerLinks.map((l) => (
                <a key={l.url} href={l.url} className="transition-colors hover:text-ink">
                  {l.label}
                </a>
              ))
            ) : (
              <span>
                © {new Date().getFullYear()} {s.brandName}
              </span>
            )}
            {s.showPoweredBy && <span className="text-faint">Powered by {PRODUCT_NAME}</span>}
          </footer>
        </div>
      </div>
      {ai && <Assistant supportUrl={s.supportUrl} />}
      {s.customJs && (
        <Script id="custom-js" strategy="afterInteractive">
          {s.customJs}
        </Script>
      )}
    </div>
  );
}
