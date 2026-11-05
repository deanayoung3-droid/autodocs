import { requireAdmin } from "@/lib/auth";
import { canManage, roleLabel } from "@/lib/users";

/**
 * For pages that change the workspace. Call it first thing in the page, before loading anything:
 * Next renders a page alongside its layouts, so only the page itself can keep its data from a
 * contributor. Returns what to show instead, or null for admins and owners.
 */
export async function managerGate(what: string) {
  const user = await requireAdmin();
  if (canManage(user)) return null;
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <p className="font-semibold">Admins and owners only</p>
      <p className="mt-1.5 text-[13.5px] text-muted">
        You&rsquo;re a {roleLabel(user.role).toLowerCase()}, so you can write drafts and work with Docs Agent, but {what} can only be changed by an admin or
        owner. Ask one of them on your team.
      </p>
    </div>
  );
}
