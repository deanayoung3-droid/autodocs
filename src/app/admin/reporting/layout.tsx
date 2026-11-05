import { Suspense } from "react";
import { IconChart, IconChat, IconFile, IconSearch, IconSpark, IconCheck } from "@/components/icons";
import { SecondaryNav, SubnavShell } from "../secondary";

export default function ReportingLayout({ children }: LayoutProps<"/admin/reporting">) {
  return (
    <SubnavShell
      nav={
        <Suspense>
          <SecondaryNav
            title="Reporting"
            groups={[
              {
                label: "Help center",
                items: [
                  { href: "/admin/reporting/overview", label: "Overview", icon: <IconChart size={15} /> },
                  { href: "/admin/reporting/articles", label: "Articles", icon: <IconFile size={15} /> },
                  { href: "/admin/reporting/searches", label: "Searches", icon: <IconSearch size={15} /> },
                  { href: "/admin/reporting/feedback", label: "Feedback", icon: <IconCheck size={15} /> },
                ],
              },
              {
                label: "Intelligence",
                items: [
                  { href: "/admin/reporting/trends", label: "Support trends", icon: <IconSpark size={15} /> },
                  { href: "/admin/reporting/conversations", label: "AI conversations", icon: <IconChat size={15} /> },
                ],
              },
            ]}
          />
        </Suspense>
      }
    >
      {children}
    </SubnavShell>
  );
}
