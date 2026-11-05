// The widget's settings: what each customize panel controls, their defaults, and how a saved
// value is cleaned up. Shared by the admin customizer, the widget page, and the embed script,
// so it has no server-only imports.

export type LinkIcon = "link" | "calendar" | "book" | "chat" | "video" | "status" | "mail";
export type WidgetLink = { icon: LinkIcon; label: string; url: string; newTab: boolean };
export type LauncherIcon = "help" | "chat" | "book" | "spark";
export type ContactMethod = "form" | "link" | "chat" | "whatsapp" | "none";

export type WidgetSettings = {
  // Branding
  logo: string; // a storage key; "" shows the workspace mark
  color: string; // "" uses the help center's accent
  scheme: "system" | "light" | "dark";
  headingFont: string; // a Google Fonts family; "" uses the default
  bodyFont: string;
  // Header
  greeting: string;
  headerBg: "color" | "image" | "gradient";
  headerColor: string;
  headerImage: string;
  headerGradientFrom: string;
  headerGradientTo: string;
  // Launcher
  label: string; // text beside the launcher icon; "" is icon only
  launcherColor: string;
  launcherIconColor: string;
  launcherIcon: LauncherIcon;
  position: "right" | "left";
  sideOffset: number;
  bottomOffset: number;
  iconSize: number;
  rounding: "full" | "custom";
  radius: number;
  padding: number;
  // AI conversations
  ai: boolean;
  // Content: top-level sections shown in the widget; empty shows them all
  collections: number[];
  // Links
  links: WidgetLink[];
  // Contact
  contactMethod: ContactMethod;
  contactEmail: string;
  contactUrl: string;
  whatsapp: string;
  handoff: "ai" | "always" | "off";
  handoffSummary: boolean;
  contactTitle: string;
  contactDescription: string;
  contactButton: string;
  // Text: overrides of the default wording, by key
  text: Record<string, string>;
  // Powered by
  poweredBy: boolean;
};

export const WIDGET_DEFAULTS: WidgetSettings = {
  logo: "",
  color: "",
  scheme: "system",
  headingFont: "",
  bodyFont: "",
  greeting: "How can we help?",
  headerBg: "color",
  headerColor: "",
  headerImage: "",
  headerGradientFrom: "#7f56d9",
  headerGradientTo: "#2e90fa",
  label: "",
  launcherColor: "",
  launcherIconColor: "#ffffff",
  launcherIcon: "help",
  position: "right",
  sideOffset: 24,
  bottomOffset: 24,
  iconSize: 24,
  rounding: "full",
  radius: 14,
  padding: 14,
  ai: true,
  collections: [],
  links: [],
  contactMethod: "link",
  contactEmail: "",
  contactUrl: "",
  whatsapp: "",
  handoff: "ai",
  handoffSummary: true,
  contactTitle: "Contact us",
  contactDescription: "Send us a message and we'll get back to you by email.",
  contactButton: "Contact us",
  text: {},
  poweredBy: false,
};

/** Every piece of wording in the widget, grouped as the Text panel shows it. */
export const TEXT_GROUPS: { group: string; items: { key: string; label: string; value: string }[] }[] = [
  { group: "Launcher", items: [{ key: "launcher.open", label: "Screen reader label", value: "Open help" }] },
  {
    group: "Home",
    items: [
      { key: "home.ask", label: "Assistant heading", value: "Ask our assistant anything" },
      { key: "home.placeholder", label: "Question box", value: "Ask a question…" },
      { key: "home.browse", label: "Browse link", value: "Browse our docs" },
      { key: "home.popular", label: "Popular articles heading", value: "Popular articles" },
    ],
  },
  {
    group: "Search",
    items: [
      { key: "search.placeholder", label: "Search box", value: "Search articles" },
      { key: "search.empty", label: "No results", value: "No articles match." },
      { key: "search.askInstead", label: "Ask instead", value: "Ask the assistant instead" },
    ],
  },
  {
    group: "Assistant",
    items: [
      { key: "assistant.label", label: "Answer label", value: "AI answer" },
      { key: "assistant.unanswered", label: "No answer", value: "The help center doesn't cover this yet." },
      { key: "assistant.handoff", label: "Handed to a person", value: "This one's best handled by a person." },
      { key: "assistant.followUp", label: "Follow-up box", value: "Ask a follow-up" },
      { key: "assistant.helpful", label: "Feedback question", value: "Helpful?" },
      { key: "assistant.thanks", label: "Feedback thanks", value: "Thanks for the feedback." },
    ],
  },
  {
    group: "Docs",
    items: [
      { key: "docs.title", label: "Docs heading", value: "Docs" },
      { key: "docs.openAll", label: "Open help center", value: "Open the full help center" },
    ],
  },
  {
    group: "Contact",
    items: [
      { key: "contact.name", label: "Name field", value: "Your name" },
      { key: "contact.email", label: "Email field", value: "Your email" },
      { key: "contact.message", label: "Message field", value: "How can we help?" },
      { key: "contact.send", label: "Send button", value: "Send message" },
      { key: "contact.sent", label: "Sent", value: "Thanks! We'll reply by email soon." },
    ],
  },
  {
    group: "Navigation",
    items: [
      { key: "nav.back", label: "Back", value: "Back" },
      { key: "nav.close", label: "Close", value: "Close help" },
    ],
  },
  { group: "Errors", items: [{ key: "errors.generic", label: "Something went wrong", value: "Something went wrong. Try again." }] },
];

const TEXT_DEFAULTS: Record<string, string> = Object.fromEntries(TEXT_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.value])));

/** The wording to show for a key: the override, or the default. */
export function widgetText(s: Pick<WidgetSettings, "text">, key: string): string {
  return s.text[key]?.trim() || TEXT_DEFAULTS[key] || key;
}

/** Popular Google Fonts families offered for headings and body text. */
export const FONTS = [
  "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Source Sans 3", "Nunito", "Nunito Sans", "Raleway",
  "Work Sans", "DM Sans", "Manrope", "Plus Jakarta Sans", "IBM Plex Sans", "Figtree", "Outfit", "Rubik", "Karla", "Mulish",
  "Public Sans", "Lexend", "Urbanist", "Space Grotesk", "Sora", "Onest", "Geist", "Instrument Sans", "Hanken Grotesk", "Albert Sans",
  "Merriweather", "Lora", "Playfair Display", "Source Serif 4", "Libre Baskerville", "EB Garamond", "Crimson Pro", "Fraunces", "Newsreader", "Petrona",
  "PT Serif", "Noto Serif", "Spectral", "Young Serif", "Instrument Serif", "DM Serif Display", "Bitter", "Roboto Slab", "Zilla Slab", "Arvo",
  "JetBrains Mono", "IBM Plex Mono", "Fira Code", "Space Mono", "Roboto Mono",
];

export const LINK_ICONS: LinkIcon[] = ["link", "calendar", "book", "chat", "video", "status", "mail"];

const HEX = /^#[0-9a-f]{6}$/i;
const str = (v: unknown, max: number, fallback = "") => (typeof v === "string" ? v.trim().slice(0, max) : fallback);
const hex = (v: unknown, fallback = "") => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : fallback);
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const url = (v: unknown) => {
  const s = str(v, 500);
  return /^(https:\/\/|http:\/\/|mailto:)/i.test(s) ? s : "";
};
const font = (v: unknown) => (typeof v === "string" && FONTS.includes(v) ? v : "");
const key = (v: unknown) => (typeof v === "string" && /^[\w./-]{1,200}$/.test(v) && !v.includes("..") ? v : "");

/** Turns anything (a saved row, a posted form) into valid settings, falling back to defaults field by field. */
export function sanitizeWidget(raw: unknown): WidgetSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = WIDGET_DEFAULTS;
  const text: Record<string, string> = {};
  if (r.text && typeof r.text === "object") {
    for (const [k, v] of Object.entries(r.text as Record<string, unknown>)) if (k in TEXT_DEFAULTS && typeof v === "string" && v.trim()) text[k] = v.trim().slice(0, 200);
  }
  return {
    logo: key(r.logo),
    color: hex(r.color),
    scheme: oneOf(r.scheme, ["system", "light", "dark"] as const, d.scheme),
    headingFont: font(r.headingFont),
    bodyFont: font(r.bodyFont),
    greeting: str(r.greeting, 80) || d.greeting,
    headerBg: oneOf(r.headerBg, ["color", "image", "gradient"] as const, d.headerBg),
    headerColor: hex(r.headerColor),
    headerImage: key(r.headerImage),
    headerGradientFrom: hex(r.headerGradientFrom, d.headerGradientFrom),
    headerGradientTo: hex(r.headerGradientTo, d.headerGradientTo),
    label: str(r.label, 30),
    launcherColor: hex(r.launcherColor),
    launcherIconColor: hex(r.launcherIconColor, d.launcherIconColor),
    launcherIcon: oneOf(r.launcherIcon, ["help", "chat", "book", "spark"] as const, d.launcherIcon),
    position: r.position === "left" ? "left" : "right",
    sideOffset: num(r.sideOffset, 0, 120, d.sideOffset),
    bottomOffset: num(r.bottomOffset, 0, 120, d.bottomOffset),
    iconSize: num(r.iconSize, 16, 40, d.iconSize),
    rounding: r.rounding === "custom" ? "custom" : "full",
    radius: num(r.radius, 0, 40, d.radius),
    padding: num(r.padding, 6, 28, d.padding),
    ai: r.ai === undefined ? d.ai : Boolean(r.ai),
    collections: Array.isArray(r.collections) ? [...new Set(r.collections.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 100) : [],
    links: Array.isArray(r.links)
      ? r.links
          .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}))
          .map((l) => ({ icon: oneOf(l.icon, LINK_ICONS, "link"), label: str(l.label, 40), url: url(l.url), newTab: l.newTab === undefined ? true : Boolean(l.newTab) }))
          .filter((l) => l.label && l.url)
          .slice(0, 8)
      : [],
    contactMethod: oneOf(r.contactMethod, ["form", "link", "chat", "whatsapp", "none"] as const, d.contactMethod),
    contactEmail: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(r.contactEmail, 200)) ? str(r.contactEmail, 200).toLowerCase() : "",
    contactUrl: url(r.contactUrl),
    whatsapp: str(r.whatsapp, 20).replace(/[^\d+]/g, ""),
    handoff: oneOf(r.handoff, ["ai", "always", "off"] as const, d.handoff),
    handoffSummary: r.handoffSummary === undefined ? d.handoffSummary : Boolean(r.handoffSummary),
    contactTitle: str(r.contactTitle, 60) || d.contactTitle,
    // Empty is a choice (no description); missing means a widget saved before this setting existed.
    contactDescription: typeof r.contactDescription === "string" ? str(r.contactDescription, 200) : d.contactDescription,
    contactButton: str(r.contactButton, 30) || d.contactButton,
    text,
    poweredBy: Boolean(r.poweredBy),
  };
}

/** The Google Fonts stylesheet for the chosen families, or null. */
export function fontsHref(s: Pick<WidgetSettings, "headingFont" | "bodyFont">): string | null {
  const families = [...new Set([s.headingFont, s.bodyFont].filter(Boolean))];
  if (!families.length) return null;
  return `https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700`).join("&")}&display=swap`;
}

/** Where the widget's contact entry goes, for link-style methods. */
export function contactHref(s: Pick<WidgetSettings, "contactMethod" | "contactUrl" | "whatsapp">, fallback: string): string {
  if (s.contactMethod === "whatsapp" && s.whatsapp) return `https://wa.me/${s.whatsapp.replace(/^\+/, "")}`;
  if (s.contactMethod === "link") return s.contactUrl || fallback;
  return "";
}
