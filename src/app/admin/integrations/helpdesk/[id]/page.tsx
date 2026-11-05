import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { IconBook, IconClock, IconSearch } from "@/components/icons";
import { timeAgo } from "@/lib/format";
import { helpdeskInfo, helpdeskState, isHelpdesk } from "@/lib/helpdesks";
import { disconnectHelpdeskAction } from "../../../integration-actions";
import { managerGate } from "../../../managers-only";
import { SubmitButton } from "../../../ui";
import { Capabilities, ConnectionHeader, DetailsCard } from "../../connection";
import { HelpdeskMark, HelpdeskPanels } from "../panels";

// Job: an owner is connecting the team's helpdesk so resolved conversations reveal doc gaps;
// next they check what the first read found.
export default async function HelpdeskPage({ params, searchParams }: PageProps<"/admin/integrations/helpdesk/[id]">) {
  await connection();
  const gate = await managerGate("integrations");
  if (gate) return gate;
  const { id } = await params;
  if (id === "slack-support") redirect("/admin/integrations/slack");
  if (!isHelpdesk(id)) notFound();
  const sp = await searchParams;
  const info = helpdeskInfo(id);
  const state = await helpdeskState(id);

  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 md:px-8 md:py-14">
      <ConnectionHeader
        icon={<HelpdeskMark name={info.name} />}
        name={state.label || info.name}
        status={state.connected ? `Connected ${state.connectedAt ? timeAgo(state.connectedAt) : ""} · ${state.account}` : "Not connected"}
        actions={
          state.connected ? (
            <form action={disconnectHelpdeskAction.bind(null, id)}>
              <SubmitButton className="btn btn-sm btn-danger" pendingLabel="Disconnecting…">
                Disconnect
              </SubmitButton>
            </form>
          ) : undefined
        }
      />
      {sp.disconnected && !state.connected && (
        <p role="status" className="notice mb-6">
          {info.name} is disconnected and its credentials are deleted. Conversations already read, and drafts from them, stay.
        </p>
      )}
      <div className="flex flex-col gap-6">
        <Capabilities
          items={[
            { icon: <IconSearch size={15} />, text: `Find doc gaps in ${info.items}` },
            { icon: <IconBook size={15} />, text: "Draft fixes from how your team answered" },
            { icon: <IconClock size={15} />, text: "Reads new ones every 15 minutes" },
          ]}
        />
        {state.connected && <DetailsCard kind={id} label={state.label} description={state.description} defaultLabel={info.name} />}
        <HelpdeskPanels id={id} />
      </div>
    </div>
  );
}
