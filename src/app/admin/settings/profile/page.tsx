import { connection } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prefsFor } from "@/lib/notify";
import { fileUrl } from "@/lib/storage";
import { roleLabel } from "@/lib/users";
import { signOutAction } from "../../actions";
import { PageHeader, Section } from "../../secondary";
import { deleteAccountAction, removeAvatarAction, saveProfileAction, uploadAvatarAction } from "../../settings-actions";
import { SubmitButton } from "../../ui";
import { ActionPanel } from "../platform-forms";

// Job: a person is checking how they appear to the team; next they change their name or photo.
export default async function ProfilePage() {
  await connection();
  const user = await requireAdmin();
  const builtIn = user.id === 0;
  const prefs = await prefsFor(user.id);
  const initial = (user.name || "?").trim().charAt(0).toUpperCase();

  return (
    <>
      <PageHeader eyebrow="Account" title="Profile" description={builtIn ? `Built-in ${roleLabel(user.role).toLowerCase()}` : `${user.email} · ${roleLabel(user.role)}`} />
      <div className="flex flex-col gap-6">
        <Section title="Photo" description="Shown next to your name in the admin.">
          <div className="flex flex-wrap items-center gap-4">
            {prefs.avatar_key ? (
              // eslint-disable-next-line @next/next/no-img-element -- served by our own file route
              <img src={fileUrl(prefs.avatar_key)} alt="" className="size-16 rounded-full border border-line object-cover" />
            ) : (
              <span aria-hidden className="flex size-16 items-center justify-center rounded-full bg-sunken text-[22px] font-semibold text-muted">
                {initial}
              </span>
            )}
            <ActionPanel action={uploadAvatarAction} submitLabel="Upload" className="flex flex-wrap items-center gap-2">
              <input name="photo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required aria-label="Photo" className="text-[13px]" />
            </ActionPanel>
            {prefs.avatar_key && (
              <form action={removeAvatarAction}>
                <SubmitButton className="btn btn-quiet btn-sm" pendingLabel="Removing…">
                  Remove
                </SubmitButton>
              </form>
            )}
          </div>
        </Section>

        <Section title="Your details">
          {builtIn ? (
            <p className="notice">
              The built-in owner signs in with <code>ADMIN_PASSWORD</code> from the server&rsquo;s environment, so its name can&rsquo;t be changed
              here. Add yourself under Team to get your own sign-in.
            </p>
          ) : (
            <ActionPanel action={saveProfileAction} submitLabel="Save profile">
              <div className="max-w-sm">
                <label className="label" htmlFor="pf-name">
                  Name
                </label>
                <input id="pf-name" name="name" defaultValue={user.name} className="field" autoComplete="name" />
              </div>
            </ActionPanel>
          )}
        </Section>

        <Section title="Sign out" description="Ends your session on this browser.">
          <form action={signOutAction}>
            <SubmitButton className="btn" pendingLabel="Signing out…">
              Sign out
            </SubmitButton>
          </form>
        </Section>

        {!builtIn && (
          <Section title="Delete account" description="Removes your sign-in. Articles and threads you worked on stay with the workspace.">
            <ActionPanel action={deleteAccountAction} submitLabel="Delete my account" className="flex flex-col gap-3">
              <div className="max-w-sm">
                <label className="label" htmlFor="pf-confirm">
                  Type <span className="font-mono">{user.email}</span> to confirm
                </label>
                <input id="pf-confirm" name="confirm" autoComplete="off" className="field" />
              </div>
            </ActionPanel>
          </Section>
        )}
      </div>
    </>
  );
}
