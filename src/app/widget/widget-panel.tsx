"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BrandMark,
  IconArrow,
  IconBolt,
  IconBook,
  IconChat,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconExternal,
  IconInbox,
  IconMonitor,
  IconSearch,
  IconSpark,
  IconX,
} from "@/components/icons";
import { contactHref, fontsHref, widgetText, type LinkIcon, type WidgetSettings } from "@/lib/widget-config";
import { Answer } from "../help/answer";
import { PRODUCT_NAME } from "@/lib/product";

type Result = { slug: string; title: string; summary: string };
export type WidgetSection = { id: number; name: string; articles: { slug: string; title: string }[] };
type View = { name: "home" } | { name: "docs"; section?: number } | { name: "answer"; question: string } | { name: "contact"; prefill: string; conversation: number | null };

const LINK_ICON: Record<LinkIcon, ReactNode> = {
  link: <IconExternal size={15} />,
  calendar: <IconClock size={15} />,
  book: <IconBook size={15} />,
  chat: <IconChat size={15} />,
  video: <IconMonitor size={15} />,
  status: <IconBolt size={15} />,
  mail: <IconInbox size={15} />,
};

function track(widget: number, kind: "search" | "view") {
  navigator.sendBeacon?.("/api/widget-event", JSON.stringify({ widget, kind }));
}

/** Tells the page the widget is embedded in about something (closing, a handoff, a chat request). */
function toHost(message: unknown) {
  if (window.parent !== window) window.parent.postMessage(message, "*");
}

function Row({ icon, label, external, onClick, href }: { icon: ReactNode; label: string; external?: boolean; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <span className="flex size-5 shrink-0 items-center justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {external ? <IconExternal size={13} className="text-faint" /> : <IconChevronRight size={14} className="text-faint transition-transform group-hover:translate-x-0.5" />}
    </>
  );
  const cls = "group flex w-full items-center gap-3 border-t border-line px-1 py-3 text-left text-[14px] text-graphite transition-colors first:border-t-0 hover:text-ink";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export function WidgetPanel({
  widgetId,
  initial,
  accent,
  workspaceLogo,
  supportUrl,
  aiAvailable,
  sections,
  popular,
  preview,
}: {
  widgetId: number;
  initial: WidgetSettings;
  accent: string;
  /** The logo to show when the widget has none of its own. */
  workspaceLogo: string;
  supportUrl: string;
  /** AI answers are on for the help center and the server has a key. */
  aiAvailable: boolean;
  sections: WidgetSection[];
  popular: { slug: string; title: string }[];
  /** Inside the admin's customizer: settings arrive from the editor as they change. */
  preview: boolean;
}) {
  const [s, setS] = useState(initial);
  const [view, setView] = useState<View>({ name: "home" });
  const [question, setQuestion] = useState("");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ query: string; results: Result[] } | null>(null);
  const t = (key: string) => widgetText(s, key);
  const ai = aiAvailable && s.ai;

  useEffect(() => {
    if (!preview) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === "autodocs:preview") setS(e.data.settings as WidgetSettings);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [preview]);

  // AutoDocs("ask", "…") on the host page.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source === window.parent && e.data?.type === "autodocs:ask" && typeof e.data.question === "string") {
        const asked = e.data.question.trim().slice(0, 500);
        if (asked.length >= 3) setView({ name: "answer", question: asked });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Search is limited to the sections this widget shows.
  const allowed = useMemo(() => new Set(sections.flatMap((x) => x.articles.map((a) => a.slug))), [sections]);
  const query = q.trim();
  const results = query.length >= 2 && found?.query === query ? found.results.filter((r) => allowed.has(r.slug)) : null;
  useEffect(() => {
    if (query.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => setFound({ query, results: d.results }))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const color = s.color || accent;
  const fonts = fontsHref(s);
  const headerBackground =
    s.headerBg === "image" && s.headerImage
      ? `center / cover no-repeat url(/files/${s.headerImage})`
      : s.headerBg === "gradient"
        ? `linear-gradient(135deg, ${s.headerGradientFrom}, ${s.headerGradientTo})`
        : s.headerColor || color;
  const logo = s.logo ? `/files/${s.logo}` : workspaceLogo;
  const linkOut = contactHref(s, supportUrl);
  const articleHref = (slug: string) => `/help/${slug}?src=widget`;
  const heading = s.headingFont ? `"${s.headingFont}", serif` : "var(--font-display-stack)";

  function ask(text: string) {
    const clean = text.trim();
    if (clean.length < 3) return;
    track(widgetId, "search");
    setQuestion("");
    setView({ name: "answer", question: clean });
  }

  /** Starts contact the configured way. From an answer, the customer's question comes along. */
  function startContact(from?: { question: string; conversation: number | null }) {
    const summary = from && s.handoffSummary ? `${from.question}\n\n` : "";
    if (s.contactMethod === "form") setView({ name: "contact", prefill: summary, conversation: from?.conversation ?? null });
    else if (s.contactMethod === "chat") toHost({ type: "autodocs:contact", summary: summary.trim() });
    else if (linkOut) window.open(linkOut, "_blank", "noopener");
  }
  const canContact =
    s.contactMethod === "form" ? Boolean(s.contactEmail) : s.contactMethod === "chat" ? true : s.contactMethod === "none" ? false : Boolean(linkOut);

  const back = (
    <button type="button" onClick={() => setView({ name: "home" })} className="flex items-center gap-1 text-[13px] text-muted hover:text-ink">
      <IconChevronLeft size={14} /> {t("nav.back")}
    </button>
  );

  return (
    <div
      data-scheme={s.scheme}
      className="flex h-full flex-col bg-surface text-ink"
      style={{ "--accent": color, fontFamily: s.bodyFont ? `"${s.bodyFont}", var(--font-sans), sans-serif` : undefined } as React.CSSProperties}
    >
      {/* The fonts the widget's owner chose, loaded only inside the widget. */}
      {fonts && <link rel="stylesheet" href={fonts} />}
      <header className="relative h-16 shrink-0" style={{ background: headerBackground }}>
        <button
          type="button"
          aria-label={t("nav.close")}
          onClick={() => toHost("autodocs:close")}
          className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/15 hover:text-white"
        >
          <IconX size={17} />
        </button>
        <span className="absolute -bottom-5 left-5 flex size-11 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-md)]">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- the widget's own uploaded logo
            <img src={logo} alt="" className="size-full object-cover" />
          ) : (
            <BrandMark size={20} />
          )}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-8 pb-4">
        {view.name === "home" && (
          <>
            <h1 className="mb-5 text-[24px] leading-tight font-semibold tracking-[-0.02em]" style={{ fontFamily: heading }}>
              {s.greeting}
            </h1>
            {ai ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(question);
                }}
                className="rounded-xl border border-line bg-sunken"
              >
                <label htmlFor="w-ask" className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-[12.5px] font-medium text-graphite">
                  <IconSpark size={13} className="text-accent" /> {t("home.ask")}
                </label>
                <textarea
                  id="w-ask"
                  rows={3}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      ask(question);
                    }
                  }}
                  maxLength={500}
                  placeholder={t("home.placeholder")}
                  className="block w-full resize-none bg-transparent px-3 py-2.5 text-[14px] outline-none placeholder:text-placeholder"
                />
                {question.trim().length >= 3 && (
                  <div className="flex justify-end px-2 pb-2">
                    <button type="submit" aria-label="Ask" className="btn btn-primary btn-icon size-8">
                      <IconArrow size={14} />
                    </button>
                  </div>
                )}
              </form>
            ) : (
              <button type="button" onClick={() => setView({ name: "docs" })} className="field flex h-11 items-center gap-2 rounded-xl text-left text-[14px] text-placeholder">
                <IconSearch size={15} /> {t("search.placeholder")}
              </button>
            )}
            <nav className="mt-5 flex flex-col">
              <Row icon={<IconBook size={15} />} label={t("home.browse")} onClick={() => setView({ name: "docs" })} />
              {canContact && (
                <Row
                  icon={<IconInbox size={15} />}
                  label={s.contactButton}
                  onClick={() => startContact()}
                  external={s.contactMethod !== "form" && s.contactMethod !== "chat"}
                />
              )}
              {s.links.map((l) => (
                <Row
                  key={`${l.label}${l.url}`}
                  icon={LINK_ICON[l.icon]}
                  label={l.label}
                  href={l.newTab ? l.url : undefined}
                  onClick={l.newTab ? undefined : () => toHost({ type: "autodocs:navigate", url: l.url })}
                  external
                />
              ))}
            </nav>
          </>
        )}

        {view.name === "docs" && (
          <>
            {back}
            <h1 className="mt-3 mb-3 text-[20px] font-semibold tracking-[-0.01em]" style={{ fontFamily: heading }}>
              {t("docs.title")}
            </h1>
            <div className="relative">
              <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
              <input
                type="search"
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query.length >= 3) fetch(`/api/search?q=${encodeURIComponent(query)}&final=1`).catch(() => {});
                }}
                aria-label={t("search.placeholder")}
                placeholder={t("search.placeholder")}
                className="field h-10 rounded-lg pl-9 text-[14px]"
              />
            </div>
            {results ? (
              results.length ? (
                <ul className="mt-3 flex flex-col">
                  {results.map((r) => (
                    <li key={r.slug}>
                      <a href={articleHref(r.slug)} target="_blank" onClick={() => track(widgetId, "view")} className="group block border-t border-line py-2.5 first:border-t-0">
                        <span className="block text-[14px] font-medium group-hover:text-accent">{r.title}</span>
                        {r.summary && <span className="block truncate text-[12.5px] text-muted">{r.summary}</span>}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-4 text-[13.5px] text-muted">
                  <p>{t("search.empty")}</p>
                  {ai && (
                    <button type="button" onClick={() => ask(query)} className="link mt-1">
                      {t("search.askInstead")}
                    </button>
                  )}
                </div>
              )
            ) : view.section ? (
              <ul className="mt-3 flex flex-col">
                <li className="mb-1 text-[12px] font-medium text-muted">{sections.find((x) => x.id === view.section)?.name}</li>
                {sections
                  .find((x) => x.id === view.section)
                  ?.articles.map((a) => (
                    <li key={a.slug}>
                      <a
                        href={articleHref(a.slug)}
                        target="_blank"
                        onClick={() => track(widgetId, "view")}
                        className="flex items-center gap-2 border-t border-line py-2.5 text-[14px] first:border-t-0 hover:text-accent"
                      >
                        <span className="min-w-0 flex-1 truncate">{a.title}</span>
                        <IconArrow size={13} className="text-faint" />
                      </a>
                    </li>
                  ))}
              </ul>
            ) : (
              <>
                <nav className="mt-3 flex flex-col">
                  {sections.map((x) => (
                    <Row key={x.id} icon={<IconBook size={15} />} label={x.name} onClick={() => setView({ name: "docs", section: x.id })} />
                  ))}
                </nav>
                {popular.some((a) => allowed.has(a.slug)) && (
                  <section className="mt-5">
                    <h2 className="mb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{t("home.popular")}</h2>
                    <ul>
                      {popular
                        .filter((a) => allowed.has(a.slug))
                        .map((a) => (
                          <li key={a.slug}>
                            <a
                              href={articleHref(a.slug)}
                              target="_blank"
                              onClick={() => track(widgetId, "view")}
                              className="block truncate border-t border-line py-2 text-[13.5px] first:border-t-0 hover:text-accent"
                            >
                              {a.title}
                            </a>
                          </li>
                        ))}
                    </ul>
                  </section>
                )}
                <a href="/help" target="_blank" className="link mt-4 inline-block text-[13px]">
                  {t("docs.openAll")}
                </a>
              </>
            )}
          </>
        )}

        {view.name === "answer" && (
          <>
            {back}
            <div className="mt-3">
              <Answer
                key={view.question}
                question={view.question}
                supportUrl={linkOut}
                auto
                linkTarget="_blank"
                widget={widgetId}
                offerContact={canContact ? s.handoff : "off"}
                contactLabel={s.contactButton}
                onContact={(c) => startContact(c)}
                text={{
                  label: t("assistant.label"),
                  unanswered: t("assistant.unanswered"),
                  handoff: t("assistant.handoff"),
                  followUp: t("assistant.followUp"),
                  helpful: t("assistant.helpful"),
                  thanks: t("assistant.thanks"),
                }}
              />
            </div>
          </>
        )}

        {view.name === "contact" && <ContactForm key={view.prefill} widgetId={widgetId} s={s} prefill={view.prefill} conversation={view.conversation} back={back} />}
      </div>

      {s.poweredBy && (
        <p className="shrink-0 border-t border-line py-2 text-center text-[11.5px] text-faint">
          Powered by{" "}
          <a href="/help" target="_blank" className="font-medium text-muted hover:text-ink">
            {PRODUCT_NAME}
          </a>
        </p>
      )}
    </div>
  );
}

function ContactForm({ widgetId, s, prefill, conversation, back }: { widgetId: number; s: WidgetSettings; prefill: string; conversation: number | null; back: ReactNode }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const t = (key: string) => widgetText(s, key);
  if (state === "sent") {
    return (
      <>
        {back}
        <p className="mt-6 text-[15px] font-medium">{t("contact.sent")}</p>
      </>
    );
  }
  return (
    <>
      {back}
      <h1 className="mt-3 text-[20px] font-semibold tracking-[-0.01em]" style={{ fontFamily: s.headingFont ? `"${s.headingFont}", serif` : undefined }}>
        {s.contactTitle}
      </h1>
      {s.contactDescription && <p className="mt-1 text-[13.5px] text-muted">{s.contactDescription}</p>}
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setState("sending");
          const res = await fetch("/api/widget/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ widget: widgetId, name: f.get("name"), email: f.get("email"), message: f.get("message"), conversation }),
          }).catch(() => null);
          if (res?.ok) setState("sent");
          else {
            setError(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? t("errors.generic"));
            setState("error");
          }
        }}
      >
        <input name="name" required maxLength={80} autoComplete="name" placeholder={t("contact.name")} aria-label={t("contact.name")} className="field h-10 text-[14px]" />
        <input
          name="email"
          type="email"
          required
          maxLength={200}
          autoComplete="email"
          placeholder={t("contact.email")}
          aria-label={t("contact.email")}
          className="field h-10 text-[14px]"
        />
        <textarea name="message" required rows={5} maxLength={5000} defaultValue={prefill} placeholder={t("contact.message")} aria-label={t("contact.message")} className="field text-[14px]" />
        {state === "error" && <p className="text-[13px] text-danger">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : t("contact.send")}
        </button>
      </form>
    </>
  );
}
