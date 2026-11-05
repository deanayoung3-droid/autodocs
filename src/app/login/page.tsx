import { connection } from "next/server";
import { adminPasswordConfigured } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { AuthCard } from "./auth-card";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  await connection();
  const { next } = await searchParams;
  const settings = await getSettings();

  return (
    <AuthCard title="Sign in" description={`Welcome back to the ${settings.brandName} docs workspace.`}>
      {adminPasswordConfigured() ? (
        <LoginForm next={typeof next === "string" ? next : "/admin"} />
      ) : (
        <p className="notice">
          No admin password is set. Add <code>ADMIN_PASSWORD</code> to the server&rsquo;s <code>.env</code> file and restart it.
        </p>
      )}
    </AuthCard>
  );
}
