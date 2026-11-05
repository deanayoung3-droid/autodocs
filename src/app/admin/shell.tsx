"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BrandMark,
  IconBook,
  IconChart,
  IconChevronDown,
  IconChevronUp,
  IconExternal,
  IconGear,
  IconHelp,
  IconHome,
  IconLogout,
  IconMcp,
  IconPaw,
  IconPlug,
  IconShield,
  IconUser,
  IconUsers,
  IconWidget,
  IconChat,
} from "@/components/icons";

type Item = { href: string; label: string; icon: ReactNode; exact?: boolean; badge?: number; tone?: "accent" | "you" };

/** A small dropdown: closes on outside click, Escape, or choosing an item. */
export function Menu({
  button,
  children,
  align = "bottom",
  className = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-well",
  label,
}: {
  button: ReactNode;
  children: ReactNode;
  align?: "bottom" | "top" | "right";
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const place = align === "top" ? "bottom-full left-0 mb-1.5" : align === "right" ? "top-full right-0 mt-1.5" : "top-full left-0 mt-1.5";
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)} className={className}>
        {button}
      </button>
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className={`pop-in absolute z-40 w-56 rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow-pop)] ${place}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export const menuItem =
  "flex h-8 w-full items-center gap-2 rounded px-2 text-left text-sm text-graphite transition-colors hover:bg-well hover:text-ink";

export function PrimaryNav({
  brandName,
  icon,
  avatar,
  user,
  pending,
  flagged,
  signOut,
}: {
  brandName: string;
  /** Uploaded workspace icon and profile photo, as URLs. */
  icon?: string;
  avatar?: string;
  user: { name: string; email: string; role: string };
  pending: number;
  flagged: number;
  signOut: () => Promise<void>;
}) {
  const path = usePathname();
  const work: Item[] = [
    { href: "/admin", label: "Home", icon: <IconHome size={16} />, exact: true },
    { href: "/admin/agent", label: "Docs Agent", icon: <IconPaw size={16} />, badge: pending, tone: "accent" },
    { href: "/admin/verification", label: "Verification", icon: <IconShield size={16} />, badge: flagged, tone: "you" },
  ];
  const product: Item[] = [
    { href: "/admin/help-center", label: "Help Center", icon: <IconBook size={16} /> },
    { href: "/admin/widgets", label: "Widget", icon: <IconWidget size={16} /> },
    { href: "/admin/integrations", label: "Integrations", icon: <IconPlug size={16} /> },
    { href: "/admin/mcp", label: "MCP", icon: <IconMcp size={16} /> },
    { href: "/admin/reporting", label: "Reporting", icon: <IconChart size={16} /> },
  ];

  const link = (i: Item) => {
    const active = i.exact
      ? path === i.href
      : path === i.href || path.startsWith(`${i.href}/`) || (i.href === "/admin/agent" && path.startsWith("/admin/review"));
    return (
      <Link
        key={i.href}
        href={i.href}
        aria-current={active ? "page" : undefined}
        className={`flex h-8 w-full shrink-0 items-center gap-2 rounded border px-2 text-left text-sm transition-colors duration-75 ${
          active ? "border-line bg-surface font-medium text-ink" : "border-transparent text-graphite hover:bg-well"
        }`}
      >
        <span className="flex shrink-0">{i.icon}</span>
        <span className="flex-1 whitespace-nowrap">{i.label}</span>
        {Boolean(i.badge) && (
          <span className={`count ${i.tone === "accent" ? "bg-accent-soft text-accent-strong" : ""}`} aria-label={`${i.badge} waiting`}>
            {i.badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <aside className="flex flex-col gap-3 border-b border-line bg-ground px-4 py-3 md:sticky md:top-0 md:h-dvh md:w-[208px] md:shrink-0 md:gap-0 md:border-r md:border-b-0 md:px-0 md:pt-6 md:pb-4">
      <div className="md:px-4">
        <Menu
          className="flex h-7 w-full items-center gap-2 rounded-xs pl-2 text-left"
          button={
            <>
              {icon ? (
                // eslint-disable-next-line @next/next/no-img-element -- served by our own file route
                <img src={icon} alt="" className="size-5 shrink-0 rounded-xs object-cover" />
              ) : (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-xs bg-ink-strong text-white">
                  <BrandMark size={11} />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{brandName}</span>
              <IconChevronDown size={14} className="text-faint" />
            </>
          }
        >
          <Link href="/admin/settings" className={menuItem} role="menuitem">
            <IconGear size={15} /> Workspace settings
          </Link>
          <Link href="/admin/settings/team" className={menuItem} role="menuitem">
            <IconUsers size={15} /> Team
          </Link>
          <a href="/help" target="_blank" className={menuItem} role="menuitem">
            <IconExternal size={15} /> View help center
          </a>
        </Menu>
      </div>

      <nav aria-label="Main" className="slim-scroll flex gap-0.5 overflow-x-auto md:mt-6 md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto md:px-4">
        <div className="flex gap-0.5 md:flex-col">{work.map(link)}</div>
        <div className="my-3 hidden h-px flex-none bg-line md:block" />
        <div className="flex gap-0.5 md:flex-col">{product.map(link)}</div>
      </nav>

      <div className="hidden flex-col gap-0.5 md:flex md:px-4">
        <a href="/help" target="_blank" className="flex h-8 w-full items-center gap-2 rounded px-2 text-sm text-graphite transition-colors hover:bg-well">
          <IconHelp size={16} /> Need help?
        </a>
        <Menu
          align="top"
          className="flex h-9 w-full items-center gap-2 rounded border border-transparent px-2 text-left transition-colors hover:bg-well"
          button={
            <>
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element -- served by our own file route
                <img src={avatar} alt="" className="size-6 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink-strong text-[11px] font-semibold text-white">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{user.name}</span>
              <IconChevronUp size={14} className="text-faint" />
            </>
          }
        >
          <p className="truncate px-2 pt-1.5 pb-1 text-xs text-muted">{user.email || (user.role === "owner" ? "Owner" : user.role === "admin" ? "Admin" : "Contributor")}</p>
          <Link href="/admin/settings/profile" className={menuItem} role="menuitem">
            <IconUser size={15} /> Profile
          </Link>
          <Link href="/admin/settings" className={menuItem} role="menuitem">
            <IconGear size={15} /> Settings
          </Link>
          <form action={signOut}>
            <button className={menuItem} role="menuitem">
              <IconLogout size={15} /> Sign out
            </button>
          </form>
        </Menu>
      </div>
    </aside>
  );
}
