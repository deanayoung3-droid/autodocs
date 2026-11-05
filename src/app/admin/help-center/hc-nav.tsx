"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  IconBolt,
  IconChat,
  IconChevronLeft,
  IconChevronRight,
  IconCode,
  IconCopy,
  IconExternal,
  IconFile,
  IconGlobe,
  IconLanguage,
  IconLock,
  IconPalette,
  IconPlus,
  IconSearch,
  IconSpark,
  IconWebhook,
  IconX,
} from "@/components/icons";
import { addRedirectAction, deleteRedirectAction } from "../platform-actions";
import { SubLink } from "../secondary";
import { savePanelAction } from "../settings-actions";
import { ActionForm, FormMessage, SubmitButton, useActionForm } from "../ui";
import { SectionIcon } from "@/components/section-icon";
import { PRODUCT_NAME } from "@/lib/product";

export type TreeArticle = { id: number; title: string; status: "draft" | "published"; restricted: boolean };
export type TreeNode = { id: number; name: string; icon: string; restricted: boolean; articles: TreeArticle[]; children: TreeNode[] };
export type CustomizeData = {
  settings: {
    accent: string;
    logoUrl: string;
    supportUrl: string;
    headerLinks: string;
    footerLinks: string;
    showPoweredBy: boolean;
    helpColorScheme: "system" | "light" | "dark";
    aiAnswers: boolean;
    contentActions: boolean;
    seoTitle: string;
    seoDescription: string;
    customCss: string;
    customJs: string;
    brandName: string;
  };
  redirects: { id: number; from_path: string; to_path: string }[];
  customerAi: boolean;
  publicUrl: string;
};

const row = "group flex h-8 min-w-0 items-center gap-1.5 rounded-lg pr-2 text-[13px] transition-colors";
const activeRow = "bg-surface font-medium text-ink shadow-[inset_0_0_0_1px_rgb(10_13_18/0.07),0_1px_2px_rgb(10_13_18/0.06)]";
const idleRow = "text-graphite hover:bg-hover hover:text-ink";

function ancestorsOf(nodes: TreeNode[], match: (n: TreeNode) => boolean, trail: number[] = []): number[] | null {
  for (const n of nodes) {
    if (match(n)) return [...trail, n.id];
    const found = ancestorsOf(n.children, match, [...trail, n.id]);
    if (found) return found;
  }
  return null;
}

export function HelpCenterNav({
  tree,
  unsorted,
  customize,
}: {
  tree: TreeNode[];
  unsorted: TreeArticle[];
  /** Absent for contributors, who can't change the help center's design or access. */
  customize: CustomizeData | null;
}) {
  const path = usePathname();
  if (customize && path.startsWith("/admin/help-center/customize")) return <CustomizeNav data={customize} />;
  return <TreeNav tree={tree} unsorted={unsorted} canManage={customize !== null} />;
}

/* The tree: Manage links, then every section and article. */

function TreeNav({ tree, unsorted, canManage }: { tree: TreeNode[]; unsorted: TreeArticle[]; canManage: boolean }) {
  const path = usePathname();
  const articleId = Number(path.match(/\/articles\/(\d+)/)?.[1] ?? 0);
  const collectionId = Number(path.match(/\/collections\/(\d+)/)?.[1] ?? 0);
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");

  // Sections holding the current page start open; anything the person toggles wins.
  const activeTrail = useMemo(
    () => new Set(ancestorsOf(tree, (n) => n.id === collectionId || n.articles.some((a) => a.id === articleId)) ?? []),
    [tree, articleId, collectionId],
  );
  const isOpen = (id: number) => !closed.has(id) && (opened.has(id) || activeTrail.has(id));
  const toggle = (id: number) => {
    const open = isOpen(id);
    setOpened((s) => {
      const next = new Set(s);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
    setClosed((s) => {
      const next = new Set(s);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const needle = q.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!needle) return [];
    const out: (TreeArticle & { section: string })[] = [];
    const walk = (nodes: TreeNode[]) =>
      nodes.forEach((n) => {
        n.articles.filter((a) => a.title.toLowerCase().includes(needle)).forEach((a) => out.push({ ...a, section: n.name }));
        walk(n.children);
      });
    walk(tree);
    unsorted.filter((a) => a.title.toLowerCase().includes(needle)).forEach((a) => out.push({ ...a, section: "No section" }));
    return out;
  }, [needle, tree, unsorted]);

  const articleLink = (a: TreeArticle, depth: number) => (
    <Link
      key={a.id}
      href={`/admin/help-center/articles/${a.id}`}
      aria-current={a.id === articleId ? "page" : undefined}
      className={`${row} ${a.id === articleId ? activeRow : idleRow}`}
      style={{ paddingLeft: 10 + depth * 14 }}
    >
      <IconFile size={14} className="shrink-0 text-faint" />
      <span className={`min-w-0 flex-1 truncate ${a.status === "draft" ? "text-muted" : ""}`}>{a.title}</span>
      {a.restricted && <IconLock size={12} className="shrink-0 text-faint" aria-label="Restricted" />}
      {a.status === "draft" && <span className="shrink-0 text-[10px] font-semibold tracking-wide text-faint uppercase">Draft</span>}
    </Link>
  );

  const node = (n: TreeNode, depth: number): ReactNode => {
    const open = isOpen(n.id);
    const count = n.articles.length + n.children.length;
    return (
      <li key={n.id}>
        <div className={`${row} ${n.id === collectionId ? activeRow : idleRow}`} style={{ paddingLeft: depth * 14 }}>
          <button
            type="button"
            onClick={() => toggle(n.id)}
            aria-label={open ? `Collapse ${n.name}` : `Expand ${n.name}`}
            aria-expanded={open}
            disabled={count === 0}
            className="flex size-6 shrink-0 items-center justify-center rounded text-faint hover:text-ink disabled:opacity-0"
          >
            <IconChevronRight size={13} className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
          </button>
          <Link href={`/admin/help-center/collections/${n.id}`} className="flex min-w-0 flex-1 items-center gap-1.5">
            <SectionIcon value={n.icon || "folder"} size={14} className="text-faint" />
            <span className="min-w-0 flex-1 truncate">{n.name}</span>
            {n.restricted && <IconLock size={12} className="shrink-0 text-faint" aria-label="Restricted" />}
          </Link>
        </div>
        {open && (
          <ul className="fade-in">
            {n.children.map((c) => node(c, depth + 1))}
            {n.articles.map((a) => (
              <li key={a.id}>{articleLink(a, depth + 1)}</li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
        <p className="text-[13px] font-semibold">Help Center</p>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              setSearching((s) => !s);
              setQ("");
            }}
            aria-label={searching ? "Close search" : "Search articles"}
            className="btn btn-quiet size-7 px-0"
          >
            {searching ? <IconX size={15} /> : <IconSearch size={15} />}
          </button>
          <Link href="/admin/help-center/articles/new" aria-label="New article" title="New article" className="btn btn-quiet size-7 px-0">
            <IconPlus size={15} />
          </Link>
        </div>
      </div>
      {searching && (
        <div className="border-b border-line p-2.5">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search articles" aria-label="Search articles" className="field h-8 text-[13px]" />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
        {needle ? (
          matches.length === 0 ? (
            <p className="px-2.5 py-4 text-[13px] text-muted">No articles match “{q}”.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {matches.map((a) => (
                <li key={a.id}>
                  <Link href={`/admin/help-center/articles/${a.id}`} className={`${row} ${idleRow} h-auto py-1.5 pl-2.5`}>
                    <IconFile size={14} className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{a.title}</span>
                      <span className="block truncate text-[11px] text-muted">{a.section}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            <p className="mb-1 px-2.5 text-[11px] font-semibold tracking-wider text-faint uppercase">Manage</p>
            <div className="flex flex-col gap-0.5">
              <SubLink item={{ href: "/help", label: "Open", icon: <IconExternal size={15} />, external: true }} />
              {canManage && (
                <>
                  <SubLink item={{ href: "/admin/help-center/customize", label: "Customize", icon: <IconPalette size={15} /> }} />
                  <SubLink item={{ href: "/admin/help-center/translate", label: "Translate", icon: <IconLanguage size={15} /> }} />
                  <SubLink item={{ href: "/admin/help-center/access", label: "Access control", icon: <IconLock size={15} /> }} />
                </>
              )}
            </div>

            <div className="mt-5 mb-1 flex items-center justify-between px-2.5">
              <Link href="/admin/help-center" className="text-[11px] font-semibold tracking-wider text-faint uppercase hover:text-ink">
                Home
              </Link>
              <Link href="/admin/help-center/collections/new" aria-label="New section" title="New section" className="text-faint hover:text-ink">
                <IconPlus size={14} />
              </Link>
            </div>
            {tree.length === 0 && unsorted.length === 0 ? (
              <p className="px-2.5 py-2 text-[13px] text-muted">No sections yet.</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {tree.map((n) => node(n, 0))}
                {unsorted.map((a) => (
                  <li key={a.id}>{articleLink(a, 0)}</li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-col gap-0.5 border-t border-line pt-3">
              <SubLink item={{ href: "/admin/help-center/collections/new", label: "Create section", icon: <IconPlus size={15} /> }} />
              <SubLink item={{ href: "/admin/help-center/replace", label: "Find and replace", icon: <IconSearch size={15} /> }} />
              <SubLink item={{ href: "/admin/help-center/deleted", label: "Recently deleted", icon: <IconX size={15} /> }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* Customize: a list of panels; choosing one opens its form in this column, beside the live preview. */

type PanelId = "branding" | "header" | "footer" | "contact" | "ai" | "content" | "seo" | "domain" | "code" | "redirects" | "powered";
const PANELS: { group: string; items: { id: PanelId; label: string; icon: ReactNode }[] }[] = [
  {
    group: "Appearance",
    items: [
      { id: "branding", label: "Branding", icon: <IconPalette size={15} /> },
      { id: "header", label: "Header", icon: <IconFile size={15} /> },
      { id: "footer", label: "Footer", icon: <IconFile size={15} /> },
      { id: "contact", label: "Contact", icon: <IconChat size={15} /> },
    ],
  },
  {
    group: "Features",
    items: [
      { id: "ai", label: "AI answers", icon: <IconSpark size={15} /> },
      { id: "content", label: "Content actions", icon: <IconCopy size={15} /> },
    ],
  },
  {
    group: "Advanced",
    items: [
      { id: "seo", label: "SEO", icon: <IconSearch size={15} /> },
      { id: "domain", label: "Custom domain", icon: <IconGlobe size={15} /> },
      { id: "code", label: "Custom code", icon: <IconCode size={15} /> },
      { id: "redirects", label: "Redirects", icon: <IconWebhook size={15} /> },
      { id: "powered", label: "Powered by", icon: <IconBolt size={15} /> },
    ],
  },
];

function CustomizeNav({ data }: { data: CustomizeData }) {
  const sp = useSearchParams();
  const panel = sp.get("panel") as PanelId | null;
  const current = PANELS.flatMap((g) => g.items).find((i) => i.id === panel);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <Link
          href={current ? "/admin/help-center/customize" : "/admin/help-center"}
          aria-label="Back"
          className="btn btn-quiet size-7 px-0"
        >
          <IconChevronLeft size={16} />
        </Link>
        <p className="text-[13px] font-semibold">{current ? current.label : "Customize"}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
        {current ? (
          <div key={current.id} className="fade-in px-1.5">
            <Panel id={current.id} data={data} />
          </div>
        ) : (
          PANELS.map((g, i) => (
            <div key={g.group} className={i > 0 ? "mt-5" : ""}>
              <p className="mb-1 px-2.5 text-[11px] font-semibold tracking-wider text-faint uppercase">{g.group}</p>
              <div className="flex flex-col gap-0.5">
                {g.items.map((item) => (
                  <Link key={item.id} href={`/admin/help-center/customize?panel=${item.id}`} className={`${row} ${idleRow} pl-2.5`}>
                    <span className="text-faint group-hover:text-graphite">{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    <IconChevronRight size={14} className="text-faint" />
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** A panel's form: saves only its own fields, then refreshes the preview. */
function PanelForm({ fields, saved, children }: { fields: string; saved: string; children: ReactNode }) {
  const form = useActionForm(savePanelAction);
  useEffect(() => {
    if (form.state?.ok) window.dispatchEvent(new Event("hc-preview-reload"));
  }, [form.state]);
  return (
    <ActionForm form={form} className="flex flex-col gap-4">
      <input type="hidden" name="_fields" value={fields} />
      <input type="hidden" name="_saved" value={saved} />
      {children}
      <FormMessage state={form.state} />
      <div>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

const hint = "mt-1.5 text-[12px] text-muted";
const check = "mt-0.5 size-4 accent-[var(--accent)]";

function Panel({ id, data }: { id: PanelId; data: CustomizeData }) {
  const s = data.settings;
  const [accent, setAccent] = useState(s.accent);
  switch (id) {
    case "branding":
      return (
        <PanelForm fields="accent,logoUrl,helpColorScheme" saved="Branding saved.">
          <div>
            <label className="label" htmlFor="cz-accent">
              Accent color
            </label>
            <div className="flex gap-2">
              <input
                type="color"
                aria-label="Pick accent color"
                value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : "#7f56d9"}
                onChange={(e) => setAccent(e.target.value)}
                className="h-[38px] w-12 shrink-0 cursor-pointer rounded-lg border border-line-strong bg-surface p-1"
              />
              <input id="cz-accent" name="accent" value={accent} onChange={(e) => setAccent(e.target.value)} className="field num font-mono" />
            </div>
            <p className={hint}>Buttons, links, and Docs Agent. The default purple is #7f56d9.</p>
          </div>
          <div>
            <label className="label" htmlFor="cz-logo">
              Logo URL
            </label>
            <input id="cz-logo" name="logoUrl" defaultValue={s.logoUrl} placeholder="https://… or /logo.svg" className="field" />
            <p className={hint}>Leave empty to show your brand name.</p>
          </div>
          <fieldset>
            <legend className="label">Color scheme</legend>
            <div className="grid grid-cols-3 gap-1.5">
              {(["system", "light", "dark"] as const).map((v) => (
                <label
                  key={v}
                  className="flex cursor-pointer items-center justify-center rounded-lg border border-line px-2 py-1.5 text-[13px] capitalize has-[:checked]:border-accent-line has-[:checked]:bg-accent-soft has-[:checked]:font-medium"
                >
                  <input type="radio" name="helpColorScheme" value={v} defaultChecked={s.helpColorScheme === v} className="sr-only" />
                  {v}
                </label>
              ))}
            </div>
            <p className={hint}>What readers see first. System follows their device; they can switch from the header.</p>
          </fieldset>
        </PanelForm>
      );
    case "header":
      return (
        <PanelForm fields="headerLinks" saved="Header links saved.">
          <div>
            <label className="label" htmlFor="cz-links">
              Header links
            </label>
            <textarea id="cz-links" name="headerLinks" rows={5} defaultValue={s.headerLinks} placeholder={"Workspace login | https://app.example.com\nStatus | https://status.example.com"} className="field font-mono text-[12.5px]" />
            <p className={hint}>One per line: Label | URL. Up to six.</p>
          </div>
        </PanelForm>
      );
    case "footer":
      return (
        <PanelForm fields="footerLinks" saved="Footer links saved.">
          <div>
            <label className="label" htmlFor="cz-footer">
              Footer links
            </label>
            <textarea id="cz-footer" name="footerLinks" rows={4} defaultValue={s.footerLinks} placeholder={"Terms and Conditions | https://example.com/legal-pages/msa\nPrivacy Policy | https://example.com/legal-pages/privacy-policy"} className="field font-mono text-[12.5px]" />
            <p className={hint}>One per line: Label | URL. Up to six. With none, the footer shows the copyright line.</p>
          </div>
        </PanelForm>
      );
    case "contact":
      return (
        <PanelForm fields="supportUrl" saved="Contact link saved.">
          <div>
            <label className="label" htmlFor="cz-support">
              Contact link
            </label>
            <input id="cz-support" name="supportUrl" defaultValue={s.supportUrl} placeholder="https://… or mailto:support@…" className="field" />
            <p className={hint}>Adds a Contact us button to the header and to answers that can&rsquo;t help.</p>
          </div>
        </PanelForm>
      );
    case "ai":
      return (
        <PanelForm fields="aiAnswers" saved="AI answers setting saved.">
          {!data.customerAi && (
            <p className="notice text-[12.5px]">
              Customers are on search only. AI answers need an <code>OPENAI_API_KEY</code> on the server.
            </p>
          )}
          <label className="flex items-start gap-2.5 text-[13px]">
            <input type="checkbox" name="aiAnswers" defaultChecked={s.aiAnswers} disabled={!data.customerAi} className={check} />
            <span>
              Answer questions with AI in search and the widget
              <span className="block text-muted">Answers come only from published articles and link their sources.</span>
            </span>
          </label>
        </PanelForm>
      );
    case "content":
      return (
        <PanelForm fields="contentActions" saved="Content actions saved.">
          <label className="flex items-start gap-2.5 text-[13px]">
            <input type="checkbox" name="contentActions" defaultChecked={s.contentActions} className={check} />
            <span>
              Copy as Markdown and raw .md links on articles
              <span className="block text-muted">Also publishes /llms.txt so AI assistants can read your docs.</span>
            </span>
          </label>
        </PanelForm>
      );
    case "seo":
      return (
        <PanelForm fields="seoTitle,seoDescription" saved="Search engine details saved.">
          <div>
            <label className="label" htmlFor="cz-seo-title">
              Title
            </label>
            <input id="cz-seo-title" name="seoTitle" defaultValue={s.seoTitle} placeholder={`${s.brandName} Help Center`} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="cz-seo-desc">
              Description
            </label>
            <textarea id="cz-seo-desc" name="seoDescription" rows={3} defaultValue={s.seoDescription} className="field" />
            <p className={hint}>Shown under the title in search results and link previews.</p>
          </div>
        </PanelForm>
      );
    case "domain":
      return (
        <div className="flex flex-col gap-3 text-[13px] text-graphite">
          <p>
            The help center is served at <code className="rounded bg-surface px-1">{data.publicUrl}/help</code>.
          </p>
          <p>To use your own domain, like docs.example.com:</p>
          <ol className="flex list-decimal flex-col gap-1.5 pl-4">
            <li>Point the domain at this server (deploy/AGENT-SETUP.md sets this up on Google Cloud).</li>
            <li>
              Set <code>PUBLIC_URL</code> to the new address. To keep the admin on its own address, like
              admin.docs.example.com, set <code>ADMIN_URL</code> too; each address then only serves its own half.
            </li>
            <li>The root of the domain already opens the help center, and links from an imported help center redirect to the new pages.</li>
          </ol>
        </div>
      );
    case "code":
      return (
        <PanelForm fields="customCss,customJs" saved="Custom code saved.">
          <div>
            <label className="label" htmlFor="cz-css">
              CSS
            </label>
            <textarea id="cz-css" name="customCss" rows={6} defaultValue={s.customCss} placeholder=".prose-doc h2 { … }" className="field font-mono text-[12.5px]" />
          </div>
          <div>
            <label className="label" htmlFor="cz-js">
              JavaScript
            </label>
            <textarea id="cz-js" name="customJs" rows={6} defaultValue={s.customJs} placeholder="// analytics snippet" className="field font-mono text-[12.5px]" />
            <p className={hint}>Runs on every help center page.</p>
          </div>
        </PanelForm>
      );
    case "redirects":
      return <Redirects redirects={data.redirects} />;
    case "powered":
      return (
        <PanelForm fields="showPoweredBy" saved="Footer saved.">
          <label className="flex items-start gap-2.5 text-[13px]">
            <input type="checkbox" name="showPoweredBy" defaultChecked={s.showPoweredBy} className={check} />
            <span>Show &ldquo;Powered by {PRODUCT_NAME}&rdquo; in the footer</span>
          </label>
        </PanelForm>
      );
  }
}

function Redirects({ redirects }: { redirects: CustomizeData["redirects"] }) {
  const form = useActionForm(addRedirectAction);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted">Keep old links working after you rename or move an article.</p>
      <ActionForm form={form} className="flex flex-col gap-2">
        <input name="from" placeholder="/help/old-article" aria-label="Old path" className="field font-mono text-[12.5px]" />
        <input name="to" placeholder="/help/new-article" aria-label="New path or URL" className="field font-mono text-[12.5px]" />
        <FormMessage state={form.state} />
        <div>
          <SubmitButton pendingLabel="Adding…">Add redirect</SubmitButton>
        </div>
      </ActionForm>
      {redirects.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {redirects.map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-3 py-2 font-mono text-[12px]">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{r.from_path}</span>
                <span className="block truncate text-muted">→ {r.to_path}</span>
              </span>
              <form action={deleteRedirectAction}>
                <input type="hidden" name="id" value={r.id} />
                <button className="btn btn-quiet btn-danger h-7 px-2 font-sans text-[12px]">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
