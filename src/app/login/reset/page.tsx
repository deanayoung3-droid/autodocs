import Link from "next/link";
import { connection } from "next/server";
import { userFromResetToken } from "@/lib/users";
import { AuthCard } from "../auth-card";
import { ResetPasswordForm } from "../forms";

export default async function ResetPasswordPage({ searchParams }: PageProps<"/login/reset">) {
  await connection();
  const { token } = await searchParams;
  const user = typeof token === "string" ? await userFromResetToken(token) : undefined;
  if (!user) {
    return (
      <AuthCard title="This link has expired" description="Reset links work for an hour, and only once.">
        <Link href="/login/forgot" className="btn btn-primary w-full">
          Get a new link
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" description={`For ${user.email}.`}>
      <ResetPasswordForm token={token as string} email={user.email} />
    </AuthCard>
  );
}
