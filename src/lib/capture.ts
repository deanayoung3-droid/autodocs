import "server-only";
import crypto from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright";
import sharp from "sharp";
import {
  AIError,
  aiConfigured,
  assertNotRefused,
  callModel,
  generateJSON,
  type FunctionTool,
  type ResponseInputItem,
} from "./ai";
import { all, get, insert, run } from "./db";
import { inboxReady, waitForSignInEmail } from "./inbox";
import { getSecrets, saveIntegration } from "./integrations";
import { tool, type ExtraTool, type StepFn } from "./research";
import { deleteFile, getFile, newKey, putFile } from "./storage";

// Screenshots of the product for the docs. An agent signs in to a "dashboard" (a test account
// on the product), moves through it, and captures the screen with red boxes around the controls
// the article talks about. The boxes come from each element's measured position on the page, not
// from the model's guess at pixels, so they land exactly. A vision check then confirms the box is
// on the right thing before the image is used.

/* Dashboards: the products the agent can sign in to */

export type Dashboard = {
  id: number;
  name: string;
  url: string;
  login_steps: string;
  session_saved_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
};

const DASHBOARD_COLUMNS = "id, name, url, login_steps, session_saved_at, last_checked_at, last_error, created_at";

export async function listDashboards(): Promise<Dashboard[]> {
  return all<Dashboard>(`SELECT ${DASHBOARD_COLUMNS} FROM dashboards ORDER BY id`);
}

export async function getDashboard(id: number): Promise<Dashboard | undefined> {
  if (!Number.isInteger(id)) return undefined;
  return get<Dashboard>(`SELECT ${DASHBOARD_COLUMNS} FROM dashboards WHERE id = $1`, [id]);
}

export async function saveDashboard(d: { id?: number; name: string; url: string; loginSteps: string }): Promise<number> {
  const url = new URL(d.url).href;
  if (d.id) {
    // A new address or new steps may mean a different account, so the saved session goes.
    await run(
      `UPDATE dashboards SET name = $1, url = $2, login_steps = $3,
         session_state = CASE WHEN url = $2 AND login_steps = $3 THEN session_state END,
         session_saved_at = CASE WHEN url = $2 AND login_steps = $3 THEN session_saved_at END
       WHERE id = $4`,
      [d.name, url, d.loginSteps, d.id],
    );
    return d.id;
  }
  return insert("INSERT INTO dashboards (name, url, login_steps) VALUES ($1, $2, $3) RETURNING id", [d.name, url, d.loginSteps]);
}

export async function deleteDashboard(id: number) {
  await run("DELETE FROM dashboards WHERE id = $1", [id]);
}

export async function forgetSession(id: number) {
  await run("UPDATE dashboards SET session_state = NULL, session_saved_at = NULL WHERE id = $1", [id]);
}

/* Secrets. The test account is saved on the Dashboard page (sealed, like other credentials) or set
   on the server as CAPTURE_EMAIL / CAPTURE_PASSWORD, which win when both exist. The steps refer to
   it as {{email}} and {{password}}, and the model never sees the values. */

type SecretName = "email" | "password";
type CaptureLogin = { email?: string; password?: string };

export async function captureLogin(): Promise<CaptureLogin & { fromServer: boolean }> {
  const saved = (await getSecrets<CaptureLogin>("capture")) ?? {};
  return {
    email: process.env.CAPTURE_EMAIL || saved.email,
    password: process.env.CAPTURE_PASSWORD || saved.password,
    fromServer: Boolean(process.env.CAPTURE_EMAIL),
  };
}

/** Saves the test account. A blank password keeps the saved one; clearPassword removes it. */
export async function saveCaptureLogin(email: string, password: string, clearPassword = false) {
  const saved = (await getSecrets<CaptureLogin>("capture")) ?? {};
  await saveIntegration("capture", { secrets: { email, password: clearPassword ? "" : password || saved.password || "" }, connected: true });
  // Sessions saved for the previous account would sign Docs Agent in as the wrong user.
  await run("UPDATE dashboards SET session_state = NULL, session_saved_at = NULL");
}

async function secret(name: SecretName): Promise<string> {
  const v = (await captureLogin())[name];
  if (!v) throw new Error(`Add the test account's ${name} on Integrations → Dashboard so the screenshot agent can sign in.`);
  return v;
}

/** The test account's email is enough for products that sign in with an emailed code or link. */
export async function captureLoginConfigured(): Promise<boolean> {
  return Boolean((await captureLogin()).email);
}

/* Saved sessions are sealed with a key derived from SESSION_SECRET, so a database copy alone
   doesn't hand over a signed-in session. */

function sealKey(): Buffer {
  return crypto.createHash("sha256").update(`autodocs-capture:${process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || ""}`).digest();
}

function seal(text: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", sealKey(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

function unseal(sealed: string): string | null {
  try {
    const buf = Buffer.from(sealed, "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", sealKey(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/* The browser: one per instance, one capture at a time */

const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2; // Retina-sharp images
const BOX_COLOR = "#E5383B";

declare global {
  var __autodocsBrowser: Promise<Browser> | undefined;
  var __autodocsCaptureQueue: Promise<unknown> | undefined;
}

async function browser(): Promise<Browser> {
  globalThis.__autodocsBrowser ??= (async () => {
    const { chromium } = await import("playwright");
    const b = await chromium.launch({
      headless: true,
      // Containers run Chromium without its sandbox and with a small /dev/shm.
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--font-render-hinting=none"],
    });
    b.on("disconnected", () => {
      globalThis.__autodocsBrowser = undefined;
    });
    return b;
  })().catch((err) => {
    globalThis.__autodocsBrowser = undefined;
    throw new Error(`Couldn't start the browser for screenshots: ${err instanceof Error ? err.message : err}`);
  });
  return globalThis.__autodocsBrowser;
}

/** Runs captures one after another on this instance; browsers are memory-hungry. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.__autodocsCaptureQueue ?? Promise.resolve();
  const next = prev.then(fn, fn);
  globalThis.__autodocsCaptureQueue = next.catch(() => {});
  return next;
}

// Steady, repeatable captures: no animations or blinking carets, no scrollbars.
const STEADY_CSS = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important;scroll-behavior:auto!important}
html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}`;

type Session = { context: BrowserContext; page: Page; origin: string; dashboard: Dashboard };

async function openSession(d: Dashboard): Promise<Session> {
  const row = await get<{ session_state: string | null }>("SELECT session_state FROM dashboards WHERE id = $1", [d.id]);
  const saved = row?.session_state ? unseal(row.session_state) : null;
  const context = await (await browser()).newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    locale: "en-US",
    timezoneId: process.env.CAPTURE_TIMEZONE || "America/New_York",
    colorScheme: "light",
    reducedMotion: "reduce",
    acceptDownloads: false,
    storageState: saved ? JSON.parse(saved) : undefined,
  });
  await context.addInitScript((css: string) => {
    const add = () => {
      if (document.getElementById("__cd_steady")) return;
      const s = document.createElement("style");
      s.id = "__cd_steady";
      s.textContent = css;
      document.documentElement.appendChild(s);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add);
    else add();
  }, STEADY_CSS);
  const page = await context.newPage();
  // Popups and new tabs would leave the agent looking at the wrong page.
  context.on("page", (p) => {
    if (p !== page) void p.close();
  });
  page.setDefaultTimeout(15_000);
  return { context, page, origin: new URL(d.url).origin, dashboard: d };
}

/** Waits for the page to finish loading and settle. */
async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  // Common loading indicators: give them a moment to clear.
  await page
    .waitForFunction(
      () =>
        !document.querySelector('[aria-busy="true"], [role="progressbar"], .animate-spin, .skeleton, [data-loading="true"]'),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(300);
}

/* Signing in */

async function onLoginPage(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      };
      const password = [...document.querySelectorAll('input[type="password"]')].some(visible);
      const path = location.pathname.toLowerCase();
      return password || /(^|\/)(login|log-in|signin|sign-in|sign_in|auth|sso)(\/|$)/.test(path);
    })
    .catch(() => false);
}

const CODE_FIELD =
  'input[autocomplete="one-time-code"], input[name*="code" i], input[id*="code" i], input[name*="otp" i], input[id*="otp" i], input[inputmode="numeric"][maxlength]';

/** Types an emailed code into a code field, including codes split across one box per digit. */
async function typeCode(page: Page, code: string): Promise<boolean> {
  const fields = page.locator(CODE_FIELD).filter({ visible: true });
  const n = await fields.count();
  if (!n) return false;
  if (n > 1 && (await fields.first().getAttribute("maxlength")) === "1") {
    await fields.first().click();
    await page.keyboard.type(code, { delay: 40 });
  } else {
    await fields.first().fill(code);
  }
  return true;
}

/** Pages that say an email is on its way, without a code field: a sign-in link was sent. */
async function waitingForLink(page: Page): Promise<boolean> {
  const text = await page.locator("body").innerText().catch(() => "");
  return /check (your )?(e-?mail|inbox)|we('ve| have)? (just )?sent|magic link|sign[- ]in link|login link/i.test(text);
}

async function submit(page: Page, fallback: () => Promise<void>) {
  const submitButton = page.locator('button[type="submit"], input[type="submit"]').filter({ visible: true }).first();
  const named = page.getByRole("button", { name: /^(log ?in|sign ?in|continue|next|submit|verify|confirm)$/i }).filter({ visible: true }).first();
  const button = (await submitButton.count()) ? submitButton : named;
  if (await button.count()) await button.click();
  else await fallback();
}

/**
 * The usual sign-in forms: email and password, two-step "email, then password", and email then a
 * one-time code or a sign-in link sent to the test account's mailbox.
 */
async function standardLogin(page: Page): Promise<boolean> {
  const since = new Date();
  const mailbox = await inboxReady();
  for (let stage = 0; stage < 4; stage++) {
    if (!(await onLoginPage(page))) return true;
    if (mailbox && (await page.locator(CODE_FIELD).filter({ visible: true }).count())) {
      const { code } = await waitForSignInEmail(since, "code");
      if (!code || !(await typeCode(page, code))) return false;
      // Many code forms submit themselves once the last digit is in.
      await settle(page);
      if (await onLoginPage(page)) await submit(page, () => page.keyboard.press("Enter"));
      await settle(page);
      continue;
    }
    if (mailbox && !(await page.locator('input[type="password"]').filter({ visible: true }).count()) && (await waitingForLink(page))) {
      const { link } = await waitForSignInEmail(since, "link");
      if (!link) return false;
      await page.goto(link, { waitUntil: "domcontentloaded" });
      await settle(page);
      continue;
    }
    const email = page
      .locator(
        'input[type="email"], input[autocomplete="username"], input[autocomplete="email"], input[name*="email" i], input[id*="email" i], input[placeholder*="email" i]',
      )
      .filter({ visible: true })
      .first();
    const password = page.locator('input[type="password"]').filter({ visible: true }).first();
    let acted = false;
    if ((await email.count()) && !(await email.inputValue())) {
      await email.fill(await secret("email"));
      acted = true;
    }
    if ((await password.count()) && (await captureLogin()).password) {
      await password.fill(await secret("password"));
      acted = true;
    }
    if (!acted) return false;
    const hasPassword = (await password.count()) > 0;
    await submit(page, () => (hasPassword ? password : email).press("Enter"));
    await settle(page);
  }
  return !(await onLoginPage(page));
}

async function ensureSignedIn(s: Session, step: StepFn): Promise<void> {
  const { page, dashboard } = s;
  await page.goto(dashboard.url, { waitUntil: "domcontentloaded" });
  await settle(page);
  if (!(await onLoginPage(page))) return;

  await step(`Signing in to ${dashboard.name}`);
  let ok = false;
  const login = await captureLoginConfigured();
  if (login) ok = await standardLogin(page).catch(() => false);
  if (!ok && dashboard.login_steps.trim() && aiConfigured()) {
    // Unusual sign-in flows: the agent follows the written steps, typing secrets by name only.
    const result = await agentLoop(s, {
      goal: `Sign in by following these steps exactly:\n${dashboard.login_steps}\n\nWhen you're signed in and see the product, call done. Don't capture anything.`,
      mode: "login",
      step,
    });
    ok = result.kind === "done" && !(await onLoginPage(page));
  }
  if (!ok) {
    const message = login
      ? `Couldn't sign in to ${dashboard.name}. Check the login steps, the login email, and the test account.`
      : `Add the test account (and its password, if ${dashboard.name} uses one) on Integrations → Dashboard so the agent can sign in.`;
    await run("UPDATE dashboards SET last_checked_at = now(), last_error = $1 WHERE id = $2", [message, dashboard.id]);
    throw new Error(message);
  }
  const state = JSON.stringify(await s.context.storageState());
  await run("UPDATE dashboards SET session_state = $1, session_saved_at = now(), last_checked_at = now(), last_error = NULL WHERE id = $2", [
    seal(state),
    dashboard.id,
  ]);
}

/* What the agent sees: a numbered outline of visible elements, plus the screen itself */

type OutlineItem = { ref: number; role: string; name: string; x: number; y: number; w: number; h: number; inView: boolean; disabled: boolean };

/** Marks visible elements with data-cd-ref and describes them. Refs are valid until the page changes. */
async function outline(page: Page): Promise<{ url: string; title: string; heading: string; items: OutlineItem[] }> {
  return page.evaluate(() => {
    document.querySelectorAll("[data-cd-ref]").forEach((e) => e.removeAttribute("data-cd-ref"));
    const vw = innerWidth;
    const vh = innerHeight;
    const selector = [
      "a[href]",
      "button",
      "input:not([type=hidden])",
      "select",
      "textarea",
      "summary",
      "[role=button]",
      "[role=link]",
      "[role=tab]",
      "[role=menuitem]",
      "[role=option]",
      "[role=checkbox]",
      "[role=switch]",
      "[role=combobox]",
      "[role=radio]",
      "[contenteditable=true]",
      "h1",
      "h2",
      "h3",
      "[role=heading]",
      "th",
      "label",
      "[role=dialog]",
      "[role=row]",
      "nav",
    ].join(",");
    const text = (el: Element) => (el as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "";
    const nameOf = (el: Element): string => {
      const aria = el.getAttribute("aria-label");
      if (aria) return aria;
      const by = el.getAttribute("aria-labelledby");
      if (by) return by.split(" ").map((id) => text(document.getElementById(id) ?? document.createElement("i"))).join(" ");
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : el.closest("label");
        const placeholder = "placeholder" in el ? el.placeholder : "";
        return [label ? text(label) : "", placeholder, el instanceof HTMLSelectElement ? el.selectedOptions[0]?.text : ""].filter(Boolean).join(" · ");
      }
      return text(el) || el.getAttribute("title") || (el.querySelector("img") as HTMLImageElement | null)?.alt || "";
    };
    const roleOf = (el: Element): string => {
      const r = el.getAttribute("role");
      if (r) return r;
      const tag = el.tagName.toLowerCase();
      if (tag === "a") return "link";
      if (tag === "input") return `input:${(el as HTMLInputElement).type}`;
      if (/^h[1-6]$/.test(tag)) return "heading";
      return tag;
    };
    const items: OutlineItem[] = [];
    let n = 0;
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width < 3 || r.height < 3) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      const name = nameOf(el).slice(0, 90);
      const role = roleOf(el);
      // Containers are listed only when they're named, to keep the outline readable.
      if ((role === "nav" || role === "row" || role === "dialog") && !name) continue;
      el.setAttribute("data-cd-ref", String(++n));
      items.push({
        ref: n,
        role,
        name: role === "row" ? name.slice(0, 60) : name,
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        inView: r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw,
        disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true",
      });
      if (n >= 350) break;
    }
    const heading = text(document.querySelector("h1") ?? document.createElement("i")).slice(0, 120);
    return { url: location.href, title: document.title, heading, items };
  });
}

function outlineText(o: Awaited<ReturnType<typeof outline>>): string {
  const lines = o.items.map(
    (i) =>
      `[${i.ref}] ${i.role} "${i.name}" at ${i.x},${i.y} ${i.w}×${i.h}${i.inView ? "" : " (off screen)"}${i.disabled ? " (disabled)" : ""}`,
  );
  return `Page: ${o.title}\nURL: ${o.url}\nMain heading: ${o.heading || "(none)"}\nViewport: ${VIEWPORT.width}×${VIEWPORT.height}\n\n${lines.join("\n")}`;
}

async function screenImage(page: Page): Promise<string> {
  const jpeg = await page.screenshot({ type: "jpeg", quality: 70, scale: "css" });
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/* Drawing the boxes */

export type Box = { x: number; y: number; w: number; h: number };

/** Draws the red boxes on a clean capture. Box coordinates are in CSS pixels; `scale` is the capture's pixel ratio. */
export async function annotate(raw: Buffer, boxes: Box[], scale: number): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(raw).metadata();
  const pad = 6 * scale;
  const stroke = 3 * scale;
  const radius = 8 * scale;
  const shapes = boxes.map((b, i) => {
    const x = Math.max(stroke, b.x * scale - pad);
    const y = Math.max(stroke, b.y * scale - pad);
    const w = Math.min(width - stroke - x, b.w * scale + pad * 2);
    const h = Math.min(height - stroke - y, b.h * scale + pad * 2);
    // A thin white halo keeps the red readable on dark and busy backgrounds.
    const rects = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="${stroke + 2 * scale}"/>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="none" stroke="${BOX_COLOR}" stroke-width="${stroke}"/>`;
    if (boxes.length < 2) return rects;
    // Several boxes get numbers, matching the order of the steps.
    const r = 11 * scale;
    const cx = Math.max(r + 1, x);
    const cy = Math.max(r + 1, y);
    return `${rects}
<circle cx="${cx}" cy="${cy}" r="${r}" fill="${BOX_COLOR}" stroke="#ffffff" stroke-width="${1.5 * scale}"/>
<text x="${cx}" y="${cy + 4.5 * scale}" text-anchor="middle" font-family="DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif" font-size="${13 * scale}" font-weight="700" fill="#ffffff">${i + 1}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapes.join("\n")}</svg>`;
  return sharp(raw)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .webp({ lossless: true, effort: 4 })
    .toBuffer();
}

/* Screenshots */

export type Screenshot = {
  id: number;
  dashboard_id: number | null;
  page_url: string;
  alt: string;
  caption: string;
  raw_key: string;
  image_key: string;
  width: number;
  height: number;
  scale: number;
  boxes: Box[];
  recipe: { goal?: string; highlight?: string; actions?: string[] };
  verified: "passed" | "failed" | "unchecked";
  verify_note: string | null;
  created_at: string;
  updated_at: string;
};

const SHOT_COLUMNS = "id, dashboard_id, page_url, alt, caption, raw_key, image_key, width, height, scale, boxes, recipe, verified, verify_note, created_at, updated_at";

export async function listScreenshots(limit = 30): Promise<Screenshot[]> {
  return all<Screenshot>(`SELECT ${SHOT_COLUMNS} FROM screenshots ORDER BY updated_at DESC LIMIT $1`, [limit]);
}

export async function getScreenshot(id: number): Promise<Screenshot | undefined> {
  if (!Number.isInteger(id)) return undefined;
  return get<Screenshot>(`SELECT ${SHOT_COLUMNS} FROM screenshots WHERE id = $1`, [id]);
}

/** Where articles link a screenshot. Stable across retakes and box edits. */
export const screenshotUrl = (id: number) => `/screenshots/${id}`;

export const screenshotMarkdown = (s: Pick<Screenshot, "id" | "alt" | "caption">) =>
  `![${s.alt.replace(/[[\]]/g, "")}](${screenshotUrl(s.id)})${s.caption ? `\n\n${s.caption}` : ""}`;

/** Redraws a screenshot's boxes from its clean capture, e.g. after a teammate adjusts them. */
export async function redrawScreenshot(id: number, boxes: Box[]): Promise<void> {
  const shot = await getScreenshot(id);
  if (!shot) throw new Error("Screenshot not found.");
  const raw = await getFile(shot.raw_key);
  if (!raw) throw new Error("The original capture is missing; retake the screenshot.");
  const clean = boxes
    .filter((b) => b.w > 2 && b.h > 2)
    .map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }));
  const key = newKey("screenshots", "webp");
  await putFile(key, await annotate(raw.body, clean, shot.scale));
  await run("UPDATE screenshots SET image_key = $1, boxes = $2, verified = 'unchecked', verify_note = NULL, updated_at = now() WHERE id = $3", [
    key,
    JSON.stringify(clean),
    id,
  ]);
  await deleteFile(shot.image_key);
}

export async function deleteScreenshot(id: number) {
  const shot = await getScreenshot(id);
  if (!shot) return;
  await run("DELETE FROM screenshots WHERE id = $1", [id]);
  await Promise.all([deleteFile(shot.raw_key), deleteFile(shot.image_key)]);
}

/* The agent */

// Controls the agent must never press: they change or send real things, even on a test account.
const FORBIDDEN = /\b(delete|remove|archive|revoke|deactivate|disable|destroy|erase|purge|pay|charge|refund|void|transfer|disburse|send|invite|e-?mail|share|publish|sign out|log ?out|cancel (subscription|plan|account))\b/i;

const AGENT_TOOLS: FunctionTool[] = [
  tool("view", "See the current page: a numbered outline of visible elements and an image of the screen.", {}),
  tool("goto", "Open a page of the product by path, like /cases or /settings/profile.", { path: { type: "string" } }),
  tool("click", "Click the element with this ref number.", { ref: { type: "integer" } }),
  tool("type", "Type text into the field with this ref number, replacing what's there.", {
    ref: { type: "integer" },
    text: { type: "string" },
  }),
  tool("type_secret", "Type the sign-in email or password into a field. You never see the value.", {
    ref: { type: "integer" },
    secret: { type: "string", enum: ["email", "password"] },
  }),
  tool("press", "Press a key, like Enter, Escape, or Tab.", { key: { type: "string" } }),
  tool("select_option", "Choose an option in a <select> field by its visible label.", {
    ref: { type: "integer" },
    label: { type: "string" },
  }),
  tool("scroll", "Scroll an element (ref) into view, or scroll the page when ref is 0.", {
    ref: { type: "integer" },
    direction: { type: "string", enum: ["up", "down"] },
  }),
  tool("wait", "Wait for the page to finish loading, up to the given number of seconds.", { seconds: { type: "integer" } }),
];

const CAPTURE_TOOL = tool(
  "capture",
  "Capture the screen now with red boxes around these elements. Usually exactly one: the control the reader acts on.",
  {
    refs: { type: "array", items: { type: "integer" } },
    alt: { type: "string", description: "Alt text naming the screen and the boxed control." },
    caption: { type: "string", description: "One sentence shown under the image." },
  },
);

const DONE_TOOL = tool("done", "Finish: you're signed in and can see the product.", {});
const EMAIL_TOOLS: FunctionTool[] = [
  tool(
    "enter_email_code",
    "Type the one-time code from the newest sign-in email to the test account into this field (or the first of a row of digit boxes). Waits up to 90 seconds for the email. You never see the code.",
    { ref: { type: "integer" } },
  ),
  tool("open_email_link", "Open the sign-in link from the newest sign-in email to the test account. Waits up to 90 seconds for the email.", {}),
];
const GIVE_UP_TOOL = tool("give_up", "Stop when the goal can't be reached. Explain why in one sentence.", { reason: { type: "string" } });

type LoopResult =
  | { kind: "captured"; screenshot: Screenshot }
  | { kind: "done" }
  | { kind: "gave_up"; reason: string };

type Capture = { raw: Buffer; boxes: Box[]; url: string; alt: string; caption: string };

async function agentLoop(
  s: Session,
  opts: { goal: string; highlight?: string; mode: "capture" | "login"; step: StepFn; onCapture?: (c: Capture) => Promise<Screenshot | string> },
): Promise<LoopResult> {
  const { page, origin, dashboard } = s;
  const actions: string[] = [];
  const loginSince = new Date();
  const mailbox = opts.mode === "login" && (await inboxReady());
  const instructions = `You operate a web browser signed in to ${dashboard.name} (${origin}) with a dedicated test account.
${opts.mode === "capture" ? "Your job is to take one documentation screenshot." : `Your job is to sign in.${mailbox ? " If the product emails a one-time code or a sign-in link, use enter_email_code or open_email_link; the test account's mail arrives automatically." : ""}`}

How to work:
- Call view to see the page: a numbered outline of visible elements and an image of the screen. Refs change whenever the page changes, so view again after every action before using a ref.
- Move around with goto (paths on ${origin} only) or by clicking. Prefer the product's own navigation when the path isn't obvious.
- Get the screen into the state the goal describes: open the page, menu, form, or dialog. Don't submit forms unless the goal needs the result. Never press anything that deletes, removes, archives, revokes, pays, charges, refunds, sends, shares, publishes, invites, or signs out; those are blocked. If the goal can't be reached without one, call give_up.
- Close anything unrelated that covers the page (cookie banners, tours, announcements) before capturing.${
    opts.mode === "capture"
      ? `
- When the screen matches the goal, call capture with the ref of the element to box: the smallest element that is the control itself (the button, not the toolbar around it). Box one element unless the goal names several.
- If capture reports a problem, fix it and capture again.`
      : ""
  }`;
  const input: ResponseInputItem[] = [
    {
      role: "user",
      content: `Goal: ${opts.goal}${opts.highlight ? `\nBox in red: ${opts.highlight}` : ""}\n\nYou're on ${page.url()}. Start by calling view.`,
    },
  ];
  const tools = [...AGENT_TOOLS, ...(mailbox ? EMAIL_TOOLS : []), opts.mode === "capture" ? CAPTURE_TOOL : DONE_TOOL, GIVE_UP_TOOL];
  const locate = (ref: unknown) => page.locator(`[data-cd-ref="${Number(ref)}"]`);
  const describe = async (ref: unknown) =>
    (
      await locate(ref)
        .first()
        .evaluate((el) => (el.getAttribute("aria-label") || (el as HTMLElement).innerText || (el as HTMLInputElement).value || "").trim().slice(0, 80))
        .catch(() => "")
    ) || `element ${ref}`;

  const exec = async (name: string, a: Record<string, unknown>): Promise<string | ResponseInputItem.FunctionCallOutput["output"]> => {
    switch (name) {
      case "view": {
        const o = await outline(page);
        // Older screen images are dropped from the conversation to keep requests small.
        for (const item of input) {
          if (item.type === "function_call_output" && Array.isArray(item.output)) {
            item.output = item.output.filter((p) => p.type === "input_text");
          }
        }
        return [
          { type: "input_text", text: outlineText(o) },
          { type: "input_image", image_url: await screenImage(page), detail: "high" },
        ];
      }
      case "goto": {
        const target = new URL(String(a.path ?? "/"), origin);
        if (target.origin !== origin) return `Only pages on ${origin} are allowed.`;
        await page.goto(target.href, { waitUntil: "domcontentloaded" });
        await settle(page);
        actions.push(`Open ${target.pathname}${target.search}`);
        return `Opened ${page.url()}. Call view.`;
      }
      case "click": {
        const el = locate(a.ref);
        if (!(await el.count())) return `No element ${a.ref}; the page changed. Call view.`;
        const label = await describe(a.ref);
        if (opts.mode === "capture" && FORBIDDEN.test(label)) return `Blocked: "${label}" could change or send something. Capture it without pressing it, or give up.`;
        await el.first().click({ timeout: 10_000 });
        await settle(page);
        if (new URL(page.url()).origin !== origin && opts.mode === "capture") {
          await page.goBack().catch(() => {});
          await settle(page);
          return `That left ${origin}, so I went back. Choose something else.`;
        }
        actions.push(`Click “${label}”`);
        return `Clicked “${label}”. Now on ${page.url()}. Call view.`;
      }
      case "type": {
        const el = locate(a.ref);
        if (!(await el.count())) return `No element ${a.ref}; the page changed. Call view.`;
        await el.first().fill(String(a.text ?? ""));
        actions.push(`Type “${String(a.text).slice(0, 40)}” into “${await describe(a.ref)}”`);
        return "Typed. Call view to check.";
      }
      case "type_secret": {
        const el = locate(a.ref);
        if (!(await el.count())) return `No element ${a.ref}; the page changed. Call view.`;
        await el.first().fill(await secret(a.secret === "password" ? "password" : "email"));
        return `Typed the ${a.secret}.`;
      }
      case "enter_email_code": {
        const el = locate(a.ref);
        if (!(await el.count())) return `No element ${a.ref}; the page changed. Call view.`;
        const { code } = await waitForSignInEmail(loginSince, "code");
        if (!code) return "The sign-in email has no code. Try open_email_link.";
        if ((await el.first().getAttribute("maxlength")) === "1") {
          await el.first().click();
          await page.keyboard.type(code, { delay: 40 });
        } else {
          await el.first().fill(code);
        }
        await settle(page);
        return "Typed the code from the email. Call view.";
      }
      case "open_email_link": {
        const { link } = await waitForSignInEmail(loginSince, "link");
        if (!link) return "The sign-in email has no link. Try enter_email_code.";
        await page.goto(link, { waitUntil: "domcontentloaded" });
        await settle(page);
        return `Opened the sign-in link. Now on ${page.url()}. Call view.`;
      }
      case "press": {
        await page.keyboard.press(String(a.key ?? "Enter"));
        await settle(page);
        actions.push(`Press ${a.key}`);
        return `Pressed ${a.key}. Call view.`;
      }
      case "select_option": {
        const el = locate(a.ref);
        if (!(await el.count())) return `No element ${a.ref}; the page changed. Call view.`;
        await el.first().selectOption({ label: String(a.label ?? "") });
        await settle(page);
        actions.push(`Choose “${a.label}”`);
        return `Chose “${a.label}”. Call view.`;
      }
      case "scroll": {
        if (Number(a.ref) > 0 && (await locate(a.ref).count())) await locate(a.ref).first().scrollIntoViewIfNeeded();
        else await page.mouse.wheel(0, a.direction === "up" ? -600 : 600);
        await page.waitForTimeout(250);
        return "Scrolled. Call view.";
      }
      case "wait": {
        await page.waitForTimeout(Math.min(Math.max(Number(a.seconds) || 1, 1), 10) * 1000);
        await settle(page);
        return "Waited. Call view.";
      }
      case "capture": {
        const refs = (Array.isArray(a.refs) ? a.refs : []).map(Number).filter((n) => n > 0).slice(0, 6);
        if (!refs.length) return "Give at least one ref to box.";
        for (const ref of refs) if (!(await locate(ref).count())) return `No element ${ref}; the page changed. Call view.`;
        await locate(refs[0]).first().scrollIntoViewIfNeeded().catch(() => {});
        await settle(page);
        const boxes: Box[] = [];
        for (const ref of refs) {
          const b = await locate(ref).first().boundingBox();
          if (!b) return `Element ${ref} isn't visible. Call view.`;
          if (b.y < 0 || b.x < 0 || b.y + b.height > VIEWPORT.height || b.x + b.width > VIEWPORT.width) {
            return `Element ${ref} doesn't fit on the screen. Scroll so it's fully visible, or box something smaller.`;
          }
          // Something else (a toast, a tooltip, a sticky bar) mustn't sit on top of it.
          const covered = await locate(ref)
            .first()
            .evaluate((el) => {
              const r = el.getBoundingClientRect();
              const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return !(top && (el === top || el.contains(top) || top.contains(el)));
            });
          if (covered) return `Element ${ref} is covered by something else. Close it (Escape often works), then capture again.`;
          boxes.push({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) });
        }
        const raw = await page.screenshot({ type: "png", scale: "device" });
        const result = await opts.onCapture!({ raw, boxes, url: page.url(), alt: String(a.alt ?? ""), caption: String(a.caption ?? "") });
        if (typeof result === "string") return result;
        throw new CapturedSignal(result);
      }
      default:
        return `Unknown tool ${name}.`;
    }
  };

  for (let turn = 0; turn < 22; turn++) {
    const res = await callModel("capture", { instructions, input, tools, toolChoice: "required", effort: "low" });
    assertNotRefused(res);
    const calls = res.output.filter((o) => o.type === "function_call");
    if (!calls.length) {
      input.push({ role: "user", content: "Call a tool." });
      continue;
    }
    for (const c of calls) input.push({ type: "function_call", call_id: c.call_id, name: c.name, arguments: c.arguments });
    for (const c of calls) {
      const args = JSON.parse(c.arguments || "{}") as Record<string, unknown>;
      if (c.name === "give_up") return { kind: "gave_up", reason: String(args.reason ?? "The agent couldn't reach that screen.") };
      if (c.name === "done") return { kind: "done" };
      let output: string | ResponseInputItem.FunctionCallOutput["output"];
      const before = actions.length;
      try {
        output = await exec(c.name, args);
        if (actions.length > before) await opts.step(`Screenshot agent: ${actions.at(-1)}`);
      } catch (err) {
        if (err instanceof CapturedSignal) {
          err.screenshot.recipe = { ...err.screenshot.recipe, actions };
          await run("UPDATE screenshots SET recipe = $1 WHERE id = $2", [JSON.stringify(err.screenshot.recipe), err.screenshot.id]);
          return { kind: "captured", screenshot: err.screenshot };
        }
        output = `That didn't work: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}. Call view and try another way.`;
      }
      input.push({ type: "function_call_output", call_id: c.call_id, output });
    }
  }
  return { kind: "gave_up", reason: "The screenshot agent ran out of steps before reaching the screen." };
}

class CapturedSignal extends Error {
  constructor(public screenshot: Screenshot) {
    super("captured");
  }
}

type Verdict = { boxes_correct: boolean; page_ready: boolean; problems: string };

/** Asks a second look whether the boxes sit on the right controls and the page is ready to publish. */
async function verifyShot(image: Buffer, goal: string, highlight: string): Promise<Verdict> {
  const preview = await sharp(image).resize({ width: 1440 }).jpeg({ quality: 80 }).toBuffer();
  return generateJSON<Verdict>({
    purpose: "capture",
    system:
      "You check documentation screenshots before they're published. Be strict about the red boxes: each must surround the requested control itself, tightly, and nothing else. Be strict that the page is ready: no loading spinners or skeletons, no error messages unless the goal is about them, and no unrelated popups, banners, or tours covering content.",
    prompt: [
      {
        role: "user",
        content: [
          { type: "input_text", text: `The screenshot should show: ${goal}\nThe red box should surround: ${highlight || "the control the goal is about"}` },
          { type: "input_image", image_url: `data:image/jpeg;base64,${preview.toString("base64")}`, detail: "high" },
        ],
      },
    ],
    schema: {
      type: "object",
      properties: {
        boxes_correct: { type: "boolean" },
        page_ready: { type: "boolean" },
        problems: { type: "string", description: "What's wrong, in one or two sentences. Empty when both are true." },
      },
      required: ["boxes_correct", "page_ready", "problems"],
      additionalProperties: false,
    },
    effort: "low",
  });
}

export type CaptureRequest = {
  dashboardId?: number;
  goal: string;
  highlight: string;
  /** Retake: replace this screenshot's images, keeping its address. */
  screenshotId?: number;
};

/** Signs in, finds the screen, and captures it with red boxes. Returns the saved screenshot. */
export async function captureScreenshot(req: CaptureRequest, step: StepFn = () => {}): Promise<Screenshot> {
  if (!aiConfigured()) throw new AIError("Screenshots need the OpenAI API key (OPENAI_API_KEY) on the server.");
  const dashboard = req.dashboardId ? await getDashboard(req.dashboardId) : (await listDashboards())[0];
  if (!dashboard) throw new Error("Connect a dashboard in Integrations → Dashboard first.");

  return exclusive(async () => {
    const s = await openSession(dashboard);
    try {
      await ensureSignedIn(s, step);
      let attempts = 0;
      const result = await agentLoop(s, {
        goal: req.goal,
        highlight: req.highlight,
        mode: "capture",
        step,
        onCapture: async (c) => {
          attempts++;
          const image = await annotate(c.raw, c.boxes, SCALE);
          const verdict = await verifyShot(image, req.goal, req.highlight).catch(
            (): Verdict => ({ boxes_correct: true, page_ready: true, problems: "" }),
          );
          const passed = verdict.boxes_correct && verdict.page_ready;
          // A failed check goes back to the agent to fix, twice; after that the shot is kept, flagged.
          if (!passed && attempts < 3) return `The check found a problem: ${verdict.problems} Fix it and capture again.`;
          return save(c, image, passed ? "passed" : "failed", passed ? null : verdict.problems);
        },
      });
      if (result.kind === "captured") {
        await step(`Captured ${result.screenshot.verified === "passed" ? "and checked " : ""}a screenshot of ${new URL(result.screenshot.page_url).pathname}`);
        return result.screenshot;
      }
      throw new Error(result.kind === "gave_up" ? result.reason : "The screenshot agent stopped without capturing.");
    } finally {
      await s.context.close().catch(() => {});
    }
  });

  async function save(c: Capture, image: Buffer, verified: Screenshot["verified"], note: string | null): Promise<Screenshot> {
    const rawKey = newKey("screenshots", "png");
    const imageKey = newKey("screenshots", "webp");
    await Promise.all([putFile(rawKey, c.raw), putFile(imageKey, image)]);
    const recipe = JSON.stringify({ goal: req.goal, highlight: req.highlight });
    const previous = req.screenshotId ? await getScreenshot(req.screenshotId) : undefined;
    let id: number;
    if (previous) {
      await run(
        `UPDATE screenshots SET dashboard_id = $1, page_url = $2, alt = $3, caption = $4, raw_key = $5, image_key = $6,
           width = $7, height = $8, scale = $9, boxes = $10, recipe = $11, verified = $12, verify_note = $13, updated_at = now()
         WHERE id = $14`,
        [dashboard!.id, c.url, c.alt || previous.alt, c.caption || previous.caption, rawKey, imageKey, VIEWPORT.width, VIEWPORT.height, SCALE, JSON.stringify(c.boxes), recipe, verified, note, previous.id],
      );
      await Promise.all([deleteFile(previous.raw_key), deleteFile(previous.image_key)]);
      id = previous.id;
    } else {
      id = await insert(
        `INSERT INTO screenshots (dashboard_id, page_url, alt, caption, raw_key, image_key, width, height, scale, boxes, recipe, verified, verify_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [dashboard!.id, c.url, c.alt, c.caption, rawKey, imageKey, VIEWPORT.width, VIEWPORT.height, SCALE, JSON.stringify(c.boxes), recipe, verified, note],
      );
    }
    return (await getScreenshot(id))!;
  }
}

/** Signs in and saves a plain screenshot of where the product lands, to prove the connection works. */
export async function testDashboard(dashboardId: number, step: StepFn = () => {}): Promise<Screenshot> {
  const dashboard = await getDashboard(dashboardId);
  if (!dashboard) throw new Error("Dashboard not found.");
  return exclusive(async () => {
    const s = await openSession(dashboard);
    try {
      await ensureSignedIn(s, step);
      await settle(s.page);
      const raw = await s.page.screenshot({ type: "png", scale: "device" });
      const rawKey = newKey("screenshots", "png");
      const imageKey = newKey("screenshots", "webp");
      await Promise.all([putFile(rawKey, raw), putFile(imageKey, await annotate(raw, [], SCALE))]);
      const id = await insert(
        `INSERT INTO screenshots (dashboard_id, page_url, alt, caption, raw_key, image_key, width, height, scale, recipe, verified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'unchecked') RETURNING id`,
        [dashboard.id, s.page.url(), `${dashboard.name} after signing in`, "Connection test", rawKey, imageKey, VIEWPORT.width, VIEWPORT.height, SCALE, JSON.stringify({ goal: "Connection test" })],
      );
      await run("UPDATE dashboards SET last_checked_at = now(), last_error = NULL WHERE id = $1", [dashboard.id]);
      return (await getScreenshot(id))!;
    } catch (err) {
      await run("UPDATE dashboards SET last_checked_at = now(), last_error = $1 WHERE id = $2", [
        err instanceof Error ? err.message : String(err),
        dashboard.id,
      ]);
      throw err;
    } finally {
      await s.context.close().catch(() => {});
    }
  });
}

/** Background job: a capture, a retake, or a connection test, queued from the admin. */
export async function runCaptureJob(p: Record<string, unknown>, jobId: number): Promise<void> {
  // While the job runs, its latest step sits in the job's error column (prefixed "…") so the admin
  // can show progress; it's cleared on success and replaced by the real error on failure.
  const step =(label: string) => void run("UPDATE jobs SET error = $1 WHERE id = $2", [`… ${label}`.slice(0, 300), jobId]).catch(() => {});
  if (p.test) {
    await testDashboard(Number(p.dashboardId), step);
    return;
  }
  const retake = p.screenshotId ? await getScreenshot(Number(p.screenshotId)) : undefined;
  await captureScreenshot(
    {
      dashboardId: Number(p.dashboardId) || retake?.dashboard_id || undefined,
      goal: String(p.goal || retake?.recipe.goal || ""),
      highlight: String(p.highlight || retake?.recipe.highlight || ""),
      screenshotId: retake?.id,
    },
    step,
  );
  await run("UPDATE jobs SET error = NULL WHERE id = $1", [jobId]);
}

/** The screenshot tool Docs Agent gets while writing, when a dashboard is connected. */
export async function screenshotTools(step: StepFn): Promise<ExtraTool[]> {
  if (!aiConfigured()) return [];
  const dashboards = await listDashboards();
  if (!dashboards.length) return [];
  const names = dashboards.map((d) => `${d.id}: ${d.name} (${d.url})`).join("; ");
  return [
    {
      tool: tool(
        "take_screenshot",
        `Sign in to the product and capture a screenshot with a red box around one control. Takes about a minute. Dashboards: ${names}. Returns Markdown to paste into the article.`,
        {
          dashboard_id: { type: "integer", description: "Which dashboard. Use the first one unless the task says otherwise." },
          goal: { type: "string", description: "The screen to capture and its state, e.g. 'The Cases list' or 'The Create Case form, open and empty'." },
          highlight: { type: "string", description: "The one control to box in red, by its label, e.g. 'the + Create Case button'." },
        },
      ),
      run: async (input) => {
        try {
          const shot = await captureScreenshot(
            { dashboardId: Number(input.dashboard_id) || undefined, goal: String(input.goal ?? ""), highlight: String(input.highlight ?? "") },
            step,
          );
          return `${screenshotMarkdown(shot)}

Captured at ${shot.page_url}.${
            shot.verified === "failed" ? ` The automatic check had a concern: ${shot.verify_note} Mention it in your reason.` : ""
          } Use this Markdown exactly; you may edit the alt text and caption.`;
        } catch (err) {
          return `Couldn't capture it: ${err instanceof Error ? err.message : String(err)}. Write the article without this screenshot.`;
        }
      },
    },
  ];
}
