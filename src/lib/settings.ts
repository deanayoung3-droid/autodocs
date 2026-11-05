import "server-only";
import { all, run, tx } from "./db";

export type HeaderLink = { label: string; url: string };
export type AssistantTone = "friendly" | "professional" | "plainspoken" | "playful";
export type AssistantLength = "concise" | "standard" | "thorough";

export type Settings = {
  // Brand and contact
  brandName: string;
  accent: string;
  logoUrl: string;
  supportUrl: string;
  headerLinks: HeaderLink[];
  footerLinks: HeaderLink[];
  showPoweredBy: boolean;
  /** The help center's colors by default; readers can switch from the header. */
  helpColorScheme: "system" | "light" | "dark";
  // Help center features
  aiAnswers: boolean;
  contentActions: boolean;
  seoTitle: string;
  seoDescription: string;
  customHead: string;
  customCss: string;
  customJs: string;
  languages: string[];
  costPerTicket: number;
  lastImport: string;
  /** Where a new install filled itself from on first start (SEED_IMPORT_URL); set once. */
  seededFrom: string;
  // Access
  siteVisibility: "public" | "private";
  readerPasswordHash: string;
  /** Who can get an emailed sign-in link: addresses, or domains written as @firm.com. */
  readerEmailAllow: string[];
  // Agent and automations
  githubRepo: string;
  autoScreenPRs: boolean;
  prSensitivity: "strict" | "balanced" | "eager";
  /** One rule per line, "path pattern => frontend | backend | internal", checked before the built-in rules. */
  prPathRules: string;
  /** Merged pull requests from this moment on are caught up by the sweep (set the first time it runs). */
  prSweepFrom: string;
  agentGuidance: string;
  auditFrequency: "off" | "weekly" | "biweekly" | "monthly";
  lastAuditAt: string;
  continuousVerification: boolean;
  verifyPerDay: number;
  // AI models (empty = the server's default for that job)
  aiModel: string;
  answerModel: string;
  // Workspace
  websiteUrl: string;
  workspaceIcon: string;
  // What Docs Agent knows about the company, and how it researches
  aboutCompany: string;
  researchGuidance: string;
  // The AI Assistant: how answers in the help center and widget sound and behave
  assistantTone: AssistantTone;
  assistantEmoji: boolean;
  assistantOwnWords: boolean;
  assistantLength: AssistantLength;
  assistantScreenshots: boolean;
  assistantInstructions: string;
  assistantOffLimits: string[];
  assistantHandoffTriggers: string[];
  // Email Docs Agent
  emailAgentExternal: boolean;
  emailAgentReply: boolean;
};

const DEFAULTS: Settings = {
  brandName: "AutoDocs",
  accent: "#7f56d9",
  logoUrl: "",
  supportUrl: "",
  headerLinks: [],
  footerLinks: [],
  showPoweredBy: false,
  helpColorScheme: "system",
  aiAnswers: true,
  contentActions: true,
  seoTitle: "",
  seoDescription: "",
  customHead: "",
  customCss: "",
  customJs: "",
  languages: [],
  costPerTicket: 8,
  lastImport: "",
  seededFrom: "",
  siteVisibility: "public",
  readerPasswordHash: "",
  readerEmailAllow: [],
  githubRepo: "",
  autoScreenPRs: true,
  prSensitivity: "balanced",
  prPathRules: "",
  prSweepFrom: "",
  agentGuidance: "",
  auditFrequency: "off",
  lastAuditAt: "",
  continuousVerification: false,
  verifyPerDay: 10,
  aiModel: "",
  answerModel: "",
  websiteUrl: "",
  workspaceIcon: "",
  aboutCompany: "",
  researchGuidance: "",
  assistantTone: "friendly",
  assistantEmoji: false,
  assistantOwnWords: true,
  assistantLength: "standard",
  assistantScreenshots: true,
  assistantInstructions: "",
  assistantOffLimits: [],
  assistantHandoffTriggers: [],
  emailAgentExternal: false,
  emailAgentReply: true,
};

// Nearly every page reads settings; a short cache spares the database. Saving clears it here,
// and other instances pick the change up within a couple of seconds.
let cache: { at: number; value: Settings } | null = null;
const CACHE_MS = 2_000;

/** Values are stored as JSON so booleans, numbers, and lists keep their types. */
export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const rows = await all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const out: Settings = { ...DEFAULTS };
  for (const { key, value } of rows) {
    if (!(key in DEFAULTS)) continue;
    try {
      (out as Record<string, unknown>)[key] = JSON.parse(value);
    } catch {
      // Ignore unreadable values; the default stays.
    }
  }
  cache = { at: Date.now(), value: out };
  return out;
}

/** Whether an address may get an emailed sign-in link: it's listed itself, or its domain is. */
export function emailMayRead(allow: string[], email: string): boolean {
  return allow.some((a) => (a.includes("@") && !a.startsWith("@") ? a === email : email.endsWith(a.startsWith("@") ? a : `@${a}`)));
}

export async function updateSettings(patch: Partial<Settings>) {
  await tx(async () => {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULTS) || value === undefined) continue;
      await run("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [
        key,
        JSON.stringify(value),
      ]);
    }
  });
  cache = null;
}

/** Which secrets are present in the environment. Values never leave the server. */
export function secretStatus() {
  return {
    openaiKey: Boolean(process.env.OPENAI_API_KEY),
    githubToken: Boolean(process.env.GITHUB_TOKEN),
    webhookSecret: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
    adminPassword: Boolean(process.env.ADMIN_PASSWORD),
    readerJwt: Boolean(process.env.READER_JWT_SECRET),
    slack: Boolean(process.env.SLACK_SIGNING_SECRET),
    captureLogin: Boolean(process.env.CAPTURE_EMAIL),
    cloudStorage: Boolean(process.env.GCS_BUCKET),
    database: Boolean(process.env.DATABASE_URL),
  };
}
