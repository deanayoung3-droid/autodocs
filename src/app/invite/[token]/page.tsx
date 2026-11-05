import Link from "next/link";
import { connection } from "next/server";
import { findInvitation } from "@/lib/invitations";
import { getSettings } from "@/lib/settings";
import { findUserByEmail, roleLabel } from "@/lib/users";
import { AuthCard } from "../../login/auth-card";
import { AcceptInvitationForm } from "../../login/forms";

// Job: someone opened their invitation email; next they pick a name and password and land in the admin.
export default async function InvitationPage({ params }: PageProps<"/invite/[token]">) {
  await connection();
  const { token } = await params;
  const [found, { brandName }] = await Promise.all([findInvitation(token), getSettings()]);
  if (found.state !== "ok") {
    const title = found.state === "used" ? "You've already joined" : found.state === "expired" ? "This invitation has expired" : "This invitation isn't valid";
    const description =
      found.state === "used"
        ? "This invitation was accepted. Sign in with your email and password."
        : "Ask whoever invited you to send a new one from Settings → Team.";
    return (
      <AuthCard title={title} description={description}>
        <Link href="/login" className="btn btn-primary w-full">
          Go to sign in
        </Link>
      </AuthCard>
    );
  }
  const { invitation } = found;
  if (await findUserByEmail(invitation.email)) {
    return (
      <AuthCard title="You already have an account" description={`${invitation.email} can already sign in to ${brandName}.`}>
        <Link href="/login" className="btn btn-primary w-full">
          Sign in
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title={`Join ${brandName}`}
      description={`${invitation.invited_by_name || "Your team"} invited you to the docs workspace as ${roleLabel(invitation.role).toLowerCase()}.`}
    >
      <AcceptInvitationForm token={token} email={invitation.email} />
    </AuthCard>
  );
}
