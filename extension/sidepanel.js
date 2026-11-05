// The side panel: chat with Docs Agent about the docs (with the current page as context),
// search articles, follow the docs tasks you started, and settings. Calls go through the
// service worker, which holds the sign-in.
const { origin, agent, product } = self.AUTODOCS;
const $ = (s) => document.querySelector(s);
const api = (path, init) => chrome.runtime.sendMessage({ type: "api", path, init });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const views = ["#loading", "#signed-out", "#app", "#settings"];
const show = (id) => views.forEach((v) => ($(v).hidden = v !== id));

document.querySelectorAll(".agent-name").forEach((el) => (el.textContent = agent));
document.querySelectorAll(".product").forEach((el) => (el.textContent = product));
document.querySelectorAll(".origin").forEach((el) => (el.textContent = origin.replace(/^https?:\/\//, "")));
$("#question").placeholder = `Ask ${agent} about your product, or describe a docs change…`;

let me = null;

async function start() {
  const res = await api("/api/extension/me");
  if (res.status !== 200) {
    show("#signed-out");
    if (res.status !== 401) {
      $("#waiting").hidden = false;
      $("#waiting").textContent = res.error || `Couldn't reach ${origin}.`;
    }
    return;
  }
  me = res;
  $(".workspace").textContent = `${res.workspace.name} · ${res.user.name}`;
  $("#account").textContent = res.user.name;
  document.documentElement.style.setProperty("--accent", res.workspace.accent);
  chrome.storage.local.set({ accent: res.workspace.accent });
  show("#app");
  renderChat();
  const { pendingQuestion } = await chrome.storage.session.get("pendingQuestion");
  if (pendingQuestion) askAbout(pendingQuestion);
}

/* Signing in: the workspace's Chrome extension page hands the token over, then storage changes. */
$("#sign-in").addEventListener("click", () => {
  chrome.tabs.create({ url: `${origin}/admin/settings/extension?connect=1` });
  $("#waiting").hidden = false;
  $("#waiting").textContent = "Finish signing in on the tab that opened. This panel updates by itself.";
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.token?.newValue) start();
  if (area === "session" && changes.pendingQuestion?.newValue && me) askAbout(changes.pendingQuestion.newValue);
});

/* Tabs */
const tabs = ["chat", "search", "tasks"];
function selectTab(name) {
  for (const t of tabs) {
    const on = t === name;
    $(`#tab-${t}`).setAttribute("aria-selected", String(on));
    $(`#tab-${t}`).tabIndex = on ? 0 : -1;
    $(`#panel-${t}`).hidden = !on;
  }
  if (name === "tasks") loadTasks();
  if (name === "search") $("#search").focus();
}
for (const t of tabs) $(`#tab-${t}`).addEventListener("click", () => selectTab(t));
$(".tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const i = tabs.findIndex((t) => $(`#tab-${t}`).getAttribute("aria-selected") === "true");
  const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
  selectTab(next);
  $(`#tab-${next}`).focus();
});

/* Chat */

/** What's on the current tab, if the page allows the extension to read it. */
async function pageContext() {
  if (!$("#use-page").checked) return undefined;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return undefined;
  return chrome.tabs.sendMessage(tab.id, { type: "page-context" }).catch(() => undefined);
}

async function loadChat() {
  return (await chrome.storage.local.get("chat")).chat || [];
}

async function renderChat() {
  const chat = await loadChat();
  const list = $("#messages");
  if (!chat.length) {
    list.innerHTML = `<li class="empty">Ask how something works and ${esc(agent)} answers from your help center, using the page you're on. Or describe a docs change and make it a task.</li>`;
    return;
  }
  list.innerHTML = chat
    .map((m) => {
      if (m.role === "you") return `<li class="msg you">${esc(m.text)}</li>`;
      const sources = (m.sources || []).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.title)}</a>`).join("");
      return `<li class="msg bot"><div class="body">${m.html || `<p class="${m.error ? "error" : ""}">${esc(m.text)}</p>`}</div>${sources ? `<div class="sources">${sources}</div>` : ""}</li>`;
    })
    .join("");
  list.scrollTop = list.scrollHeight;
}

async function append(entry) {
  const chat = await loadChat();
  chat.push(entry);
  await chrome.storage.local.set({ chat: chat.slice(-40) });
  await renderChat();
}

let busy = false;
function setBusy(on) {
  busy = on;
  for (const b of document.querySelectorAll("#ask-form button")) b.disabled = on;
}

async function ask(question) {
  if (busy) return;
  setBusy(true);
  await append({ role: "you", text: question });
  $("#messages").insertAdjacentHTML("beforeend", `<li class="msg bot thinking">Looking through your docs…</li>`);
  const res = await api("/api/extension/ask", { method: "POST", body: JSON.stringify({ question, page: await pageContext() }) });
  if (res.status === 401) return signedOut();
  if (res.status !== 200) await append({ role: "bot", text: res.error || "Something went wrong. Try again.", error: true });
  else if (!res.answered) await append({ role: "bot", text: `Your help center doesn't cover this yet. Make it a docs task and ${agent} will draft the article.` });
  else await append({ role: "bot", html: res.html, sources: res.sources });
  setBusy(false);
}

async function makeTask(prompt) {
  if (busy) return;
  setBusy(true);
  await append({ role: "you", text: prompt });
  const res = await api("/api/extension/tasks", { method: "POST", body: JSON.stringify({ prompt, page: await pageContext() }) });
  if (res.status === 401) return signedOut();
  if (res.status !== 201) await append({ role: "bot", text: res.error || "Couldn't start the task. Try again.", error: true });
  else
    await append({
      role: "bot",
      html: `<p>${esc(agent)} is on it. The drafts wait for review in ${esc(product)}; nothing is published on its own. <a href="${esc(res.url)}" target="_blank" rel="noreferrer">Follow the task</a></p>`,
    });
  setBusy(false);
}

function askAbout(text) {
  chrome.storage.session.remove("pendingQuestion");
  selectTab("chat");
  ask(`What do our docs say about this? “${text.slice(0, 1500)}”`);
}

$("#ask-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#question").value.trim();
  if (q.length < 3) return;
  $("#question").value = "";
  ask(q);
});
$("#question").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#ask-form").requestSubmit();
  }
});
$("#make-task").addEventListener("click", () => {
  const q = $("#question").value.trim();
  if (q.length < 5) {
    $("#question").focus();
    $("#question").placeholder = "Describe the docs change first, like “Document the new bulk export”.";
    return;
  }
  $("#question").value = "";
  makeTask(q);
});

/* Search */
let searchTimer;
$("#search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = $("#search").value.trim();
    const list = $("#results");
    if (!q) return (list.innerHTML = "");
    const res = await api(`/api/extension/search?q=${encodeURIComponent(q)}`);
    if (res.status === 401) return signedOut();
    const hits = res.data || [];
    list.innerHTML = hits.length
      ? hits
          .map(
            (h, i) => `<li><div class="title">${esc(h.title)}</div><div class="meta">${esc(h.summary || h.snippet)}</div>
              <div class="acts"><button type="button" class="link" data-copy="${i}">Copy link</button><a href="${esc(h.url)}" target="_blank" rel="noreferrer">Open</a></div></li>`,
          )
          .join("")
      : `<li class="note">No articles match “${esc(q)}”.</li>`;
    list.onclick = async (e) => {
      const b = e.target.closest("[data-copy]");
      if (!b) return;
      await navigator.clipboard.writeText(hits[Number(b.dataset.copy)].url);
      b.textContent = "Copied";
      setTimeout(() => (b.textContent = "Copy link"), 1500);
    };
  }, 200);
});

/* Tasks */
const ago = (s) => {
  const mins = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};
function statusChip(t) {
  if (t.status === "running") return `<span class="status-chip">Working…</span>`;
  if (t.status === "failed") return `<span class="status-chip failed">Couldn't finish</span>`;
  if (t.pending) return `<span class="status-chip review">${t.pending} to review</span>`;
  return `<span class="status-chip">Done</span>`;
}
async function loadTasks() {
  const list = $("#tasks");
  list.innerHTML = `<li class="note">Loading…</li>`;
  const res = await api("/api/extension/tasks");
  if (res.status === 401) return signedOut();
  const tasks = res.data || [];
  list.innerHTML = tasks.length
    ? tasks
        .map((t) => `<li><a class="title" href="${esc(t.url)}" target="_blank" rel="noreferrer">${esc(t.title)}</a><div class="meta">${statusChip(t)} · ${ago(t.created_at)}</div></li>`)
        .join("")
    : `<li class="note">Docs tasks you start from here or in ${esc(product)} show up here.</li>`;
}

/* Settings */
async function openSettings() {
  const { replyInstructions = "", offSites = [] } = await chrome.storage.local.get(["replyInstructions", "offSites"]);
  $("#reply-instructions").value = replyInstructions;
  $("#saved-note").textContent = "";
  $("#clear-chat").textContent = "Clear chat";
  renderOffSites(offSites);
  show("#settings");
}
function renderOffSites(sites) {
  $("#off-sites").innerHTML = sites.length
    ? sites.map((s) => `<li>${esc(s)}<button type="button" aria-label="Turn !! back on for ${esc(s)}" data-site="${esc(s)}">×</button></li>`).join("")
    : `<li class="none">Nowhere yet.</li>`;
}
$("#open-settings").addEventListener("click", () => ($("#settings").hidden ? openSettings() : show(me ? "#app" : "#signed-out")));
$("#close-settings").addEventListener("click", () => show(me ? "#app" : "#signed-out"));
let saveTimer;
$("#reply-instructions").addEventListener("input", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ replyInstructions: $("#reply-instructions").value.slice(0, 2000) });
    $("#saved-note").textContent = "Saved.";
  }, 400);
});
$("#off-sites").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-site]");
  if (!b) return;
  const { offSites = [] } = await chrome.storage.local.get("offSites");
  const next = offSites.filter((s) => s !== b.dataset.site);
  await chrome.storage.local.set({ offSites: next });
  renderOffSites(next);
});
$("#turn-off-here").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ctx = tab?.id ? await chrome.tabs.sendMessage(tab.id, { type: "page-context" }).catch(() => undefined) : undefined;
  if (!ctx?.url) return;
  const host = new URL(ctx.url).hostname;
  const { offSites = [] } = await chrome.storage.local.get("offSites");
  const next = offSites.includes(host) ? offSites : [...offSites, host];
  await chrome.storage.local.set({ offSites: next });
  renderOffSites(next);
});
$("#clear-chat").addEventListener("click", async () => {
  await chrome.storage.local.remove("chat");
  await renderChat();
  $("#clear-chat").textContent = "Cleared";
});
$("#sign-out").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "sign-out" });
  signedOut();
});

function signedOut() {
  me = null;
  $(".workspace").textContent = "";
  setBusy(false);
  $("#waiting").hidden = true;
  show("#signed-out");
}

start();
