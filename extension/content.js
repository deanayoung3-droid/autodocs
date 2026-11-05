// Runs on every page. It gives the side panel what's on the page, opens the !! popover in reply
// boxes (search the help center, insert a link or a short answer, or draft a reply from the
// conversation), and, on the workspace's own pages, hands a new sign-in to the extension.
(() => {
  if (window.__autodocs) return;
  window.__autodocs = true;
  const { origin, agent, version } = self.AUTODOCS;
  const api = (path, init) => chrome.runtime.sendMessage({ type: "api", path, init });

  /* Signing in: the workspace's Settings → Chrome extension page posts a token here. */
  if (location.origin === origin) {
    document.documentElement.dataset.autodocsExtension = version;
    window.addEventListener("message", async (e) => {
      if (e.source !== window || e.origin !== origin || e.data?.type !== "autodocs:extension-token") return;
      const res = await chrome.runtime.sendMessage({ type: "sign-in", token: String(e.data.token) });
      window.postMessage({ type: res?.ok ? "autodocs:extension-connected" : "autodocs:extension-failed" }, origin);
    });
  }

  /** The text around an element: walks up until there's enough to hold a conversation. */
  function textNear(el) {
    let node = el instanceof Element ? el : document.body;
    while (node && node !== document.body && (node.innerText || "").length < 1500) node = node.parentElement;
    return ((node || document.body).innerText || "").replace(/\n{3,}/g, "\n\n").slice(-12000);
  }

  function editableTarget(el) {
    if (!(el instanceof Element)) return null;
    if (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && ["text", "search"].includes(el.type))) return el;
    return el.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]');
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "page-context") {
      reply({ url: location.href, title: document.title, selection: String(getSelection() || "").slice(0, 4000), text: textNear(document.body) });
    }
    if (msg.type === "open-popover") {
      const el = editableTarget(document.activeElement);
      if (el) openPopover(el, null, msg.mode);
    }
  });

  /* The !! popover */

  let off = false;
  chrome.storage.local.get("offSites").then(({ offSites = [] }) => (off = offSites.includes(location.hostname)));
  chrome.storage.onChanged.addListener((c) => {
    if (c.offSites) off = (c.offSites.newValue || []).includes(location.hostname);
  });

  document.addEventListener(
    "input",
    (e) => {
      if (off) return;
      const el = editableTarget(e.target);
      const at = el && trigger(el);
      if (at) openPopover(el, at);
    },
    true,
  );

  /** Where "!!" was just typed, so the insert can replace it. Null if the text before the caret doesn't end with it. */
  function trigger(el) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const end = el.selectionStart;
      return end >= 2 && el.value.slice(end - 2, end) === "!!" ? { start: end - 2, end } : null;
    }
    const sel = getSelection();
    if (!sel?.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (r.endContainer.nodeType !== Node.TEXT_NODE || r.endOffset < 2) return null;
    if (r.endContainer.data.slice(r.endOffset - 2, r.endOffset) !== "!!") return null;
    const range = document.createRange();
    range.setStart(r.endContainer, r.endOffset - 2);
    range.setEnd(r.endContainer, r.endOffset);
    return { range };
  }

  /** Puts text where the !! was (or at the caret), the way typing would, so the page's editor notices. */
  function insertInto(el, at, text) {
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const start = at ? at.start : el.selectionStart;
      const end = at ? at.end : el.selectionEnd;
      el.setRangeText(text, start, end, "end");
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return;
    }
    const sel = getSelection();
    if (at?.range) {
      sel.removeAllRanges();
      sel.addRange(at.range);
    }
    // insertText keeps the editor's own undo history and works in most rich-text editors.
    if (!document.execCommand("insertText", false, text) && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      r.deleteContents();
      r.insertNode(document.createTextNode(text));
      r.collapse(false);
    }
  }

  const CSS = `
    :host { all: initial; }
    .pop { box-sizing: border-box; width: 380px; max-height: 440px; display: flex; flex-direction: column; overflow: hidden;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; color: #181d27; background: #fff;
      border-radius: 10px; box-shadow: 0 0 0 1px rgb(10 13 18 / .08), 0 24px 60px rgb(10 13 18 / .16); }
    .search-view, .draft-view { display: flex; flex-direction: column; min-height: 0; }
    .head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #e6e7ea; }
    .head svg { flex: none; color: #8d919a; }
    input { flex: 1; min-width: 0; border: 0; outline: 0; font: inherit; font-size: 14px; color: inherit; background: transparent; }
    input::placeholder { color: #a4a7ae; }
    .draft { display: flex; align-items: center; gap: 8px; width: 100%; padding: 9px 12px; border: 0; border-bottom: 1px solid #e6e7ea;
      background: #f9f9fb; font: inherit; font-weight: 600; color: var(--accent); text-align: left; cursor: pointer; }
    .draft:hover, .draft:focus-visible { background: #eff0f3; outline: 0; }
    ul { list-style: none; margin: 0; padding: 4px; overflow: auto; flex: 1; }
    li { display: flex; gap: 8px; align-items: flex-start; padding: 7px 8px; border-radius: 6px; cursor: default; }
    li[aria-selected="true"] { background: #f4f5f7; }
    .text { flex: 1; min-width: 0; }
    .title { font-weight: 600; }
    .summary { color: #646873; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .acts { display: flex; gap: 4px; flex: none; }
    button.small, .row button { font: inherit; font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 6px; cursor: pointer;
      color: #414651; background: #fff; border: 1px solid #d5d7da; }
    button.small:hover, .row button:hover { background: #f4f5f7; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .row button.primary { color: #fff; background: var(--accent); border-color: var(--accent); }
    .note { padding: 14px 12px; color: #646873; margin: 0; }
    .error { color: #b42318; }
    .compose { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; }
    textarea { box-sizing: border-box; width: 100%; min-height: 150px; resize: vertical; font: inherit; color: inherit; padding: 8px;
      border: 1px solid #d5d7da; border-radius: 6px; }
    textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
    .row { display: flex; justify-content: flex-end; gap: 6px; }
    .foot { margin: 0; padding: 6px 12px; border-top: 1px solid #e6e7ea; color: #8d919a; font-size: 11.5px; }
    [hidden] { display: none !important; }
  `;
  const SEARCH_ICON = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.6" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  let current = null;

  function closePopover() {
    current?.host.remove();
    document.removeEventListener("mousedown", onOutside, true);
    current = null;
  }
  function onOutside(e) {
    if (current && !e.composedPath().includes(current.host)) closePopover();
  }

  function openPopover(el, at, mode) {
    closePopover();
    const host = document.createElement("autodocs-popover");
    host.style.cssText = "position:fixed;z-index:2147483647;top:0;left:0;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${CSS}</style>
      <div class="pop" role="dialog" aria-label="${esc(agent)}">
        <div class="search-view">
          <div class="head">${SEARCH_ICON}<input type="search" placeholder="Search the help center" aria-label="Search the help center" /></div>
          <button class="draft" type="button">✦ Draft a reply from this conversation</button>
          <ul role="listbox" aria-label="Articles"></ul>
          <p class="foot">↑↓ to choose · Enter inserts the answer · Esc closes</p>
        </div>
        <div class="draft-view" hidden>
          <div class="compose">
            <p class="note status" role="status">Drafting a reply…</p>
            <textarea aria-label="Reply draft" hidden></textarea>
            <div class="row" hidden><button type="button" class="back">Back</button><button type="button" class="copy">Copy</button><button type="button" class="primary use">Insert reply</button></div>
          </div>
        </div>
      </div>`;
    document.documentElement.appendChild(host);
    const q = (s) => root.querySelector(s);
    const input = q("input");
    const list = q("ul");
    let results = [];
    let active = 0;
    current = { host };
    chrome.storage.local.get("accent").then(({ accent }) => host.style.setProperty("--accent", accent || "#7f56d9"));

    // Below the !! (or the box), or above it when there's no room underneath.
    const anchor = (at?.range && at.range.getBoundingClientRect().height ? at.range : el).getBoundingClientRect();
    const height = 440;
    const top = anchor.bottom + 6 + height < innerHeight ? anchor.bottom + 6 : Math.max(8, anchor.top - height - 6);
    host.style.top = `${top}px`;
    host.style.left = `${Math.min(Math.max(8, anchor.left), innerWidth - 388)}px`;

    const finish = (text) => {
      closePopover();
      insertInto(el, at, text);
    };
    const render = () => {
      list.innerHTML = results.length
        ? results
            .map(
              (r, i) => `<li role="option" id="r${i}" aria-selected="${i === active}">
                <div class="text"><div class="title">${esc(r.title)}</div><div class="summary">${esc(r.summary || r.snippet)}</div></div>
                <div class="acts"><button type="button" class="small" data-i="${i}" data-act="link">Link</button><button type="button" class="small" data-i="${i}" data-act="answer">Answer</button></div>
              </li>`,
            )
            .join("")
        : `<li class="note">${input.value.trim() ? "No articles match." : "Type to search your help center."}</li>`;
      input.setAttribute("aria-activedescendant", results.length ? `r${active}` : "");
    };
    const answerText = (r) => `${(r.summary || r.snippet || r.title).trim()}\n${r.url}`;

    let timer;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const text = input.value.trim();
        if (!text) return ((results = []), render());
        const res = await api(`/api/extension/search?q=${encodeURIComponent(text)}`);
        if (res.status === 401) return (list.innerHTML = `<li class="note error">Sign in from the ${esc(self.AUTODOCS.product)} extension first.</li>`);
        results = res.data || [];
        active = 0;
        render();
      }, 200);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (results.length) active = (active + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length;
        render();
      } else if (e.key === "Enter" && results[active]) {
        e.preventDefault();
        finish(answerText(results[active]));
      }
    });
    list.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-i]");
      if (!b) return;
      const r = results[Number(b.dataset.i)];
      finish(b.dataset.act === "link" ? r.url : answerText(r));
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closePopover();
        el.focus();
      }
    });

    const draft = async () => {
      q(".search-view").hidden = true;
      q(".draft-view").hidden = false;
      const status = q(".status");
      status.hidden = false;
      status.textContent = "Drafting a reply…";
      status.classList.remove("error");
      const { replyInstructions = "" } = await chrome.storage.local.get("replyInstructions");
      const conversation = String(getSelection() || "").trim().length > 20 ? String(getSelection()) : textNear(el);
      const res = await api("/api/extension/draft", { method: "POST", body: JSON.stringify({ conversation, instructions: replyInstructions }) });
      if (!current) return;
      if (res.status !== 200) {
        status.textContent = res.status === 401 ? `Sign in from the ${self.AUTODOCS.product} extension first.` : res.error || "Couldn't draft a reply. Try again.";
        status.classList.add("error");
        q(".row").hidden = false;
        q(".use").hidden = q(".copy").hidden = true;
        return;
      }
      status.hidden = true;
      const box = q("textarea");
      box.hidden = false;
      box.value = res.reply;
      q(".row").hidden = false;
      q(".use").hidden = q(".copy").hidden = false;
      box.focus();
    };
    q(".draft").addEventListener("click", draft);
    q(".back").addEventListener("click", () => {
      q(".draft-view").hidden = true;
      q(".search-view").hidden = false;
      input.focus();
    });
    q(".copy").addEventListener("click", async () => {
      await navigator.clipboard.writeText(q("textarea").value);
      q(".copy").textContent = "Copied";
    });
    q(".use").addEventListener("click", () => finish(q("textarea").value));

    document.addEventListener("mousedown", onOutside, true);
    render();
    if (mode === "draft") draft();
    else input.focus();
  }
})();
