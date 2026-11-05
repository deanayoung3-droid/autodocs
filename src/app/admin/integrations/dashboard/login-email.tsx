import { formatDate, timeAgo } from "@/lib/format";
import { listEmails, type ImapSettings } from "@/lib/inbox";
import { removeImapAction, saveImapAction, startForwardingAction, stopForwardingAction } from "../../capture-actions";
import { Section } from "../../secondary";
import { ActionPanel, CodeBlock, CopyField } from "../../settings/platform-forms";

// A Cloudflare Email Worker that hands each message to this inbox, untouched (raw MIME). The
// address, which carries the key, lives in the worker's INBOX_URL secret, not in this code.
const CLOUDFLARE_WORKER = `export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const res = await fetch(env.INBOX_URL, {
      method: "POST",
      headers: { "Content-Type": "message/rfc822" },
      body: raw,
    });
    if (!res.ok) message.setReject("AutoDocs inbox answered " + res.status);
  },
};`;
import { SubmitButton } from "../../ui";

function ImapFields({ imap, testEmail }: { imap: ImapSettings | null; testEmail: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
      <div>
        <label className="label" htmlFor="imap-host">
          Mail server
        </label>
        <input id="imap-host" name="host" defaultValue={imap?.host ?? "imap.gmail.com"} required className="field font-mono text-[13px]" />
      </div>
      <div>
        <label className="label" htmlFor="imap-port">
          Port
        </label>
        <input id="imap-port" name="port" inputMode="numeric" defaultValue={imap?.port ?? 993} className="field font-mono text-[13px]" />
      </div>
      <div>
        <label className="label" htmlFor="imap-user">
          Username
        </label>
        <input id="imap-user" name="user" defaultValue={imap?.user ?? testEmail} required autoComplete="off" className="field font-mono text-[13px]" />
      </div>
      <div>
        <label className="label" htmlFor="imap-box">
          Folder
        </label>
        <input id="imap-box" name="mailbox" defaultValue={imap?.mailbox ?? "INBOX"} className="field font-mono text-[13px]" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="imap-pass">
          Password
        </label>
        <input
          id="imap-pass"
          name="password"
          type="password"
          required={!imap}
          autoComplete="off"
          placeholder={imap ? "Saved. Leave empty to keep it." : "For Gmail, an app password"}
          className="field font-mono text-[13px]"
        />
      </div>
    </div>
  );
}

/** Where the test account's sign-in emails go, and what has arrived. */
export async function LoginEmail({
  origin,
  imap,
  forwardingKey,
  testEmail,
}: {
  origin: string;
  imap: ImapSettings | null;
  forwardingKey: string | null;
  testEmail: string;
}) {
  const emails = await listEmails(10);
  return (
    <Section
      title="Login email"
      description="For products that sign in with a code or link sent by email, Docs Agent reads the test account's mail to finish signing in; you never paste a code."
    >
      <div className="flex flex-col divide-y divide-line rounded-lg border border-line">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold">Read the mailbox</p>
              <p className="text-[13px] text-muted">
                {imap ? (
                  <>
                    Reading <span className="font-mono">{imap.user}</span> on <span className="font-mono">{imap.host}</span>, folder {imap.mailbox}.
                  </>
                ) : (
                  "Best when the test account has its own mailbox, like a Google Workspace user. Docs Agent connects over IMAP when it needs a code."
                )}
              </p>
            </div>
            {imap && (
              <form action={removeImapAction}>
                <SubmitButton className="btn btn-sm btn-danger" pendingLabel="Removing…">
                  Remove
                </SubmitButton>
              </form>
            )}
          </div>
          <details open={!imap && !forwardingKey}>
            <summary className="cursor-pointer text-[13px] text-muted hover:text-ink">{imap ? "Change mailbox" : "Connect a mailbox"}</summary>
            <div className="pt-3">
              <ActionPanel action={saveImapAction} submitLabel="Connect and test" className="flex flex-col gap-4">
                <ImapFields imap={imap} testEmail={testEmail} />
              </ActionPanel>
            </div>
          </details>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold">Forward mail here</p>
              <p className="text-[13px] text-muted">
                For an address on a domain you route through an email service. Point SendGrid Inbound Parse, a Mailgun route, Postmark inbound, or a Cloudflare
                Email Worker at this URL.
              </p>
            </div>
            {forwardingKey ? (
              <div className="flex gap-2">
                <form action={startForwardingAction}>
                  <SubmitButton className="btn btn-sm" pendingLabel="Replacing…">
                    New address
                  </SubmitButton>
                </form>
                <form action={stopForwardingAction}>
                  <SubmitButton className="btn btn-sm btn-danger" pendingLabel="Stopping…">
                    Stop
                  </SubmitButton>
                </form>
              </div>
            ) : (
              <form action={startForwardingAction}>
                <SubmitButton className="btn btn-sm" pendingLabel="Creating…">
                  Create a forwarding address
                </SubmitButton>
              </form>
            )}
          </div>
          {forwardingKey && <CopyField value={`${origin}/api/inbox/${forwardingKey}`} />}
          {forwardingKey && (
            <details className="text-[13px]">
              <summary className="cursor-pointer text-muted hover:text-ink">Set it up with Cloudflare Email Routing</summary>
              <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-graphite">
                <li>
                  Use a subdomain only, such as <span className="font-mono">bot.yourdomain.com</span>. In Cloudflare, open <strong>Email → Email Routing → Settings</strong> and
                  add the subdomain. Don&rsquo;t change the main domain&rsquo;s mail records: they keep your company email working.
                </li>
                <li>
                  Open <strong>Workers &amp; Pages → Create → Worker</strong>, name it <span className="font-mono">autodocs-inbox</span>, and replace its code with the code below.
                  Under <strong>Settings → Variables</strong>, add <span className="font-mono">INBOX_URL</span> as a secret, set to the address above.
                </li>
                <li>
                  Back in <strong>Email Routing → Routing rules</strong>, create a custom address such as <span className="font-mono">docs@bot.yourdomain.com</span> with the
                  action <strong>Send to a Worker</strong> → <span className="font-mono">autodocs-inbox</span>.
                </li>
                <li>Use that address as the test account&rsquo;s email in your product, then click Test sign-in.</li>
              </ol>
              <div className="mt-3">
                <CodeBlock label="Worker code" value={CLOUDFLARE_WORKER} />
              </div>
            </details>
          )}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[13px] font-semibold">Received emails</p>
        {emails.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {emails.map((m) => (
              <li key={m.id}>
                <details className="group">
                  <summary className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 text-[13px] hover:bg-sunken">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{m.subject || "(no subject)"}</span> <span className="text-muted">· {m.from_address}</span>
                    </span>
                    <time dateTime={m.received_at} title={formatDate(m.received_at)} className="shrink-0 text-[12.5px] text-muted">
                      {timeAgo(m.received_at)}
                    </time>
                  </summary>
                  <pre className="max-h-64 overflow-auto border-t border-line bg-sunken px-3.5 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-graphite">
                    {m.text_body.trim() || "(This email has no plain-text part.)"}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-line px-3.5 py-4 text-[13px] text-muted">
            Nothing yet. Sign-in emails show up here as they arrive, so you can see what Docs Agent read.
          </p>
        )}
      </div>
    </Section>
  );
}
