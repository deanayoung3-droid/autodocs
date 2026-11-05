import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/icons";
import { currentUser } from "@/lib/auth";
import { getClient } from "@/lib/oauth";
import { getSettings } from "@/lib/settings";

// Job: a teammate is deciding whether an AI app (Claude, ChatGPT) may use the docs as them; next
// they allow it and go back to the app.
export default async function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  await connection();
  const sp = await searchParams;
  const p = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const settings = await getSettings();
  const client = await getClient(p("client_id"));
  const redirectUri = p("redirect_uri");

  // A bad client or redirect address can't safely be sent back to, so it's explained here.
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return (
      <Card accent={settings.accent} brand={settings.brandName} title="This link doesn't work">
        <p className="mt-1 text-[13px] text-muted">The app sent an unknown client or return address. Start connecting again from the app.</p>
      </Card>
    );
  }
  // Other problems go back to the app, as OAuth expects.
  const back = (params: Record<string, string>) => {
    const url = new URL(redirectUri);
    for (const [k, v] of Object.entries({ ...params, ...(p("state") ? { state: p("state") } : {}) })) url.searchParams.set(k, v);
    redirect(url.toString());
  };
  if (p("response_type") !== "code") back({ error: "unsupported_response_type" });
  if (!p("code_challenge") || p("code_challenge_method") !== "S256") back({ error: "invalid_request", error_description: "PKCE with S256 is required." });

  const user = await currentUser();
  if (!user) {
    const query = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
  }
  const returnsTo = new URL(redirectUri).host || new URL(redirectUri).protocol;

  return (
    <Card accent={settings.accent} brand={settings.brandName} title={`Connect ${client.name}`}>
      <p className="mt-1 text-[13px] text-muted">
        {client.name} wants to use the {settings.brandName} docs as {user.name}. It will be able to:
      </p>
      <ul className="mt-4 flex list-disc flex-col gap-1.5 pl-5 text-[13.5px] text-graphite">
        <li>Search and read every article, including drafts and restricted ones</li>
        <li>Propose new articles and edits, which wait in Review until a teammate publishes them</li>
      </ul>
      <p className="mt-4 text-[12.5px] text-muted">
        You&rsquo;ll go back to <strong className="font-medium text-graphite">{returnsTo}</strong>. Disconnect it any time from MCP in the admin.
      </p>
      <form method="post" action="/oauth/authorize/decide" className="mt-6 flex gap-2">
        <input type="hidden" name="client_id" value={client.id} />
        <input type="hidden" name="redirect_uri" value={redirectUri} />
        <input type="hidden" name="code_challenge" value={p("code_challenge")} />
        <input type="hidden" name="state" value={p("state")} />
        <button type="submit" name="decision" value="deny" className="btn flex-1">
          Cancel
        </button>
        <button type="submit" name="decision" value="allow" className="btn btn-primary flex-1" autoFocus>
          Allow
        </button>
      </form>
    </Card>
  );
}

function Card({ accent, brand, title, children }: { accent: string; brand: string; title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4" style={{ "--accent": accent } as React.CSSProperties}>
      <div className="card pop-in w-full max-w-md p-7 shadow-[var(--shadow-lg)]">
        <span className="flex items-center gap-2 text-ink-strong">
          <BrandLogo height={21} label={brand} />
          <span className="rounded-md border border-line-strong px-1.5 text-[11px] leading-[18px] font-medium text-muted">Docs</span>
        </span>
        <h1 className="title mt-7 text-[22px]">{title}</h1>
        {children}
      </div>
    </main>
  );
}
