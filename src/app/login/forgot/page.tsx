import Link from "next/link";
import { connection } from "next/server";
import { AuthCard } from "../auth-card";
import { ForgotPasswordForm } from "../forms";

export default async function ForgotPasswordPage() {
  await connection();
  return (
    <AuthCard title="Reset your password" description="Enter the email you sign in with, and we'll send a link to choose a new password.">
      <ForgotPasswordForm />
      <p className="mt-5 text-center text-[13px] text-muted">
        <Link href="/login" className="hover:text-ink">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
