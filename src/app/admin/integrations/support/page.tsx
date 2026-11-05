import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { IconBook, IconInbox, IconPlug, IconSearch } from "@/components/icons";
import { getIntegration, publicOrigin } from "@/lib/integrations";
import { listConversations, supportConfig, supportStats } from "@/lib/support";
import { CodeBlock } from "../../settings/platform-forms";
import { Capabilities, ConnectionCard, ConnectionHeader, DetailsCard } from "../connection";
import { managerGate } from "../../managers-only";
import { ConversationList, DraftingCard } from "./parts";

const CAPABILITIES = [
  { icon: <IconSearch size={15} />, text: "Find questions your help center doesn't answer" },
  { icon: <IconBook size={15} />, text: "Draft articles from how support resolved them" },
  { icon: <IconPlug size={15} />, text: "Works with any helpdesk that can call a URL" },
];

// Job: an owner is wiring their helpdesk so resolved conversations reveal doc gaps; next they send one.
export default async function SupportEndpointPage() {
  await connection();
  const gate = await managerGate("integrations");
  if (gate) return gate;
  const h = await headers();
  const origin = publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`);
  const [meta, stats, conversations, config] = await Promise.all([getIntegration("support"), supportStats(), listConversations(15), supportConfig()]);
  const endpoint = `${origin}/api/v1/support/conversations`;
  const example = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer cd_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "id": "conv_8812",
    "subject": "Can I export a case to PDF?",
    "source": "intercom",
    "messages": [
      { "from": "customer", "text": "How do I export a case as a PDF?" },
      { "from": "agent", "text": "Open the case, then More → Export → PDF." }
    ]
  }'`;

  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 md:px-8 md:py-14">
      <ConnectionHeader
        icon={<IconInbox size={21} />}
        name={meta?.label || "Support Endpoint"}
        status={
          stats.total
            ? `${stats.total} ${stats.total === 1 ? "conversation" : "conversations"} received · ${stats.gaps} ${stats.gaps === 1 ? "gap" : "gaps"} found`
            : "Waiting for the first conversation"
        }
      />
      <div className="flex flex-col gap-6">
        <Capabilities items={CAPABILITIES} />
        {stats.total > 0 && <DetailsCard kind="support" label={meta?.label ?? ""} description={meta?.description ?? ""} defaultLabel="Support Endpoint" />}

        <ConnectionCard title="Send conversations" description="Have your helpdesk call this when a conversation is resolved. Sending the same id again replaces it.">
          <div className="flex flex-col gap-4 px-5 py-4">
            <CodeBlock label="Example" value={example} />
            <p className="text-[13px] text-graphite">
              Authenticate with an API key from{" "}
              <Link href="/admin/settings/api" className="link">
                Settings → API
              </Link>
              . <code>messages</code> can be replaced by a plain <code>transcript</code>; <code>from</code> is <code>customer</code> or <code>agent</code>.
              Intercom, Zendesk, Help Scout, and ten other helpdesks{" "}
              <Link href="/admin/integrations/connect" className="link">
                connect directly
              </Link>
              ; use this for any other tool that can call a URL when a conversation closes.
            </p>
          </div>
        </ConnectionCard>

        <DraftingCard autoDraft={config.autoDraft} waiting={stats.waiting} />
        <ConversationList conversations={conversations} empty="Nothing yet. Send a resolved conversation with the example above and it shows up here." />
      </div>
    </div>
  );
}
