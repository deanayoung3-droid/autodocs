import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownerExists, ownerSetupCodeMatches } from "@/lib/users";
import { AuthCard } from "../login/auth-card";
import { CreateOwnerForm } from "../login/forms";

// Job: a brand-new install; the person who set it up creates the first owner account, then invites
// everyone else from Settings → Team. Works once: after signing in with the setup password
// (ADMIN_PASSWORD), or with the one-time link from deploy/google-cloud/owner-link.sh.
export default async function WelcomePage({ searchParams }: PageProps<"/welcome">) {
  await connection();
  if (await ownerExists()) redirect("/login");
  const { code } = await searchParams;
  const setupCode = typeof code === "string" ? code : "";
  const allowed = ownerSetupCodeMatches(setupCode) || (await currentUser())?.id === 0;
  if (!allowed) {
    return (
      <AuthCard title="Set up the workspace" description="Creating the first account needs the setup link.">
        <p className="notice">
          Sign in with the setup password (the <code>ADMIN_PASSWORD</code> you set on the server) to create the first account.
        </p>
        <Link href="/login" className="btn mt-4 w-full">
          Sign in
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Set up your help center" description="Name it and create the owner account. You'll invite everyone else from Settings → Team.">
      <CreateOwnerForm code={setupCode} />
    </AuthCard>
  );
}
