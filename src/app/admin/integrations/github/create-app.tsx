"use client";

import { useState } from "react";

/**
 * Posts GitHub's app-manifest form: GitHub shows the app it's about to create, you confirm, and
 * GitHub sends you back here with its credentials. `actions` maps an organization (or "") to the
 * signed form address the server prepared.
 */
export function CreateGitHubApp({ manifest, personalAction, orgActionBase, state, defaultOrg }: { manifest: string; personalAction: string; orgActionBase: string; state: string; defaultOrg: string }) {
  const [org, setOrg] = useState(defaultOrg);
  const action = org.trim() ? `${orgActionBase.replace("{org}", encodeURIComponent(org.trim()))}?state=${encodeURIComponent(state)}` : personalAction;
  return (
    <form method="post" action={action} className="flex flex-col gap-3 px-5 py-4">
      <input type="hidden" name="manifest" value={manifest} />
      <div>
        <label className="label" htmlFor="gh-org">
          GitHub organization
        </label>
        <input id="gh-org" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Leave empty for your personal account" className="field max-w-sm font-mono text-[13px]" />
        <p className="mt-1.5 text-[13px] text-muted">Create the app under the organization that owns your code, so it can be installed there. You need to be an owner of it.</p>
      </div>
      <div>
        <button type="submit" className="btn btn-primary">
          Create the GitHub App
        </button>
      </div>
    </form>
  );
}
