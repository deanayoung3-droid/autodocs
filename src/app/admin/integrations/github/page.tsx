import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { IconBook, IconCode, IconGithub, IconSpark } from "@/components/icons";
import { signState } from "@/lib/crypto";
import { timeAgo } from "@/lib/format";
import { appManifest, githubConfig, installUrl, listRepositories, manifestFormAction } from "@/lib/github-app";
import { getIntegration, publicOrigin, reachableFromInternet } from "@/lib/integrations";
import { getSettings } from "@/lib/settings";
import { disconnectGitHubAction } from "../../integration-actions";
import { SubmitButton } from "../../ui";
import { Capabilities, ConnectionCard, ConnectionHeader, DetailsCard } from "../connection";
import { CreateGitHubApp } from "./create-app";
import { Repositories } from "./repos";
import { managerGate } from "../../managers-only";
import { PRODUCT_NAME } from "@/lib/product";

const CAPABILITIES = [
  { icon: <IconCode size={15} />, text: "Draft articles based on your product's code" },
  { icon: <IconSpark size={15} />, text: "Draft documentation updates when pull requests merge" },
  { icon: <IconBook size={15} />, text: "Check published articles against the code" },
];

const ERRORS: Record<string, string> = {
  signin: "Sign in first, then connect GitHub again.",
  state: "That GitHub link is out of date or didn't start here. Start again from this page.",
  nocode: "GitHub didn't send the app back. Start again.",
  noinstall: "GitHub didn't say which installation to use. Install the app again.",
};

// Job: an owner is connecting the code Docs Agent reads, and next they choose which repositories it uses.
export default async function GitHubIntegrationPage({ searchParams }: PageProps<"/admin/integrations/github">) {
  await connection();
  const gate = await managerGate("integrations");
  if (gate) return gate;
  const sp = await searchParams;
  const h = await headers();
  const origin = publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`);
  const [config, meta, repos, settings, install] = await Promise.all([githubConfig(), getIntegration("github"), listRepositories(), getSettings(), installUrl()]);
  const connected = Boolean(config.installationId);
  const reachable = reachableFromInternet(origin);
  const error = typeof sp.error === "string" ? (ERRORS[sp.error] ?? sp.error) : "";

  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 md:px-8 md:py-14">
      <ConnectionHeader
        icon={<IconGithub size={22} />}
        name={meta?.label || "GitHub"}
        status={connected ? `Connected ${meta?.connected_at ? timeAgo(meta.connected_at) : ""} · ${config.account ?? ""}` : config.slug ? "App created, not installed yet" : "Not connected"}
        actions={
          connected ? (
            <>
              {install && (
                <a href={install} className="btn btn-sm">
                  Configure on GitHub
                </a>
              )}
              <form action={disconnectGitHubAction}>
                <SubmitButton className="btn btn-sm btn-danger" pendingLabel="Disconnecting…">
                  Disconnect
                </SubmitButton>
              </form>
            </>
          ) : undefined
        }
      />
      {error && (
        <p role="alert" className="notice notice-error mb-6">
          {error}
        </p>
      )}
      {sp.connected && connected && (
        <p role="status" className="notice mb-6">
          GitHub is connected. Choose the repositories Docs Agent should use below.
        </p>
      )}
      {sp.disconnected && !connected && (
        <p role="status" className="notice mb-6">
          GitHub is disconnected and Docs Agent no longer reads your code. The app stays on GitHub until you uninstall it there.
        </p>
      )}

      <div className="flex flex-col gap-6">
        <Capabilities items={CAPABILITIES} />
        {connected && <DetailsCard kind="github" label={meta?.label ?? ""} description={meta?.description ?? ""} defaultLabel="GitHub" />}

        {!config.slug && (
          <ConnectionCard
            title="Connect GitHub"
            description="Creates a private GitHub App for this workspace with read-only access to code and pull requests. You confirm it on GitHub, then choose its repositories."
          >
            <CreateGitHubApp
              manifest={JSON.stringify(appManifest(origin, `${PRODUCT_NAME} for ${settings.brandName}`))}
              personalAction={manifestFormAction("")}
              orgActionBase="https://github.com/organizations/{org}/settings/apps/new"
              state={signState({ purpose: "github-manifest" })}
              defaultOrg=""
            />
          </ConnectionCard>
        )}

        {config.slug && !connected && install && (
          <ConnectionCard title="Install the app" description={`The app ${config.slug} exists on GitHub. Install it on the repositories Docs Agent should read.`}>
            <div className="flex flex-wrap items-center gap-3 px-5 py-4">
              <a href={install} className="btn btn-primary">
                Install on GitHub
              </a>
              {config.appUrl && (
                <a href={config.appUrl} className="link text-[13px]">
                  View the app on GitHub
                </a>
              )}
            </div>
          </ConnectionCard>
        )}

        {connected && (
          <ConnectionCard title="Repositories" description="Choose the code Docs Agent uses in this workspace, and the branch that counts as shipped.">
            <Repositories repos={repos} />
          </ConnectionCard>
        )}

        {connected && (
          <ConnectionCard title="Pull request drafts" description="Pull requests merged into a repository's production branch are screened for docs changes.">
            <div className="flex flex-col gap-3 px-5 py-4 text-[13px] text-graphite">
              {reachable ? (
                <p>GitHub delivers merges to this workspace as they happen.</p>
              ) : (
                <p className="notice">
                  This server runs at {origin}, which GitHub can&rsquo;t reach, so merges aren&rsquo;t delivered here. Code research and verification work. Connect GitHub from the deployed
                  workspace at its public address and merges arrive there automatically.
                </p>
              )}
              <p className="text-muted">
                Drafting from merges is {settings.autoScreenPRs ? "on" : "off"} in{" "}
                <Link href="/admin/settings/automations" className="link">
                  Automations
                </Link>
                .
              </p>
            </div>
          </ConnectionCard>
        )}
      </div>
    </div>
  );
}
