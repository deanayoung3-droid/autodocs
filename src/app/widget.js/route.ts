import { getSettings } from "@/lib/settings";
import { getWidget, listWidgets } from "@/lib/widgets";

const ICONS: Record<string, string> = {
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17h.01"/>',
  chat: '<path d="M5 18.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8.5z"/>',
  book: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19"/>',
  spark: '<path d="M12 4l1.8 4.9L19 10.5l-5.2 1.6L12 17l-1.8-4.9L5 10.5l5.2-1.6z"/>',
  close: '<path d="M7 10l5 5 5-5"/>',
};

// The embed script: a launcher button that opens the widget (/widget) in a panel, styled by the
// widget's Launcher settings. Also a small API for the host page:
//   AutoDocs("open") · AutoDocs("close") · AutoDocs("toggle") · AutoDocs("ask", "How do I…?")
// and events on window: autodocs:open, autodocs:close, autodocs:escalationRequested, autodocs:contact.
// (Messages between this script and the widget frame keep their internal autodocs: names.)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, "") || url.origin;
  const widget = (await getWidget(Number(url.searchParams.get("id")))) ?? (await listWidgets())[0];
  const { accent, brandName } = await getSettings();
  const w = widget.settings;
  const config = {
    origin,
    id: widget.id,
    color: w.launcherColor || w.color || accent,
    iconColor: w.launcherIconColor || "#ffffff",
    icon: ICONS[w.launcherIcon] ?? ICONS.help,
    closeIcon: ICONS.close,
    label: w.label,
    title: `${brandName} help`,
    side: w.position === "left" ? "left" : "right",
    sideOffset: w.sideOffset,
    bottomOffset: w.bottomOffset,
    iconSize: w.iconSize,
    radius: w.rounding === "custom" ? w.radius : 999,
    padding: w.padding,
    openLabel: w.text["launcher.open"] || "Open help",
  };
  const js = `(function () {
  if (window.__autodocsWidget) return;
  window.__autodocsWidget = true;
  var C = ${JSON.stringify(config)};
  var open = false;
  var size = C.iconSize + C.padding * 2;
  var svg = function (paths) {
    return '<svg width="' + C.iconSize + '" height="' + C.iconSize + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  };
  var esc = function (s) { return String(s).replace(/[<>&"]/g, ""); };

  var btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-label", C.openLabel);
  btn.style.cssText = "position:fixed;" + C.side + ":" + C.sideOffset + "px;bottom:" + C.bottomOffset + "px;height:" + size + "px;min-width:" + size + "px;" +
    "padding:0 " + (C.label ? C.padding + 4 : 0) + "px;border-radius:" + C.radius + "px;border:0;display:flex;align-items:center;justify-content:center;gap:8px;" +
    "background:" + C.color + ";color:" + C.iconColor + ";cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.2);z-index:2147483000;font:600 14px system-ui,sans-serif;" +
    "transition:transform .18s cubic-bezier(.2,.7,.2,1),box-shadow .18s;";
  function paint() {
    btn.innerHTML = svg(open ? C.closeIcon : C.icon) + (C.label && !open ? "<span>" + esc(C.label) + "</span>" : "");
    btn.style.padding = "0 " + (C.label && !open ? C.padding + 4 : 0) + "px";
  }
  btn.onmouseenter = function () { btn.style.transform = "translateY(-2px)"; };
  btn.onmouseleave = function () { btn.style.transform = ""; };

  var frame = document.createElement("iframe");
  frame.title = C.title;
  frame.src = C.origin + "/widget?id=" + C.id;
  frame.style.cssText = "position:fixed;" + C.side + ":" + C.sideOffset + "px;bottom:" + (C.bottomOffset + size + 12) + "px;width:min(400px,calc(100vw - " + (C.sideOffset * 2) + "px));" +
    "height:min(640px,calc(100vh - " + (C.bottomOffset + size + 32) + "px));border:0;border-radius:16px;" +
    "box-shadow:0 0 0 1px rgba(0,0,0,.06),0 18px 50px rgba(16,24,40,.22);background:#fff;z-index:2147483000;color-scheme:normal;" +
    "opacity:0;transform:translateY(12px) scale(.98);transform-origin:bottom " + C.side + ";pointer-events:none;visibility:hidden;" +
    "transition:opacity .22s ease-out,transform .26s cubic-bezier(.2,.7,.2,1),visibility 0s linear .26s;";

  function setOpen(next) {
    open = next;
    frame.style.opacity = open ? "1" : "0";
    frame.style.transform = open ? "none" : "translateY(12px) scale(.98)";
    frame.style.pointerEvents = open ? "auto" : "none";
    frame.style.visibility = open ? "visible" : "hidden";
    frame.style.transitionDelay = open ? "0s" : "0s,0s,.26s";
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-label", open ? "Close help" : C.openLabel);
    paint();
    emit(open ? "open" : "close");
  }

  // Events the host page can listen for: autodocs:open, autodocs:close, and the rest.
  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent("autodocs:" + name, { detail: detail }));
  }

  // "Chat" contact: hand over to the chat tool already on this page, with the customer's question.
  function openChat(summary) {
    emit("contact", { summary: summary });
    try {
      if (typeof window.Intercom === "function") { window.Intercom("showNewMessage", summary || ""); return setOpen(false); }
      if (window.$crisp && window.$crisp.push) { window.$crisp.push(["do", "chat:open"]); if (summary) window.$crisp.push(["set", "message:text", [summary]]); return setOpen(false); }
      if (window.HubSpotConversations && window.HubSpotConversations.widget) { window.HubSpotConversations.widget.open(); return setOpen(false); }
      if (typeof window.zE === "function") { window.zE("messenger", "open"); return setOpen(false); }
      if (typeof window.Beacon === "function") { window.Beacon("open"); if (summary) window.Beacon("prefill", { text: summary }); return setOpen(false); }
    } catch (e) {}
  }

  btn.addEventListener("click", function () { setOpen(!open); });
  document.addEventListener("keydown", function (e) { if (open && e.key === "Escape") { setOpen(false); btn.focus(); } });
  window.addEventListener("message", function (e) {
    if (e.origin !== C.origin || e.source !== frame.contentWindow) return;
    var d = e.data;
    if (d === "autodocs:close") { setOpen(false); btn.focus(); }
    else if (d && d.type === "autodocs:escalationRequested") emit("escalationRequested", { question: d.question, conversation: d.conversation });
    else if (d && d.type === "autodocs:contact") openChat(d.summary);
    else if (d && d.type === "autodocs:navigate" && /^https?:\\/\\//.test(d.url)) window.location.href = d.url;
  });

  function api(cmd, arg) {
    if (cmd === "open") setOpen(true);
    else if (cmd === "close") setOpen(false);
    else if (cmd === "toggle") setOpen(!open);
    else if (cmd === "ask" && arg) { setOpen(true); frame.contentWindow && frame.contentWindow.postMessage({ type: "autodocs:ask", question: String(arg).slice(0, 500) }, C.origin); }
  }
  var queued = (window.AutoDocs && window.AutoDocs.q) || [];
  window.AutoDocs = api;

  function mount() {
    paint();
    document.body.appendChild(frame);
    document.body.appendChild(btn);
    frame.addEventListener("load", function () { for (var i = 0; i < queued.length; i++) api(queued[i][0], queued[i][1]); queued = []; });
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
})();
`;
  return new Response(js, {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
