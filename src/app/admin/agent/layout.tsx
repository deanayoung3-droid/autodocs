import { connection } from "next/server";
import { aiConfigured } from "@/lib/ai";
import { SubnavShell } from "../secondary";
import { AgentNav } from "./agent-nav";
import { threadGroups } from "./thread-list";

export default async function AgentLayout({ children }: LayoutProps<"/admin/agent">) {
  await connection();
  return (
    <SubnavShell wide nav={<AgentNav groups={await threadGroups()} ai={aiConfigured()} />}>
      {children}
    </SubnavShell>
  );
}
