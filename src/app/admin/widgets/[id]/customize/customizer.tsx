"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import {
  IconBolt,
  IconBook,
  IconChat,
  IconChevronLeft,
  IconChevronRight,
  IconCode,
  IconExternal,
  IconImage,
  IconInbox,
  IconLanguage,
  IconPalette,
  IconPlus,
  IconSpark,
  IconWidget,
  IconX,
} from "@/components/icons";
import { FONTS, LINK_ICONS, TEXT_GROUPS, type ContactMethod, type LauncherIcon, type WidgetLink, type WidgetSettings } from "@/lib/widget-config";
import { saveWidgetSettingsAction, uploadWidgetImageAction } from "../../../platform-actions";
import { CodeBlock } from "../../../settings/platform-forms";

type Panel = "branding" | "header" | "launcher" | "ai" | "content" | "links" | "contact" | "install" | "text" | "powered";
const PANELS: { id: Panel; label: string; icon: ReactNode }[] = [
  { id: "branding", label: "Branding", icon: <IconPalette size={15} /> },
  { id: "header", label: "Header", icon: <IconImage size={15} /> },
  { id: "launcher", label: "Launcher", icon: <IconWidget size={15} /> },
  { id: "ai", label: "AI Conversations", icon: <IconSpark size={15} /> },
  { id: "content", label: "Content", icon: <IconBook size={15} /> },
  { id: "links", label: "Links", icon: <IconExternal size={15} /> },
  { id: "contact", label: "Contact", icon: <IconInbox size={15} /> },
  { id: "install", label: "Install", icon: <IconCode size={15} /> },
  { id: "text", label: "Text", icon: <IconLanguage size={15} /> },
  { id: "powered", label: "Powered by", icon: <IconBolt size={15} /> },
];

const SWATCHES = ["#0c0c0c", "#1d2939", "#344054", "#7f56d9", "#6172f3", "#2e90fa", "#0ba5ec", "#06aed4", "#15b79e", "#16b364", "#66c61c", "#eaaa08", "#f79009", "#ef6820", "#f04438", "#ee46bc", "#dd2590", "#ffffff"];

const LAUNCHER_ICONS: { id: LauncherIcon; label: string; icon: ReactNode }[] = [
  { id: "help", label: "Question mark", icon: <span className="text-[15px] font-semibold">?</span> },
  { id: "chat", label: "Chat bubble", icon: <IconChat size={16} /> },
  { id: "book", label: "Book", icon: <IconBook size={16} /> },
  { id: "spark", label: "Sparkle", icon: <IconSpark size={16} /> },
];

/* Small controls, matched to the admin's own fields */

function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-8 rounded-md px-3 text-[13px] transition-colors ${value === o.value ? "bg-surface text-ink shadow-[var(--shadow-xs)]" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ColorInput({ id, value, placeholder, onChange }: { id: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  const shown = value || placeholder || "#000000";
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label="Pick a color"
        value={/^#[0-9a-f]{6}$/i.test(shown) ? shown : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="size-9 shrink-0 cursor-pointer rounded-md border border-line bg-surface p-1"
      />
      <input id={id} value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder={placeholder} maxLength={7} className="field h-9 font-mono text-[13px]" />
    </div>
  );
}

function Slider({ id, label, hint, value, min, max, onChange }: { id: string; label: string; hint: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="mb-1.5 flex items-end justify-between gap-3">
        <span>
          <label htmlFor={id} className="block text-[13px] font-medium text-graphite">
            {label}
          </label>
          <span className="text-[12px] text-muted">{hint}</span>
        </span>
        <span className="num text-[13px] text-graphite">{value}px</span>
      </div>
      <input id={id} type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-3 text-[13.5px]">
      <span>
        {label}
        {hint && <span className="block text-[12.5px] text-muted">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="toggle mt-0.5" />
    </label>
  );
}

function ImageUpload({ value, onChange, hint }: { value: string; onChange: (key: string) => void; hint: string }) {
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-line-strong bg-sunken text-faint">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element -- an uploaded image from our own file route
            <img src={`/files/${value}`} alt="" className="size-full object-cover" />
          ) : (
            <IconImage size={18} />
          )}
        </span>
        <label className="btn btn-sm cursor-pointer">
          {busy ? "Uploading…" : value ? "Replace" : "Upload"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const data = new FormData();
              data.set("image", file);
              start(async () => {
                const r = await uploadWidgetImageAction(data);
                if (r.key) {
                  setError("");
                  onChange(r.key);
                } else setError(r.error ?? "Couldn't upload that image.");
              });
              e.target.value = "";
            }}
          />
        </label>
        {value && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => onChange("")}>
            Remove
          </button>
        )}
      </div>
      <p className="hint mt-0">{hint}</p>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}

/* The editor */

export function Customizer({
  widget,
  accent,
  origin,
  sections,
  aiAvailable,
  mailReady,
  supportUrl,
  initialPanel,
}: {
  widget: { id: number; name: string; settings: WidgetSettings };
  accent: string;
  origin: string;
  sections: { id: number; name: string; articles: number }[];
  aiAvailable: boolean;
  mailReady: boolean;
  supportUrl: string;
  initialPanel: string | null;
}) {
  const [s, setS] = useState(widget.settings);
  const [name, setName] = useState(widget.name);
  const [saved, setSaved] = useState(JSON.stringify([widget.name, widget.settings]));
  const [panel, setPanel] = useState<Panel | null>(PANELS.some((p) => p.id === initialPanel) ? (initialPanel as Panel) : null);
  const [message, setMessage] = useState<{ ok?: string; error?: string } | null>(null);
  const [saving, startSave] = useTransition();
  const [openLink, setOpenLink] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);
  const dirty = JSON.stringify([name, s]) !== saved;
  const set = <K extends keyof WidgetSettings>(k: K, v: WidgetSettings[K]) => setS((prev) => ({ ...prev, [k]: v }));

  // The preview shows unsaved changes as they're made.
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: "autodocs:preview", settings: s }, window.location.origin);
  }, [s]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function save() {
    startSave(async () => {
      const r = await saveWidgetSettingsAction(widget.id, name, s);
      setMessage(r ?? null);
      if (r?.ok) setSaved(JSON.stringify([name, s]));
    });
  }

  const current = PANELS.find((p) => p.id === panel);
  const color = s.color || accent;
  const launcherSize = s.iconSize + s.padding * 2;
  const snippet = `<script src="${origin}/widget.js?id=${widget.id}" async></script>`;
  const updateLink = (i: number, patch: Partial<WidgetLink>) => set("links", s.links.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const moveLink = (i: number, to: number) => {
    const next = [...s.links];
    const [l] = next.splice(i, 1);
    next.splice(to, 0, l);
    set("links", next);
    setOpenLink(null);
  };

  return (
    <div className="fixed inset-0 z-40 flex bg-surface">
      {/* Settings column */}
      <aside className="flex w-full max-w-[380px] shrink-0 flex-col border-r border-line bg-surface max-md:max-w-none">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
          {current ? (
            <button type="button" onClick={() => setPanel(null)} className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px] font-medium hover:text-accent">
              <IconChevronLeft size={15} /> {current.label}
            </button>
          ) : (
            <Link href="/admin/widgets" className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px] font-medium hover:text-accent">
              <IconChevronLeft size={15} /> <span className="truncate">{name || "Widget"}</span>
            </Link>
          )}
          <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || saving} onClick={save}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
        {message && (
          <p role={message.error ? "alert" : "status"} className={`notice m-3 mb-0 ${message.error ? "notice-error" : ""}`}>
            {message.error ?? message.ok}
          </p>
        )}

        <div className="slim-scroll min-h-0 flex-1 overflow-y-auto">
          {!current && (
            <>
              <div className="border-b border-line px-4 py-3">
                <Field label="Widget name" htmlFor="cz-name" hint="Only your team sees this, in the widget list.">
                  <input id="cz-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="field h-9" />
                </Field>
              </div>
              <ul>
                {PANELS.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setPanel(p.id)}
                      className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left text-[14px] transition-colors hover:bg-sunken"
                    >
                      <span className="text-muted">{p.icon}</span>
                      <span className="flex-1">{p.label}</span>
                      <IconChevronRight size={14} className="text-faint" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {panel && (
            <div className="flex flex-col gap-5 px-4 py-4">
              {panel === "branding" && (
                <>
                  <Field label="Logo">
                    <ImageUpload value={s.logo} onChange={(k) => set("logo", k)} hint="Shown at the top of the widget. Square, 512×512 pixels is ideal." />
                  </Field>
                  <Field label="Primary color" htmlFor="cz-color" hint="Links, buttons, and accents. Empty uses your help center's color.">
                    <ColorInput id="cz-color" value={s.color} placeholder={accent} onChange={(v) => set("color", v)} />
                  </Field>
                  <Field label="Color scheme" hint="System follows each visitor's light or dark setting.">
                    <Segmented
                      label="Color scheme"
                      value={s.scheme}
                      onChange={(v) => set("scheme", v)}
                      options={[
                        { value: "system", label: "System" },
                        { value: "light", label: "Light" },
                        { value: "dark", label: "Dark" },
                      ]}
                    />
                  </Field>
                  {(["headingFont", "bodyFont"] as const).map((k) => (
                    <Field key={k} label={k === "headingFont" ? "Heading font" : "Body font"} htmlFor={`cz-${k}`} hint="Google Fonts, loaded only inside the widget.">
                      <select id={`cz-${k}`} value={s[k]} onChange={(e) => set(k, e.target.value)} className="field h-9 text-[13.5px]">
                        <option value="">Page default</option>
                        {FONTS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                </>
              )}

              {panel === "header" && (
                <>
                  <Field label="Header title" htmlFor="cz-greeting" hint="The first thing people read when the widget opens.">
                    <input id="cz-greeting" value={s.greeting} onChange={(e) => set("greeting", e.target.value)} maxLength={80} className="field h-9" />
                  </Field>
                  <Field label="Background">
                    <Segmented
                      label="Background"
                      value={s.headerBg}
                      onChange={(v) => set("headerBg", v)}
                      options={[
                        { value: "color", label: "Color" },
                        { value: "image", label: "Image" },
                        { value: "gradient", label: "Gradient" },
                      ]}
                    />
                  </Field>
                  {s.headerBg === "color" && (
                    <Field label="Pick a color" htmlFor="cz-hcolor">
                      <ColorInput id="cz-hcolor" value={s.headerColor} placeholder={color} onChange={(v) => set("headerColor", v)} />
                      <div className="mt-2 grid grid-cols-9 gap-1.5">
                        {SWATCHES.map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-label={c}
                            onClick={() => set("headerColor", c)}
                            className={`aspect-square rounded-md border ${s.headerColor === c ? "border-ink ring-2 ring-accent-line" : "border-line"}`}
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                    </Field>
                  )}
                  {s.headerBg === "image" && (
                    <Field label="Image">
                      <ImageUpload value={s.headerImage} onChange={(k) => set("headerImage", k)} hint="Covers the header band. Wide images work best." />
                    </Field>
                  )}
                  {s.headerBg === "gradient" && (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="From" htmlFor="cz-gfrom">
                        <ColorInput id="cz-gfrom" value={s.headerGradientFrom} onChange={(v) => set("headerGradientFrom", v)} />
                      </Field>
                      <Field label="To" htmlFor="cz-gto">
                        <ColorInput id="cz-gto" value={s.headerGradientTo} onChange={(v) => set("headerGradientTo", v)} />
                      </Field>
                    </div>
                  )}
                </>
              )}

              {panel === "launcher" && (
                <>
                  <p className="text-[13px] text-muted">The floating button people click to open the widget.</p>
                  <Field label="Button color" htmlFor="cz-lcolor" hint="Empty uses the primary color.">
                    <ColorInput id="cz-lcolor" value={s.launcherColor} placeholder={color} onChange={(v) => set("launcherColor", v)} />
                  </Field>
                  <Field label="Icon color" htmlFor="cz-licolor">
                    <ColorInput id="cz-licolor" value={s.launcherIconColor} onChange={(v) => set("launcherIconColor", v)} />
                  </Field>
                  <Field label="Icon">
                    <div className="flex gap-2">
                      {LAUNCHER_ICONS.map((i) => (
                        <button
                          key={i.id}
                          type="button"
                          aria-label={i.label}
                          aria-pressed={s.launcherIcon === i.id}
                          onClick={() => set("launcherIcon", i.id)}
                          className={`flex size-10 items-center justify-center rounded-lg border ${s.launcherIcon === i.id ? "border-accent bg-accent-soft text-ink" : "border-line text-muted hover:text-ink"}`}
                        >
                          {i.icon}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Button text" htmlFor="cz-label" hint='Optional, beside the icon, like "Questions?". Empty shows the icon alone.'>
                    <input id="cz-label" value={s.label} onChange={(e) => set("label", e.target.value)} maxLength={30} placeholder="Questions?" className="field h-9" />
                  </Field>
                  <Field label="Position">
                    <Segmented
                      label="Position"
                      value={s.position}
                      onChange={(v) => set("position", v)}
                      options={[
                        { value: "left", label: "Left" },
                        { value: "right", label: "Right" },
                      ]}
                    />
                  </Field>
                  <Slider id="cz-side" label="Side offset" hint="Distance from the side." value={s.sideOffset} min={0} max={120} onChange={(v) => set("sideOffset", v)} />
                  <Slider id="cz-bottom" label="Bottom offset" hint="Distance from the bottom." value={s.bottomOffset} min={0} max={120} onChange={(v) => set("bottomOffset", v)} />
                  <Slider id="cz-size" label="Icon size" hint="The icon inside the launcher." value={s.iconSize} min={16} max={40} onChange={(v) => set("iconSize", v)} />
                  <Field label="Rounding" hint="Full keeps a circle or pill. Custom squares it off.">
                    <Segmented
                      label="Rounding"
                      value={s.rounding}
                      onChange={(v) => set("rounding", v)}
                      options={[
                        { value: "full", label: "Full" },
                        { value: "custom", label: "Custom" },
                      ]}
                    />
                  </Field>
                  {s.rounding === "custom" && <Slider id="cz-radius" label="Corner radius" hint="How round the corners are." value={s.radius} min={0} max={40} onChange={(v) => set("radius", v)} />}
                  <Slider id="cz-padding" label="Launcher padding" hint="Space around the icon and text." value={s.padding} min={6} max={28} onChange={(v) => set("padding", v)} />
                </>
              )}

              {panel === "ai" && (
                <>
                  <p className="text-[13px] text-muted">AI answers from your help center, with sources, right in the widget.</p>
                  <Toggle label="Enable AI conversations" checked={s.ai} onChange={(v) => set("ai", v)} />
                  {!aiAvailable && (
                    <p className="notice">
                      AI answers are off for the whole help center, or the server has no OpenAI key, so the widget shows search instead.{" "}
                      <Link href="/admin/settings/assistant" className="link">
                        AI Assistant settings
                      </Link>
                    </p>
                  )}
                  <p className="text-[13px] text-graphite">
                    Tone, length, off-limits topics, and handoff triggers are shared with the help center:{" "}
                    <Link href="/admin/settings/assistant" className="link">
                      Settings → AI Assistant
                    </Link>
                    .
                  </p>
                </>
              )}

              {panel === "content" && (
                <>
                  <p className="text-[13px] text-muted">Which sections this widget shows and searches. Nothing checked shows them all.</p>
                  <ul className="overflow-hidden rounded-lg border border-line">
                    {sections.map((x) => {
                      const on = s.collections.includes(x.id);
                      return (
                        <li key={x.id} className="border-t border-line first:border-t-0">
                          <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-[13.5px] hover:bg-sunken">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => set("collections", on ? s.collections.filter((c) => c !== x.id) : [...s.collections, x.id])}
                              className="size-4 accent-[var(--accent)]"
                            />
                            <span className="flex-1">{x.name}</span>
                            <span className="num text-[12px] text-muted">{x.articles}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-[12.5px] text-muted">
                    Covers {s.collections.length || sections.length} of {sections.length} sections.
                  </p>
                </>
              )}

              {panel === "links" && (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13px] text-muted">Quick links to important places, shown on the widget&rsquo;s home.</p>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={s.links.length >= 8}
                      onClick={() => {
                        set("links", [...s.links, { icon: "link", label: "New link", url: "https://", newTab: true }]);
                        setOpenLink(s.links.length);
                      }}
                    >
                      <IconPlus size={13} /> Add
                    </button>
                  </div>
                  <ul className="flex flex-col gap-2">
                    {s.links.map((l, i) => (
                      <li key={i} className="rounded-lg border border-line">
                        <div className="flex items-center gap-1 px-2.5 py-1.5">
                          <button type="button" className="min-w-0 flex-1 truncate py-1 text-left text-[13.5px]" onClick={() => setOpenLink(openLink === i ? null : i)}>
                            {l.label || "Untitled link"}
                          </button>
                          <button type="button" aria-label={`Move ${l.label} up`} disabled={i === 0} className="btn btn-quiet btn-icon" onClick={() => moveLink(i, i - 1)}>
                            ↑
                          </button>
                          <button type="button" aria-label={`Move ${l.label} down`} disabled={i === s.links.length - 1} className="btn btn-quiet btn-icon" onClick={() => moveLink(i, i + 1)}>
                            ↓
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${l.label}`}
                            className="btn btn-quiet btn-icon text-danger"
                            onClick={() => {
                              set("links", s.links.filter((_, k) => k !== i));
                              setOpenLink(null);
                            }}
                          >
                            <IconX size={13} />
                          </button>
                        </div>
                        {openLink === i && (
                          <div className="flex flex-col gap-3 border-t border-line px-2.5 py-3">
                            <Field label="Icon" htmlFor={`cz-li-${i}`}>
                              <select id={`cz-li-${i}`} value={l.icon} onChange={(e) => updateLink(i, { icon: e.target.value as WidgetLink["icon"] })} className="field h-9 text-[13.5px] capitalize">
                                {LINK_ICONS.map((ic) => (
                                  <option key={ic} value={ic}>
                                    {ic}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            <Field label="Label" htmlFor={`cz-ll-${i}`}>
                              <input id={`cz-ll-${i}`} value={l.label} onChange={(e) => updateLink(i, { label: e.target.value })} maxLength={40} className="field h-9" />
                            </Field>
                            <Field label="URL" htmlFor={`cz-lu-${i}`} hint="https://, or mailto: for an email address.">
                              <input id={`cz-lu-${i}`} value={l.url} onChange={(e) => updateLink(i, { url: e.target.value })} className="field h-9 font-mono text-[13px]" />
                            </Field>
                            <Toggle label="Open in new tab" hint="Off opens the link in the same tab." checked={l.newTab} onChange={(v) => updateLink(i, { newTab: v })} />
                          </div>
                        )}
                      </li>
                    ))}
                    {!s.links.length && <li className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[13px] text-muted">No links yet.</li>}
                  </ul>
                </>
              )}

              {panel === "contact" && (
                <>
                  <Field label="Contact method" hint="How people reach your team from the widget.">
                    <Segmented<ContactMethod>
                      label="Contact method"
                      value={s.contactMethod}
                      onChange={(v) => set("contactMethod", v)}
                      options={[
                        { value: "form", label: "Form" },
                        { value: "link", label: "Link" },
                        { value: "chat", label: "Chat" },
                        { value: "whatsapp", label: "WhatsApp" },
                        { value: "none", label: "None" },
                      ]}
                    />
                  </Field>
                  {s.contactMethod === "form" && (
                    <>
                      <Field
                        label="Support email address"
                        htmlFor="cz-cemail"
                        hint="Messages arrive here with Reply-To set to the customer. Gmail, Help Scout, Zendesk, Front, and most helpdesks turn them into tickets."
                      >
                        <input id="cz-cemail" type="email" value={s.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} placeholder="support@yourcompany.com" className="field h-9" />
                      </Field>
                      {!mailReady && (
                        <p className="notice notice-error">
                          The server can&rsquo;t send email yet, so form messages would fail.{" "}
                          <Link href="/admin/settings/email" className="link">
                            Set up email delivery
                          </Link>
                        </p>
                      )}
                    </>
                  )}
                  {s.contactMethod === "link" && (
                    <Field label="Link" htmlFor="cz-curl" hint={supportUrl ? `Empty uses the help center's contact link (${supportUrl}).` : "A contact page, or mailto:support@yourcompany.com."}>
                      <input id="cz-curl" value={s.contactUrl} onChange={(e) => set("contactUrl", e.target.value)} placeholder="https://yourcompany.com/contact" className="field h-9 font-mono text-[13px]" />
                    </Field>
                  )}
                  {s.contactMethod === "chat" && (
                    <p className="notice">
                      Opens the chat already on your site (Intercom, Crisp, HubSpot, Zendesk, or Help Scout Beacon) with the customer&rsquo;s question filled in. Other
                      tools can listen for the <code>autodocs:contact</code> event.
                    </p>
                  )}
                  {s.contactMethod === "whatsapp" && (
                    <Field label="WhatsApp number" htmlFor="cz-wa" hint="With the country code, like +1 555 010 0199.">
                      <input id="cz-wa" value={s.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} className="field h-9 font-mono text-[13px]" />
                    </Field>
                  )}
                  {s.contactMethod !== "none" && (
                    <>
                      <div className="border-t border-line pt-4">
                        <p className="text-[13.5px] font-semibold">AI handoff</p>
                        <p className="text-[12.5px] text-muted">When the assistant can&rsquo;t fully answer, it can offer a way to reach your team.</p>
                      </div>
                      <Field label="When to offer contact" htmlFor="cz-handoff" hint="AI decides: after no answer, a handoff, or a thumbs down.">
                        <select id="cz-handoff" value={s.handoff} onChange={(e) => set("handoff", e.target.value as WidgetSettings["handoff"])} className="field h-9 text-[13.5px]">
                          <option value="ai">AI decides</option>
                          <option value="always">Always visible</option>
                          <option value="off">Off</option>
                        </select>
                      </Field>
                      <Toggle label="Draft a handoff summary" hint="Fill in the contact form or chat with the customer's question." checked={s.handoffSummary} onChange={(v) => set("handoffSummary", v)} />
                      <div className="border-t border-line pt-4">
                        <p className="text-[13.5px] font-semibold">Wording</p>
                      </div>
                      <Field label="Button text" htmlFor="cz-cbtn">
                        <input id="cz-cbtn" value={s.contactButton} onChange={(e) => set("contactButton", e.target.value)} maxLength={30} className="field h-9" />
                      </Field>
                      {s.contactMethod === "form" && (
                        <>
                          <Field label="Contact title" htmlFor="cz-ctitle">
                            <input id="cz-ctitle" value={s.contactTitle} onChange={(e) => set("contactTitle", e.target.value)} maxLength={60} className="field h-9" />
                          </Field>
                          <Field label="Contact description" htmlFor="cz-cdesc">
                            <textarea id="cz-cdesc" rows={2} value={s.contactDescription} onChange={(e) => set("contactDescription", e.target.value)} maxLength={200} className="field text-[13.5px]" />
                          </Field>
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {panel === "install" && (
                <>
                  <p className="text-[13px] text-graphite">Paste this before the closing &lt;/body&gt; tag on any page where you want the widget.</p>
                  <CodeBlock label="HTML" value={snippet} />
                  <p className="text-[13px] text-muted">It loads from this server, so saved changes show up on your site right away.</p>
                  <CodeBlock
                    label="Optional: control it from your code"
                    value={`AutoDocs("open");\nAutoDocs("close");\nAutoDocs("ask", "How do I export a case?");\n\nwindow.addEventListener("autodocs:escalationRequested", (e) => {\n  // e.detail.question: a handoff trigger matched\n});`}
                  />
                </>
              )}

              {panel === "text" && (
                <>
                  <p className="text-[13px] text-muted">Leave a field empty to use the default wording.</p>
                  {TEXT_GROUPS.map((g) => {
                    const edited = g.items.filter((i) => s.text[i.key]).length;
                    return (
                      <details key={g.group} className="rounded-lg border border-line">
                        <summary className="flex cursor-pointer items-center justify-between px-3 py-2.5 text-[13.5px]">
                          <span>{g.group}</span>
                          <span className="text-[12px] text-muted">{edited ? `${edited} edited` : g.items.length}</span>
                        </summary>
                        <div className="flex flex-col gap-3 border-t border-line px-3 py-3">
                          {g.items.map((i) => (
                            <Field key={i.key} label={i.label} htmlFor={`cz-t-${i.key}`}>
                              <input
                                id={`cz-t-${i.key}`}
                                value={s.text[i.key] ?? ""}
                                placeholder={i.value}
                                maxLength={200}
                                onChange={(e) => set("text", { ...s.text, [i.key]: e.target.value })}
                                className="field h-9 text-[13.5px]"
                              />
                            </Field>
                          ))}
                        </div>
                      </details>
                    );
                  })}
                </>
              )}

              {panel === "powered" && <Toggle label="Show a powered-by link" hint="A small line at the bottom of the widget." checked={s.poweredBy} onChange={(v) => set("poweredBy", v)} />}

              {dirty && (
                <button
                  type="button"
                  className="mt-2 w-fit text-[12.5px] text-muted hover:text-ink"
                  onClick={() => {
                    setS(JSON.parse(saved)[1]);
                    setName(JSON.parse(saved)[0]);
                  }}
                >
                  Undo unsaved changes
                </button>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Live preview: the real widget, on a stand-in page */}
      <section aria-label="Preview" className="dots relative hidden min-w-0 flex-1 overflow-hidden md:block">
        <div
          className="absolute flex flex-col gap-3"
          style={{ [s.position]: Math.max(s.sideOffset, 16), bottom: Math.max(s.bottomOffset, 16), alignItems: s.position === "left" ? "flex-start" : "flex-end" }}
        >
          {previewOpen && (
            <iframe
              ref={frame}
              title="Widget preview"
              src={`/widget?id=${widget.id}&preview=1`}
              onLoad={() => frame.current?.contentWindow?.postMessage({ type: "autodocs:preview", settings: s }, window.location.origin)}
              className="h-[min(640px,calc(100vh-140px))] w-[400px] rounded-2xl border-0 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.06),0_18px_50px_rgba(16,24,40,.22)]"
            />
          )}
          <button
            type="button"
            onClick={() => setPreviewOpen((o) => !o)}
            aria-label={previewOpen ? "Close the preview" : "Open the preview"}
            className="flex items-center justify-center gap-2 text-[14px] font-semibold shadow-[0_6px_20px_rgba(0,0,0,.2)]"
            style={{
              height: launcherSize,
              minWidth: launcherSize,
              padding: s.label && !previewOpen ? `0 ${s.padding + 4}px` : 0,
              borderRadius: s.rounding === "custom" ? s.radius : 999,
              background: s.launcherColor || color,
              color: s.launcherIconColor,
            }}
          >
            {previewOpen ? <span style={{ fontSize: s.iconSize * 0.7, lineHeight: 1 }}>⌄</span> : LAUNCHER_ICONS.find((i) => i.id === s.launcherIcon)?.icon}
            {s.label && !previewOpen && <span>{s.label}</span>}
          </button>
        </div>
        {dirty && <p className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-ink-strong px-3 py-1 text-[12px] text-white">Unsaved changes</p>}
      </section>
    </div>
  );
}
