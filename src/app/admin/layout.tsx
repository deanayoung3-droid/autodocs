import { connection } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prefsFor } from "@/lib/notify";
import { pendingCount } from "@/lib/proposals";
import { getSettings } from "@/lib/settings";
import { fileUrl } from "@/lib/storage";
import { needsReviewCount } from "@/lib/verification";
import { signOutAction } from "./actions";
import { PrimaryNav } from "./shell";
import { TaskNotifier } from "./task-notifier";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await connection();
  const user = await requireAdmin();
  const [settings, prefs] = await Promise.all([getSettings(), prefsFor(user.id)]);

  return (
    <div className="flex min-h-dvh flex-col bg-surface md:flex-row" style={{ "--accent": settings.accent } as React.CSSProperties}>
      <PrimaryNav
        brandName={settings.brandName}
        icon={settings.workspaceIcon ? fileUrl(settings.workspaceIcon) : undefined}
        avatar={prefs.avatar_key ? fileUrl(prefs.avatar_key) : undefined}
        user={{ name: user.name, email: user.email, role: user.role }}
        pending={await pendingCount()}
        flagged={await needsReviewCount()}
        signOut={signOutAction}
      />
      <main className="min-w-0 flex-1">{children}</main>
      <TaskNotifier enabled={prefs.notify_browser} />
    </div>
  );
}
