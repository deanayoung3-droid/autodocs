import "server-only";
import type { ReactNode } from "react";
import { IconGithub, IconInbox, IconLinear, IconMcp, IconMonitor, IconOpenAI, IconSlack } from "@/components/icons";
import { aiConfigured } from "@/lib/ai";
import { listDashboards } from "@/lib/capture";
import { timeAgo } from "@/lib/format";
import { canResearch } from "@/lib/github";
import { githubConfig, includedRepositories } from "@/lib/github-app";
import { connectedHelpdesks, helpdeskInfo, type HelpdeskId } from "@/lib/helpdesks";
import { inboxStatus } from "@/lib/inbox";
import { linearConfig } from "@/lib/linear";
import { getSettings, secretStatus } from "@/lib/settings";
import { slackSecretSource } from "@/lib/slack";
import { supportStats } from "@/lib/support";
import { HelpdeskMark } from "./helpdesk/panels";

export type Category = "Get started" | "Support tooling" | "AI clients" | "Product context" | "Workflow" | "Codebase";
export const CATEGORIES: Category[] = ["Get started", "Support tooling", "AI clients", "Product context", "Workflow", "Codebase"];

export type CatalogItem = {
  id: string;
  name: string;
  icon: ReactNode;
  href: string;
  categories: Category[];
  connected: boolean;
  /** What it's doing now, for connected ones. */
  status: string;
  pitch: string;
};

/** Everything that can connect to the docs, with whether it is connected right now. */
export async function integrationCatalog(): Promise<CatalogItem[]> {
  const [s, dashboards, gh, ghRepos, linear, support, inbox, slack, helpdesks] = await Promise.all([
    getSettings(),
    listDashboards(),
    githubConfig(),
    includedRepositories(),
    linearConfig(),
    supportStats(),
    inboxStatus(),
    slackSecretSource(),
    connectedHelpdesks(),
  ]);
  const secrets = secretStatus();
  const ghApp = Boolean(gh.installationId);
  const ghLegacy = !ghApp && canResearch(s.githubRepo);
  const deskStatus = (id: HelpdeskId) => {
    const d = helpdesks.get(id);
    if (!d) return "";
    return `${d.account}${d.lastError ? " · needs attention" : d.lastSyncAt ? ` · checked ${timeAgo(d.lastSyncAt)}` : ""}`;
  };
  const desk = (id: HelpdeskId): CatalogItem => {
    const info = helpdeskInfo(id);
    return {
      id,
      name: info.name,
      icon: <HelpdeskMark name={info.name} />,
      href: `/admin/integrations/helpdesk/${id}`,
      categories: ["Support tooling"],
      connected: helpdesks.has(id),
      status: deskStatus(id),
      pitch: `Let Docs Agent find documentation gaps from ${info.items} in ${info.name}.`,
    };
  };
  const supportChannel = helpdesks.get("slack-support");
  return [
    {
      id: "dashboard",
      name: "Dashboard",
      icon: <IconMonitor size={21} />,
      href: "/admin/integrations/dashboard",
      categories: ["Get started", "Product context"],
      connected: dashboards.length > 0,
      status: dashboards.length
        ? `${dashboards.map((d) => d.name).join(", ")}${dashboards.some((d) => d.last_error) ? " · sign-in needs attention" : ""}${inbox.imap || inbox.forwardingKey ? " · login email on" : ""}`
        : "",
      pitch: "Docs Agent signs in to your product with a test account and captures screenshots with red boxes.",
    },
    {
      id: "github",
      name: "GitHub",
      icon: <IconGithub size={22} />,
      href: "/admin/integrations/github",
      categories: ["Get started", "Codebase"],
      connected: ghApp || ghLegacy,
      status: ghApp
        ? `${gh.account} · ${ghRepos.length} ${ghRepos.length === 1 ? "repository" : "repositories"}`
        : ghLegacy
          ? `Reading ${s.githubRepo}${secrets.webhookSecret ? " · webhook on" : ""}`
          : "",
      pitch: "Docs Agent reads your code to write and verify docs, and drafts updates from merged pull requests.",
    },
    {
      id: "openai",
      name: "OpenAI",
      icon: <IconOpenAI size={22} />,
      href: "/admin/settings/ai",
      categories: ["Get started", "Product context"],
      connected: aiConfigured(),
      status: aiConfigured() ? "API key set · Docs Agent, AI search, screenshots, and answers" : "",
      pitch: "Powers Docs Agent, AI search, screenshots, and customer answers through the OpenAI API.",
    },
    desk("fernand"),
    desk("intercom"),
    desk("helpscout"),
    {
      id: "slack",
      name: "Slack",
      icon: <IconSlack size={20} />,
      href: "/admin/integrations/slack",
      categories: ["Get started", "Support tooling", "Workflow"],
      connected: Boolean(slack) || Boolean(supportChannel),
      status: [slack ? "The /docs command is on" : "", supportChannel ? `Reading ${deskStatus("slack-support")}` : ""].filter(Boolean).join(" · "),
      pitch: "Ask Docs Agent to draft articles from Slack with /docs, and find doc gaps in your support channel.",
    },
    desk("hubspot"),
    desk("pylon"),
    desk("plain"),
    desk("zendesk"),
    desk("missive"),
    desk("crisp"),
    desk("discord"),
    desk("gmail"),
    desk("bolddesk"),
    {
      id: "support",
      name: "Support Endpoint",
      icon: <IconInbox size={21} />,
      href: "/admin/integrations/support",
      categories: ["Support tooling"],
      connected: support.total > 0,
      status: support.total ? `${support.total} conversations · ${support.gaps} gaps found` : "",
      pitch: "Any helpdesk sends resolved conversations; Docs Agent finds the questions your docs don't answer.",
    },
    {
      id: "mcp",
      name: "MCP server",
      icon: <IconMcp size={21} />,
      href: "/admin/mcp",
      categories: ["AI clients"],
      connected: false,
      status: "",
      pitch: "Search and read your help center from Claude, ChatGPT, Cursor, and other MCP clients.",
    },
    {
      id: "linear",
      name: "Linear",
      icon: <IconLinear size={19} />,
      href: "/admin/integrations/linear",
      categories: ["Workflow"],
      connected: Boolean(linear.organizationId),
      status: linear.organizationId ? `${linear.organizationName} · mention ${linear.appUserName || "Docs Agent"} on an issue` : "",
      pitch: "Mention or assign Docs Agent on a Linear issue and it drafts the docs, posting progress in the issue.",
    },
  ];
}

export function IntegrationTile({ icon }: { icon: ReactNode }) {
  return <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink shadow-[var(--shadow-xs)]">{icon}</span>;
}
