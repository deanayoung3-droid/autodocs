import "server-only";
import { all, get, insert, run } from "./db";
import { sanitizeWidget, WIDGET_DEFAULTS, type WidgetSettings } from "./widget-config";

export type { WidgetSettings } from "./widget-config";

export type Widget = {
  id: number;
  name: string;
  settings: WidgetSettings;
  created_at: string;
  impressions: number;
  searches: number;
  views: number;
};

export { WIDGET_DEFAULTS };

function parse(json: string): WidgetSettings {
  try {
    return sanitizeWidget(JSON.parse(json));
  } catch {
    return { ...WIDGET_DEFAULTS };
  }
}

type WidgetRow = Omit<Widget, "settings"> & { settings_json: string };

const SELECT = `SELECT w.id, w.name, w.settings_json, w.created_at,
  count(e.id) FILTER (WHERE e.kind = 'impression') AS impressions,
  count(e.id) FILTER (WHERE e.kind = 'search') AS searches,
  count(e.id) FILTER (WHERE e.kind = 'view') AS views
  FROM widgets w
  LEFT JOIN widget_events e ON e.widget_id = w.id AND e.created_at >= now() - interval '30 days'`;

const toWidget = ({ settings_json, ...w }: WidgetRow): Widget => ({ ...w, settings: parse(settings_json) });

export async function listWidgets(): Promise<Widget[]> {
  if (!(await get("SELECT 1 FROM widgets LIMIT 1"))) await createWidget("Help widget");
  return (await all<WidgetRow>(`${SELECT} GROUP BY w.id ORDER BY w.id`)).map(toWidget);
}

export async function getWidget(id: number): Promise<Widget | undefined> {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const w = await get<WidgetRow>(`${SELECT} WHERE w.id = $1 GROUP BY w.id`, [id]);
  return w ? toWidget(w) : undefined;
}

export async function createWidget(name: string): Promise<number> {
  return insert("INSERT INTO widgets (name, settings_json) VALUES ($1, $2) RETURNING id", [name, JSON.stringify(WIDGET_DEFAULTS)]);
}

export async function updateWidget(id: number, name: string, settings: WidgetSettings) {
  await run("UPDATE widgets SET name = $1, settings_json = $2 WHERE id = $3", [name, JSON.stringify(sanitizeWidget(settings)), id]);
}

export async function deleteWidget(id: number) {
  await run("DELETE FROM widgets WHERE id = $1", [id]);
}

export async function recordWidgetEvent(id: number, kind: "impression" | "search" | "view") {
  if (!Number.isInteger(id) || id <= 0) return;
  // Only for widgets that exist; a stale embed code is ignored.
  await run("INSERT INTO widget_events (widget_id, kind) SELECT id, $2 FROM widgets WHERE id = $1", [id, kind]);
}
