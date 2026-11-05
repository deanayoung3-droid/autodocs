// The extension's service worker: holds the sign-in, makes every call to the workspace (content
// scripts can't, because of the page's CORS rules), and wires up the toolbar button, Alt+F, and
// the right-click menu.
importScripts("config.js");
const { origin, agent } = self.AUTODOCS;

function setUp() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "ask", title: `Ask ${agent} about “%s”`, contexts: ["selection"] });
    chrome.contextMenus.create({ id: "draft", title: `Draft a reply with ${agent}`, contexts: ["editable"] });
  });
}
chrome.runtime.onInstalled.addListener(setUp);
chrome.runtime.onStartup.addListener(setUp);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "ask") {
    // Opening the panel has to happen inside the click, before anything is awaited.
    chrome.sidePanel.open({ tabId: tab.id });
    chrome.storage.session.set({ pendingQuestion: info.selectionText || "" });
  }
  if (info.menuItemId === "draft") chrome.tabs.sendMessage(tab.id, { type: "open-popover", mode: "draft" }).catch(() => {});
});

/** A call to the workspace with this browser's sign-in. Resolves to { status, ...body }. */
async function api(path, init = {}) {
  const { token } = await chrome.storage.local.get("token");
  if (!token) return { status: 401, error: "Sign in first." };
  let res;
  try {
    res = await fetch(origin + path, {
      method: init.method || "GET",
      body: init.body,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  } catch {
    return { status: 0, error: `Couldn't reach ${origin}. Check your connection.` };
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) await chrome.storage.local.remove("token");
  return { status: res.status, ...body };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "api") {
    api(msg.path, msg.init).then(reply);
    return true;
  }
  if (msg.type === "sign-in") {
    // Only the workspace's own Chrome extension page may hand over a sign-in.
    if (!sender.url || new URL(sender.url).origin !== origin) return reply({ ok: false });
    chrome.storage.local
      .set({ token: String(msg.token) })
      .then(() => api("/api/extension/me"))
      .then((me) => reply({ ok: me.status === 200 }));
    return true;
  }
  if (msg.type === "sign-out") {
    api("/api/extension/me", { method: "DELETE" })
      .then(() => chrome.storage.local.remove("token"))
      .then(() => reply({ ok: true }));
    return true;
  }
});
