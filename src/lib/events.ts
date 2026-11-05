import "server-only";
import crypto from "node:crypto";
import { all, get, run } from "./db";

// Outgoing webhooks: other systems can react when docs change.
export const EVENTS = [
  "article.published",
  "article.updated",
  "article.deleted",
  "proposal.created",
  "conversation.escalation_requested",
  "contact.submitted",
] as const;
export type EventName = (typeof EVENTS)[number];

export type Webhook = { id: number; url: string; events: string; secret: string; created_at: string };

export async function listWebhooks(): Promise<Webhook[]> {
  return all<Webhook>("SELECT id, url, events, secret, created_at FROM webhooks ORDER BY id");
}

export async function addWebhook(url: string, events: string[]): Promise<Webhook> {
  const secret = `whsec_${crypto.randomBytes(18).toString("base64url")}`;
  return (await get<Webhook>(
    "INSERT INTO webhooks (url, events, secret) VALUES ($1, $2, $3) RETURNING id, url, events, secret, created_at",
    [url, events.length ? events.join(",") : "*", secret],
  ))!;
}

export async function deleteWebhook(id: number) {
  await run("DELETE FROM webhooks WHERE id = $1", [id]);
}

export async function recentDeliveries(limit = 20) {
  return all<{ id: number; url: string; event: string; status_code: number | null; error: string | null; created_at: string }>(
    `SELECT d.id, d.event, d.status_code, d.error, d.created_at, w.url
     FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id ORDER BY d.id DESC LIMIT $1`,
    [limit],
  );
}

/** Sends an event to every subscribed webhook. Fire and forget; results are logged. */
export function emit(event: EventName, data: Record<string, unknown>) {
  void deliver(event, data).catch((err) => console.error("[webhooks]", err));
  // The Slack channel, for the events people want to hear about there (Integrations → Slack).
  void import("./slack-notify").then((m) => m.notifyEvent(event, data)).catch((err) => console.error("[slack-alerts]", err));
}

async function deliver(event: EventName, data: Record<string, unknown>) {
  const hooks = (await listWebhooks()).filter((h) => h.events === "*" || h.events.split(",").includes(event));
  if (!hooks.length) return;
  const body = JSON.stringify({ event, created_at: new Date().toISOString(), data });
  await Promise.all(
    hooks.map(async (h) => {
      const signature = crypto.createHmac("sha256", h.secret).update(body).digest("hex");
      try {
        const res = await fetch(h.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-AutoDocs-Event": event, "X-AutoDocs-Signature": `sha256=${signature}` },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        await log(h.id, event, res.status, null);
      } catch (err) {
        await log(h.id, event, null, err instanceof Error ? err.message : String(err));
      }
    }),
  );
}

async function log(webhookId: number, event: string, status: number | null, error: string | null) {
  try {
    await run("INSERT INTO webhook_deliveries (webhook_id, event, status_code, error) VALUES ($1, $2, $3, $4)", [
      webhookId,
      event,
      status,
      error,
    ]);
  } catch {
    // The webhook may have been deleted meanwhile.
  }
}
