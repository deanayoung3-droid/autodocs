import { Suspense } from "react";
import {
  IconBell,
  IconBolt,
  IconBook,
  IconChart,
  IconChat,
  IconDatabase,
  IconGear,
  IconGlobe,
  IconInbox,
  IconKey,
  IconLock,
  IconOpenAI,
  IconPalette,
  IconSpark,
  IconUser,
  IconUsers,
  IconWebhook,
} from "@/components/icons";
import { requireAdmin } from "@/lib/auth";
import { canManage } from "@/lib/users";
import { SecondaryNav, SubnavShell } from "../secondary";

const ACCOUNT = {
  label: "Account",
  items: [
    { href: "/admin/settings/profile", label: "Profile", icon: <IconUser size={15} /> },
    { href: "/admin/settings/notifications", label: "Notifications", icon: <IconBell size={15} /> },
    { href: "/admin/settings/security", label: "Security", icon: <IconLock size={15} /> },
    { href: "/admin/settings/extension", label: "Chrome extension", icon: <IconGlobe size={15} /> },
  ],
};

export default async function SettingsLayout({ children }: LayoutProps<"/admin/settings">) {
  const user = await requireAdmin();
  const groups = canManage(user)
    ? [
        {
          label: "Workspace",
          items: [
            { href: "/admin/settings", label: "General", icon: <IconGear size={15} />, exact: true },
            { href: "/admin/settings/team", label: "Team", icon: <IconUsers size={15} /> },
            { href: "/admin/settings/usage", label: "Usage", icon: <IconChart size={15} /> },
            { href: "/admin/settings/email", label: "Email delivery", icon: <IconInbox size={15} /> },
            { href: "/admin/settings/data", label: "Import & export", icon: <IconDatabase size={15} /> },
          ],
        },
        {
          label: "Docs Agent",
          items: [
            { href: "/admin/settings/assistant", label: "AI Assistant", icon: <IconChat size={15} /> },
            { href: "/admin/settings/about", label: "About you", icon: <IconBook size={15} /> },
            { href: "/admin/settings/customize", label: "Customize", icon: <IconPalette size={15} /> },
            { href: "/admin/settings/automations", label: "Automations", icon: <IconBolt size={15} /> },
            { href: "/admin/settings/email-agent", label: "Email Docs Agent", icon: <IconSpark size={15} /> },
            { href: "/admin/settings/ai", label: "AI models", icon: <IconOpenAI size={15} /> },
          ],
        },
        {
          label: "Developers",
          items: [
            { href: "/admin/settings/api", label: "API", icon: <IconKey size={15} /> },
            { href: "/admin/settings/webhooks", label: "Webhooks", icon: <IconWebhook size={15} /> },
          ],
        },
        ACCOUNT,
      ]
    : [ACCOUNT];
  return (
    <SubnavShell
      nav={
        <Suspense>
          <SecondaryNav title="Settings" groups={groups} />
        </Suspense>
      }
    >
      <div className="mx-auto max-w-[608px] px-4 pt-8 pb-16 md:px-8 md:pt-16">{children}</div>
    </SubnavShell>
  );
}
