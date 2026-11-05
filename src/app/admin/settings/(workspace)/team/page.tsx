import { connection } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { formatDate, timeAgo } from "@/lib/format";
import { INVITE_DAYS, pendingInvitations } from "@/lib/invitations";
import { mailerReady } from "@/lib/mailer";
import { listUsers, roleLabel, ROLES } from "@/lib/users";
import { invitationLinkAction, inviteAction, removeUserAction, resetLinkAction, revokeInvitationAction, setRoleAction } from "../../../platform-actions";
import { PageHeader } from "../../../secondary";
import { SubmitButton } from "../../../ui";
import { ActionPanel } from "../../platform-forms";
import { managerGate } from "../../../managers-only";
import { LinkAction } from "./link-action";

// Job: an admin is deciding who can do what; next they invite someone or change a role.
export default async function TeamSettingsPage({ searchParams }: PageProps<"/admin/settings/team">) {
  await connection();
  const gate = await managerGate("workspace settings");
  if (gate) return gate;
  const sp = await searchParams;
  const me = await requireAdmin();
  const [users, invitations, canEmail] = await Promise.all([listUsers(), pendingInvitations(), mailerReady()]);
  const isOwner = me.role === "owner";
  // Admins manage admins and contributors; only owners touch owners.
  const choices = ROLES.filter((r) => isOwner || r.value !== "owner");
  const people = `${users.length} ${users.length === 1 ? "person" : "people"}`;
  const pending = invitations.length ? ` · ${invitations.length} invited` : "";
  return (
    <>
      <PageHeader title="Team" description={`${people}${pending}. Everyone signs in at /login with their email.`} />
      {sp.error === "owner" && (
        <p role="alert" className="notice notice-error mb-6">
          Only owners can change an owner, or make someone an owner.
        </p>
      )}
      {typeof sp.changed === "string" && (
        <p role="status" className="notice mb-6">
          {sp.changed}.
        </p>
      )}
      <div className="flex flex-col gap-6">
        <div>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {users.map((u) => {
              const editable = u.id !== me.id && (isOwner || u.role !== "owner");
              return (
                <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="flex size-8 items-center justify-center rounded-full bg-sunken text-[13px] font-semibold">{u.name.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-[12rem] flex-1">
                    <span className="block font-medium">
                      {u.name} {u.id === me.id && <span className="text-[12px] font-normal text-muted">(you)</span>}
                    </span>
                    <span className="block truncate text-[12px] text-muted">
                      {u.email} · joined {timeAgo(u.created_at)}
                    </span>
                  </span>
                  {editable ? (
                    <>
                      <form action={setRoleAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="id" value={u.id} />
                        <select name="role" defaultValue={u.role} aria-label={`Role for ${u.name}`} className="field h-8 w-auto text-[13px]">
                          {choices.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                        <SubmitButton className="btn btn-sm" pendingLabel="Saving…">
                          Change
                        </SubmitButton>
                      </form>
                      <LinkAction action={resetLinkAction} id={u.id} label="Reset password" pendingLabel="Making a link…" />
                      <form action={removeUserAction}>
                        <input type="hidden" name="id" value={u.id} />
                        <SubmitButton className="btn btn-quiet btn-danger btn-sm" pendingLabel="Removing…">
                          Remove
                        </SubmitButton>
                      </form>
                    </>
                  ) : (
                    <span className="chip">{roleLabel(u.role)}</span>
                  )}
                </li>
              );
            })}
            {invitations.map((inv) => {
              const editable = isOwner || inv.role !== "owner";
              return (
                <li key={`invite-${inv.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="flex size-8 items-center justify-center rounded-full border border-dashed border-line-strong text-[13px] text-muted">
                    {inv.email.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-[12rem] flex-1">
                    <span className="flex items-center gap-2 font-medium">
                      <span className="truncate">{inv.email}</span>
                      <span className="chip">Pending</span>
                    </span>
                    <span className="block truncate text-[12px] text-muted">
                      {roleLabel(inv.role)} · invited {inv.invited_by_name ? `by ${inv.invited_by_name} ` : ""}
                      {timeAgo(inv.created_at)} · link works until {formatDate(inv.expires_at)}
                    </span>
                  </span>
                  {editable && (
                    <>
                      <LinkAction action={invitationLinkAction} id={inv.id} label={canEmail ? "Resend" : "New link"} pendingLabel="Sending…" />
                      <form action={revokeInvitationAction}>
                        <input type="hidden" name="id" value={inv.id} />
                        <SubmitButton className="btn btn-quiet btn-danger btn-sm" pendingLabel="Revoking…">
                          Revoke
                        </SubmitButton>
                      </form>
                    </>
                  )}
                </li>
              );
            })}
            {users.length === 0 && invitations.length === 0 && (
              <li className="px-4 py-6 text-center text-[13px] text-muted">Nobody yet. Invite your first teammate below.</li>
            )}
          </ul>
          <p className="mt-2 text-[12px] text-muted">The setup password from the server also signs in, as an owner. Keep it somewhere safe as a way back in.</p>
        </div>

        <section>
          <h2 className="mb-1 text-[15px] font-semibold">Invite a teammate</h2>
          <p className="mb-4 text-[13px] text-muted">
            {canEmail
              ? `They get an email with a link to choose their name and password. The link works for ${INVITE_DAYS} days.`
              : `You'll get a link to send them; it works for ${INVITE_DAYS} days. Set up Settings → Email delivery and invitations go out by email.`}
          </p>
          <ActionPanel action={inviteAction} submitLabel="Invite to team" className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
              <div>
                <label className="label" htmlFor="tm-email">
                  Email
                </label>
                <input id="tm-email" name="email" type="email" required className="field" />
              </div>
              <div>
                <label className="label" htmlFor="tm-role">
                  Role
                </label>
                <select id="tm-role" name="role" defaultValue="contributor" className="field">
                  {choices.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </ActionPanel>
          <dl className="mt-4 grid gap-1.5 text-[13px]">
            {ROLES.map((r) => (
              <div key={r.value} className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium">{r.label}</dt>
                <dd className="text-muted">{r.blurb}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}
