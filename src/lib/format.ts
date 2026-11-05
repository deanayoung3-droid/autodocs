/** SQLite datetime('now') strings are UTC without a zone marker; ISO strings that carry one are read as-is. */
export function parseSqlDate(s: string): Date {
  return /(Z|[+-]\d\d:?\d\d)$/i.test(s) ? new Date(s) : new Date(s.replace(" ", "T") + "Z");
}

export function timeAgo(s: string, now = Date.now()): string {
  const secs = Math.max(0, Math.round((now - parseSqlDate(s).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return parseSqlDate(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDate(s: string): string {
  return parseSqlDate(s).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "article"
  );
}

export function usd(n: number): string {
  if (n > 0 && n < 0.01) return "<$0.01";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Search snippets mark hits with \u0001…\u0002 so they can be rendered without innerHTML. */
export const HIT_START = "\u0001";
export const HIT_END = "\u0002";

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
