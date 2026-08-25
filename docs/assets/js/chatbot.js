(() => {
  "use strict";

  const config = window.AI_DEPLOY_CHATBOT_CONFIG || {};
  const apiUrl = String(config.apiUrl || "").replace(/\/$/, "");
  const siteUrl = String(config.siteUrl || "https://caocharles.github.io/ai-deploy-docs").replace(/\/$/, "");
  const chatbotName = String(config.name || "AI KM 筆記助理");
  const historyKey = "aiDeployDocsChatHistory";
  const sessionKey = "aiDeployDocsChatSession";
  const maxMessageChars = 4000;
  const maxHistoryMessages = 20;
  const logoMark = '<svg class="ai-chat-orb-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2Z"></path><circle cx="19" cy="5" r="1"></circle><circle cx="5" cy="18.5" r="0.8"></circle></svg>';
  let waiting = false;

  function sessionId() {
    let value = sessionStorage.getItem(sessionKey);
    if (!value) {
      value = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sessionStorage.setItem(sessionKey, value);
    }
    return value;
  }

  function loadHistory() {
    try {
      const value = JSON.parse(sessionStorage.getItem(historyKey) || "[]");
      return Array.isArray(value) ? value.slice(-maxHistoryMessages) : [];
    } catch {
      return [];
    }
  }

  function saveHistory(history) {
    sessionStorage.setItem(historyKey, JSON.stringify(history.slice(-maxHistoryMessages)));
  }

  function fixDocumentationLinks(markdown) {
    return markdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, href) => {
      if (/^https?:\/\//i.test(href) || href.startsWith("#")) return match;
      const path = href.startsWith("/") ? href : `/${href}`;
      const normalized = path.startsWith("/ai-deploy-docs/")
        ? path.slice("/ai-deploy-docs".length)
        : path;
      return `[${label}](${siteUrl}${normalized})`;
    });
  }

  function renderMarkdown(markdown) {
    const fixed = fixDocumentationLinks(markdown);
    const rendered = window.marked ? window.marked.parse(fixed) : fixed;
    return window.DOMPurify ? window.DOMPurify.sanitize(rendered) : rendered;
  }

  function normalizeSources(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value
      .map((source) => {
        if (!source || typeof source.title !== "string" || typeof source.url !== "string") return null;
        try {
          const url = new URL(source.url);
          if (url.href !== siteUrl && !url.href.startsWith(`${siteUrl}/`)) return null;
          const title = source.title.trim().slice(0, 160);
          if (!title || seen.has(url.href)) return null;
          seen.add(url.href);
          return { title, url: url.href };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(0, 3);
  }

  function normalizeSuggestions(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value
      .map((question) => (typeof question === "string" ? question.trim().slice(0, 120) : ""))
      .filter((question) => {
        if (!question || seen.has(question)) return false;
        seen.add(question);
        return true;
      })
      .slice(0, 3);
  }

  function injectWidget() {
    if (document.getElementById("ai-deploy-chatbot")) return;
    document.body.insertAdjacentHTML(
      "beforeend",
      `<button id="ai-chat-open" aria-label="開啟 AI 助理">
        <span class="ai-chat-open-orb" aria-hidden="true">${logoMark}</span>
        <span class="ai-chat-open-label">AI 助理</span>
      </button>
      <section id="ai-deploy-chatbot" aria-label="AI 助理聊天視窗">
        <header class="ai-chat-header">
          <div class="ai-chat-brand">
            <div class="ai-chat-header-avatar" aria-hidden="true">${logoMark}</div>
            <span><strong>${chatbotName}</strong><small><i></i> 已連線 · 根據本站筆記回答</small></span>
          </div>
          <div class="ai-chat-header-actions">
            <button id="ai-chat-clear" title="開始新對話" aria-label="開始新對話"><svg class="ai-chat-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h7"></path><path d="M17 3v6"></path><path d="M14 6h6"></path></svg></button>
            <button id="ai-chat-expand" title="放大聊天視窗" aria-label="放大聊天視窗"><svg class="ai-chat-icon ai-chat-icon--expand" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg><svg class="ai-chat-icon ai-chat-icon--collapse" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3"></path><path d="M16 3v3a2 2 0 0 0 2 2h3"></path><path d="M8 21v-3a2 2 0 0 0-2-2H3"></path><path d="M16 21v-3a2 2 0 0 1 2-2h3"></path></svg></button>
            <button id="ai-chat-close" title="關閉" aria-label="關閉"><svg class="ai-chat-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button>
          </div>
        </header>
        <div class="ai-chat-context">
          <span>知識庫</span>
          <strong>雲端部署筆記</strong>
        </div>
        <div id="ai-chat-messages" aria-live="polite"></div>
        <div id="ai-chat-actionbar"></div>
        <form id="ai-chat-form">
          <div class="ai-chat-composer">
            <textarea id="ai-chat-input" rows="1" maxlength="${maxMessageChars}" autocomplete="off" placeholder="輸入你的部署問題，Shift + Enter 換行" aria-label="輸入問題"></textarea>
            <button id="ai-chat-send" type="submit" aria-label="送出問題">↑</button>
          </div>
          <div class="ai-chat-form-meta">
            <span>◇ AI 回答僅供參考，請以本站文件與正式設定為準</span>
            <span id="ai-chat-counter">0/${maxMessageChars}</span>
          </div>
        </form>
      </section>`,
    );

    const panel = document.getElementById("ai-deploy-chatbot");
    const openButton = document.getElementById("ai-chat-open");
    const messages = document.getElementById("ai-chat-messages");
    const actionbar = document.getElementById("ai-chat-actionbar");
    const input = document.getElementById("ai-chat-input");
    const sendButton = document.getElementById("ai-chat-send");
    const form = document.getElementById("ai-chat-form");
    const counter = document.getElementById("ai-chat-counter");
    const expandButton = document.getElementById("ai-chat-expand");
    let history = loadHistory();
    let activeController = null;
    let abortedByUser = false;

    function clearActionbar() {
      actionbar.replaceChildren();
    }

    function showStopButton() {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ai-chat-pill";
      button.innerHTML = '<span aria-hidden="true">■</span> 停止生成';
      button.addEventListener("click", () => {
        abortedByUser = true;
        activeController?.abort();
      });
      actionbar.replaceChildren(button);
    }

    function showRegenerateButton() {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ai-chat-pill";
      button.innerHTML = '<svg class="ai-chat-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path></svg><span>重新生成</span>';
      button.addEventListener("click", regenerate);
      actionbar.replaceChildren(button);
    }

    function copyMessageText(item, button) {
      navigator.clipboard
        ?.writeText(item.innerText)
        .then(() => {
          button.classList.add("is-copied");
          button.querySelector(".ai-chat-action-label").textContent = "已複製";
          window.setTimeout(() => {
            button.classList.remove("is-copied");
            button.querySelector(".ai-chat-action-label").textContent = "複製回答";
          }, 1200);
        })
        .catch(() => {});
    }

    function createSourceSection(sources) {
      const normalized = normalizeSources(sources);
      if (!normalized.length) return null;

      const section = document.createElement("section");
      section.className = "ai-chat-sources";

      const heading = document.createElement("div");
      heading.className = "ai-chat-sources-heading";
      heading.innerHTML = '<svg class="ai-chat-source-heading-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg><span>參考文件</span>';
      section.appendChild(heading);

      normalized.forEach((source) => {
        const link = document.createElement("a");
        link.className = "ai-chat-source-link";
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";

        const label = document.createElement("span");
        label.textContent = source.title;
        link.appendChild(label);
        link.insertAdjacentHTML("beforeend", '<svg class="ai-chat-source-link-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7"></path><path d="M7 7h10v10"></path></svg>');
        section.appendChild(link);
      });

      return section;
    }

    function createRecommendationSection(suggestions) {
      const normalized = normalizeSuggestions(suggestions);
      if (!normalized.length) return null;

      const section = document.createElement("section");
      section.className = "ai-chat-recommendations";
      section.setAttribute("aria-label", "推薦問題");

      const heading = document.createElement("div");
      heading.className = "ai-chat-recommendations-heading";
      heading.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3Z"></path><path d="m18.5 14 .8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8.8-2.7Z"></path><path d="m5 3 .6 2L8 5.7l-2.4.7L5 8.5l-.6-2.1L2 5.7 4.4 5 5 3Z"></path></svg><span>推薦問題</span>';
      section.appendChild(heading);

      const list = document.createElement("div");
      list.className = "ai-chat-recommendation-list";
      normalized.forEach((question) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ai-chat-recommendation";
        button.textContent = question;
        button.addEventListener("click", () => {
          if (waiting) return;
          input.value = question;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          form.requestSubmit();
        });
        list.appendChild(button);
      });
      section.appendChild(list);

      return section;
    }

    function appendMessage(role, text, persist = true, sources = [], suggestions = []) {
      const normalizedSources = role === "user" ? [] : normalizeSources(sources);
      const normalizedSuggestions = role === "user" ? [] : normalizeSuggestions(suggestions);
      const row = document.createElement("div");
      row.className = role === "user" ? "ai-chat-row ai-chat-row--user" : "ai-chat-row ai-chat-row--bot";

      const avatar = document.createElement("div");
      avatar.className = "ai-chat-avatar";
      if (role === "user") avatar.textContent = "你";
      else avatar.innerHTML = logoMark;
      avatar.setAttribute("aria-hidden", "true");

      const item = document.createElement("article");
      item.className = role === "user" ? "ai-chat-user" : "ai-chat-bot";
      if (role === "user") {
        item.textContent = text;
      } else {
        item.innerHTML = renderMarkdown(text);
      }

      if (role === "user") {
        row.append(item, avatar);
      } else {
        const col = document.createElement("div");
        col.className = "ai-chat-col ai-chat-answer";

        const meta = document.createElement("div");
        meta.className = "ai-chat-answer-meta";
        meta.innerHTML = '<strong>AI 筆記助理</strong><span>本站文件</span>';

        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "ai-chat-message-action ai-chat-copy";
        copyButton.innerHTML = '<svg class="ai-chat-action-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span class="ai-chat-action-label">複製回答</span>';
        copyButton.setAttribute("aria-label", "複製這則回覆");
        copyButton.addEventListener("click", () => copyMessageText(item, copyButton));

        const actions = document.createElement("div");
        actions.className = "ai-chat-msg-actions";
        actions.appendChild(copyButton);

        col.append(meta, item);
        const sourceSection = createSourceSection(normalizedSources);
        if (sourceSection) col.appendChild(sourceSection);
        const recommendationSection = createRecommendationSection(normalizedSuggestions);
        if (recommendationSection) col.appendChild(recommendationSection);
        col.appendChild(actions);
        row.append(avatar, col);
      }

      messages.appendChild(row);
      messages.scrollTop = messages.scrollHeight;
      if (persist) {
        const entry = { role: role === "user" ? "user" : "model", parts: [{ text }] };
        if (normalizedSources.length) entry.sources = normalizedSources;
        if (normalizedSuggestions.length) entry.suggestions = normalizedSuggestions;
        history.push(entry);
        history = history.slice(-maxHistoryMessages);
        saveHistory(history);
      }
      return item;
    }

    function replaceLastBotMessage(text, sources = [], suggestions = []) {
      const normalizedSources = normalizeSources(sources);
      const normalizedSuggestions = normalizeSuggestions(suggestions);
      const rows = messages.querySelectorAll(".ai-chat-row--bot");
      const lastRow = rows[rows.length - 1];
      const bubble = lastRow?.querySelector(".ai-chat-bot");
      if (bubble) bubble.innerHTML = renderMarkdown(text);
      const col = lastRow?.querySelector(".ai-chat-answer");
      col?.querySelector(".ai-chat-sources")?.remove();
      col?.querySelector(".ai-chat-recommendations")?.remove();
      const actions = col?.querySelector(".ai-chat-msg-actions");
      const sourceSection = createSourceSection(normalizedSources);
      if (col && actions && sourceSection) col.insertBefore(sourceSection, actions);
      const recommendationSection = createRecommendationSection(normalizedSuggestions);
      if (col && actions && recommendationSection) col.insertBefore(recommendationSection, actions);
      if (history.length && history[history.length - 1].role === "model") {
        history[history.length - 1] = { role: "model", parts: [{ text }] };
        if (normalizedSources.length) history[history.length - 1].sources = normalizedSources;
        if (normalizedSuggestions.length) history[history.length - 1].suggestions = normalizedSuggestions;
        saveHistory(history);
      }
    }

    function renderSuggestions(questions) {
      const wrap = document.createElement("div");
      wrap.className = "ai-chat-suggestions";
      const title = document.createElement("div");
      title.className = "ai-chat-suggestions-title";
      title.innerHTML = '<span aria-hidden="true">✦</span> 可以從這些問題開始';
      wrap.appendChild(title);
      questions.forEach((question) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ai-chat-suggestion";
        button.textContent = question;
        button.addEventListener("click", () => {
          input.value = question;
          form.requestSubmit();
        });
        wrap.appendChild(button);
      });
      messages.appendChild(wrap);
      messages.scrollTop = messages.scrollHeight;
    }

    function drawHistory() {
      messages.replaceChildren();
      clearActionbar();
      if (history.length === 0) {
        const welcome = document.createElement("section");
        welcome.className = "ai-chat-welcome";
        welcome.innerHTML =
          `<div class="ai-chat-welcome-orb" aria-hidden="true">${logoMark}</div>` +
          '<h2>今天想了解什麼？</h2>' +
          '<p>我是你的雲端架構筆記助理。描述遇到的情境，我會從本站文件整理觀念、設定與下一步。</p>';
        messages.appendChild(welcome);
        renderSuggestions([
          "HTTP GET 和 POST 有什麼差別？",
          "Flask 為什麼搭配 Gunicorn？",
          "Cloud Run Service、Revision 和 Instance 有什麼差別？",
        ]);
        return;
      }
      history.forEach((message, index) => {
        const suggestions = index === history.length - 1 ? message.suggestions : [];
        appendMessage(
          message.role === "user" ? "user" : "bot",
          message.parts[0].text,
          false,
          message.sources,
          suggestions,
        );
      });
      if (history[history.length - 1]?.role === "model") showRegenerateButton();
    }

    function setWaiting(value) {
      waiting = value;
      input.disabled = value;
      sendButton.disabled = value;
      panel.classList.toggle("is-waiting", value);
    }

    async function requestReply(message, priorHistory, replaceLastBot = false) {
      clearActionbar();
      abortedByUser = false;
      setWaiting(true);
      showStopButton();

      const typing = document.createElement("div");
      typing.className = "ai-chat-row ai-chat-row--bot";
      typing.innerHTML =
        `<div class="ai-chat-avatar" aria-hidden="true">${logoMark}</div>` +
        '<div class="ai-chat-typing" role="status" aria-label="正在整理文件內容"><span></span><span></span><span></span></div>';
      messages.appendChild(typing);
      messages.scrollTop = messages.scrollHeight;

      const controller = new AbortController();
      activeController = controller;
      const timeout = window.setTimeout(() => controller.abort(), 60_000);

      let resultText = null;
      let errorText = null;
      let resultSources = [];
      let resultSuggestions = [];
      try {
        const response = await fetch(`${apiUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            history: priorHistory.map(({ role, parts }) => ({ role, parts })),
            message,
            session_id: sessionId(),
          }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
        if (typeof payload.text !== "string" || !payload.text.trim()) {
          throw new Error("後端沒有回傳文字內容");
        }
        resultText = payload.text;
        resultSources = normalizeSources(payload.sources);
        resultSuggestions = normalizeSuggestions(payload.suggestions);
      } catch (error) {
        errorText =
          error.name === "AbortError"
            ? abortedByUser
              ? "已停止生成。"
              : "請求逾時，請稍後再試。"
            : error.message;
      } finally {
        window.clearTimeout(timeout);
        typing.remove();
        activeController = null;
        setWaiting(false);
        clearActionbar();
      }

      const finalText = resultText ?? `抱歉，AI 助理目前無法回答：${errorText}`;
      const finalSources = resultText ? resultSources : [];
      const finalSuggestions = resultText ? resultSuggestions : [];
      if (replaceLastBot) replaceLastBotMessage(finalText, finalSources, finalSuggestions);
      else appendMessage("bot", finalText, true, finalSources, finalSuggestions);
      showRegenerateButton();
      input.focus();
    }

    async function sendMessage(event) {
      event.preventDefault();
      const message = input.value.trim();
      if (!message || waiting) return;

      document.querySelector(".ai-chat-suggestions")?.remove();
      document.querySelectorAll(".ai-chat-recommendations").forEach((section) => section.remove());
      const priorHistory = history.slice(-maxHistoryMessages);
      appendMessage("user", message);
      input.value = "";
      input.style.height = "auto";
      counter.textContent = `0/${maxMessageChars}`;

      if (!apiUrl) {
        appendMessage(
          "bot",
          "後端尚未設定。請在建置網站時提供 `CHATBOT_API_URL`，再重新發布 GitHub Pages。",
        );
        return;
      }

      await requestReply(message, priorHistory, false);
    }

    async function regenerate() {
      if (waiting) return;
      const lastUserEntry = [...history].reverse().find((entry) => entry.role === "user");
      if (!lastUserEntry) return;
      const idx = history.lastIndexOf(lastUserEntry);
      const priorHistory = history.slice(0, idx);
      await requestReply(lastUserEntry.parts[0].text, priorHistory, true);
    }

    openButton.addEventListener("click", () => {
      panel.classList.add("is-open");
      openButton.hidden = true;
      drawHistory();
      input.focus();
    });
    document.getElementById("ai-chat-close").addEventListener("click", () => {
      panel.classList.remove("is-open");
      panel.classList.remove("is-fullscreen");
      expandButton.title = "放大聊天視窗";
      expandButton.setAttribute("aria-label", "放大聊天視窗");
      openButton.hidden = false;
    });
    expandButton.addEventListener("click", () => {
      const isFullscreen = panel.classList.toggle("is-fullscreen");
      const label = isFullscreen ? "還原聊天視窗" : "放大聊天視窗";
      expandButton.title = label;
      expandButton.setAttribute("aria-label", label);
    });
    document.getElementById("ai-chat-clear").addEventListener("click", () => {
      history = [];
      sessionStorage.removeItem(historyKey);
      sessionStorage.removeItem(sessionKey);
      drawHistory();
    });
    form.addEventListener("submit", sendMessage);
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
      counter.textContent = `${input.value.length}/${maxMessageChars}`;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
  }

  if (window.document$) {
    window.document$.subscribe(injectWidget);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectWidget);
  } else {
    injectWidget();
  }
})();
