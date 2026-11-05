import { connection } from "next/server";
import { IconLock } from "@/components/icons";
import Link from "next/link";
import { mailerReady } from "@/lib/mailer";
import { getSettings, secretStatus } from "@/lib/settings";
import { saveAccessAction } from "../../platform-actions";
import { PageBar, PageHeader, Section } from "../../secondary";
import { ActionPanel } from "../../settings/platform-forms";
import { managerGate } from "../../managers-only";

export default async function AccessControlPage() {
  await connection();
  const gate = await managerGate("who can read the help center");
  if (gate) return gate;
  const [s, mail] = await Promise.all([getSettings(), mailerReady()]);
  const secrets = secretStatus();
  return (
    <div>
      <PageBar>
        <IconLock size={14} /> <span className="font-medium text-graphite">Access control</span>
      </PageBar>
      <div className="mx-auto max-w-[760px] px-4 py-10 md:px-8">
        <PageHeader eyebrow="Help Center" title="Access control" description="Decide who can read the help center, and how readers sign in." />
        <div className="flex flex-col gap-10">
          <Section title="Who can read it" description="Restricted sections and articles are always hidden from signed-out readers. Only owners can change this.">
            <ActionPanel action={saveAccessAction} submitLabel="Save access">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["public", "Public", "Anyone can read it. Restrict individual sections or articles."],
                  ["private", "Private", "Readers must sign in to see anything."],
                ].map(([value, label, hint]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line p-4 transition-colors has-[:checked]:border-accent-line has-[:checked]:bg-accent-soft"
                  >
                    <input type="radio" name="siteVisibility" value={value} defaultChecked={s.siteVisibility === value} className="mt-0.5 accent-[var(--accent)]" />
                    <span>
                      <span className="font-semibold">{label}</span>
                      <span className="block text-[13px] text-muted">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div>
                <label className="label" htmlFor="ac-pass">
                  Reader password {s.readerPasswordHash && <span className="font-normal text-muted">(set; enter a new one to change it)</span>}
                </label>
                <input id="ac-pass" name="readerPassword" type="password" autoComplete="new-password" className="field max-w-sm" />
                {s.readerPasswordHash && (
                  <label className="mt-2 flex items-center gap-2 text-[13px]">
                    <input type="checkbox" name="clearPassword" className="size-4 accent-[var(--accent)]" />
                    Turn off password sign-in
                  </label>
                )}
              </div>
              <div>
                <label className="label" htmlFor="ac-emails">
                  Email sign-in link
                </label>
                <p className="hint mb-2">
                  Readers at these addresses or domains get a link that signs them in for 30 days. One per line; <code>@firm.com</code> lets everyone at
                  that domain in.
                </p>
                <textarea
                  id="ac-emails"
                  name="readerEmailAllow"
                  rows={3}
                  defaultValue={s.readerEmailAllow.join("\n")}
                  placeholder={"@yourcustomer.com\partner@example.com"}
                  className="field max-w-sm font-mono text-[13px]"
                />
                {!mail && s.readerEmailAllow.length > 0 && (
                  <p className="notice mt-2">
                    Links can&rsquo;t be sent until email is set up in{" "}
                    <Link href="/admin/settings/email" className="link">
                      Settings → Email delivery
                    </Link>
                    .
                  </p>
                )}
              </div>
            </ActionPanel>
          </Section>

          <Section title={`Sign in with ${s.brandName}`} description="Let readers use the account they already have in your product.">
            <p className="text-[13px] text-graphite">
              Your app signs a short-lived HS256 token with <code>READER_JWT_SECRET</code> (claims: <code>sub</code> or <code>email</code>, and{" "}
              <code>exp</code>) and sends readers to <code>/help/auth/jwt?token=…&amp;next=/help/…</code>. Set <code>READER_SIGNIN_URL</code> to your
              app&rsquo;s sign-in page to add a button to the help center&rsquo;s sign-in screen.
            </p>
            <p className="mt-3">
              <span className={`chip ${secrets.readerJwt ? "chip-accent" : ""}`}>
                {secrets.readerJwt ? "READER_JWT_SECRET is set" : "READER_JWT_SECRET isn't set"}
              </span>
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
