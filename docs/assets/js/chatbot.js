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

  function injectWidget() {
    if (document.getElementById("ai-deploy-chatbot")) return;
    document.body.insertAdjacentHTML(
      "beforeend",
      `<button id="ai-chat-open" aria-label="開啟 AI 助理">AI</button>
      <section id="ai-deploy-chatbot" aria-label="AI 助理聊天視窗">
        <header class="ai-chat-header">
          <div class="ai-chat-header-avatar" aria-hidden="true">AI</div>
          <span><strong>${chatbotName}</strong><small>根據本站系統筆記回答</small></span>
          <div>
            <button id="ai-chat-clear" title="清除對話" aria-label="清除對話">↻</button>
            <button id="ai-chat-expand" title="切換全螢幕" aria-label="切換全螢幕">⛶</button>
            <button id="ai-chat-close" title="關閉" aria-label="關閉">×</button>
          </div>
        </header>
        <div id="ai-chat-messages" aria-live="polite"></div>
        <div id="ai-chat-actionbar"></div>
        <form id="ai-chat-form">
          <input id="ai-chat-input" maxlength="${maxMessageChars}" autocomplete="off" placeholder="輸入系統問題…" aria-label="輸入問題">
          <button id="ai-chat-send" type="submit" aria-label="送出問題">➤</button>
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
      button.innerHTML = '<span aria-hidden="true">↻</span> 重新生成';
      button.addEventListener("click", regenerate);
      actionbar.replaceChildren(button);
    }

    function copyMessageText(item, button) {
      navigator.clipboard
        ?.writeText(item.innerText)
        .then(() => {
          button.classList.add("is-copied");
          button.innerHTML = "✓";
          window.setTimeout(() => {
            button.classList.remove("is-copied");
            button.innerHTML = "⧉";
          }, 1200);
        })
        .catch(() => {});
    }

    function appendMessage(role, text, persist = true) {
      const row = document.createElement("div");
      row.className = role === "user" ? "ai-chat-row ai-chat-row--user" : "ai-chat-row ai-chat-row--bot";

      const avatar = document.createElement("div");
      avatar.className = "ai-chat-avatar";
      avatar.textContent = role === "user" ? "你" : "AI";
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
        col.className = "ai-chat-col";

        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "ai-chat-copy";
        copyButton.innerHTML = "⧉";
        copyButton.setAttribute("aria-label", "複製這則回覆");
        copyButton.addEventListener("click", () => copyMessageText(item, copyButton));

        const actions = document.createElement("div");
        actions.className = "ai-chat-msg-actions";
        actions.appendChild(copyButton);

        col.append(item, actions);
        row.append(avatar, col);
      }

      messages.appendChild(row);
      messages.scrollTop = messages.scrollHeight;
      if (persist) {
        history.push({ role: role === "user" ? "user" : "model", parts: [{ text }] });
        history = history.slice(-maxHistoryMessages);
        saveHistory(history);
      }
      return item;
    }

    function replaceLastBotMessage(text) {
      const rows = messages.querySelectorAll(".ai-chat-row--bot");
      const lastRow = rows[rows.length - 1];
      const bubble = lastRow?.querySelector(".ai-chat-bot");
      if (bubble) bubble.innerHTML = renderMarkdown(text);
      if (history.length && history[history.length - 1].role === "model") {
        history[history.length - 1] = { role: "model", parts: [{ text }] };
        saveHistory(history);
      }
    }

    function renderSuggestions(questions) {
      const wrap = document.createElement("div");
      wrap.className = "ai-chat-suggestions";
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
        appendMessage("bot", "嗨！我是 AI KM 筆記助理，根據本站系統筆記回答問題。點下面的建議問題快速開始，或直接輸入你的問題：", false);
        renderSuggestions([
          "HTTP GET 和 POST 有什麼差別？",
          "Flask 為什麼搭配 Gunicorn？",
          "Cloud Run Service、Revision 和 Instance 有什麼差別？",
        ]);
        return;
      }
      history.forEach((message) => {
        appendMessage(message.role === "user" ? "user" : "bot", message.parts[0].text, false);
      });
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
        '<div class="ai-chat-avatar" aria-hidden="true">AI</div>' +
        '<div class="ai-chat-typing" role="status" aria-label="正在整理文件內容"><span></span><span></span><span></span></div>';
      messages.appendChild(typing);
      messages.scrollTop = messages.scrollHeight;

      const controller = new AbortController();
      activeController = controller;
      const timeout = window.setTimeout(() => controller.abort(), 60_000);

      let resultText = null;
      let errorText = null;
      try {
        const response = await fetch(`${apiUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            history: priorHistory,
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
      if (replaceLastBot) replaceLastBotMessage(finalText);
      else appendMessage("bot", finalText);
      showRegenerateButton();
      input.focus();
    }

    async function sendMessage(event) {
      event.preventDefault();
      const message = input.value.trim();
      if (!message || waiting) return;

      document.querySelector(".ai-chat-suggestions")?.remove();
      const priorHistory = history.slice(-maxHistoryMessages);
      appendMessage("user", message);
      input.value = "";

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
      openButton.hidden = false;
    });
    document.getElementById("ai-chat-expand").addEventListener("click", () => {
      panel.classList.toggle("is-fullscreen");
    });
    document.getElementById("ai-chat-clear").addEventListener("click", () => {
      history = [];
      sessionStorage.removeItem(historyKey);
      sessionStorage.removeItem(sessionKey);
      drawHistory();
    });
    form.addEventListener("submit", sendMessage);
  }

  if (window.document$) {
    window.document$.subscribe(injectWidget);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectWidget);
  } else {
    injectWidget();
  }
})();
