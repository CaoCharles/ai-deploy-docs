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
          <span><strong>${chatbotName}</strong><small>根據本站系統筆記回答</small></span>
          <div>
            <button id="ai-chat-clear" title="清除對話" aria-label="清除對話">↻</button>
            <button id="ai-chat-expand" title="切換全螢幕" aria-label="切換全螢幕">⛶</button>
            <button id="ai-chat-close" title="關閉" aria-label="關閉">×</button>
          </div>
        </header>
        <div id="ai-chat-messages" aria-live="polite"></div>
        <form id="ai-chat-form">
          <input id="ai-chat-input" maxlength="${maxMessageChars}" autocomplete="off" placeholder="輸入系統問題…" aria-label="輸入問題">
          <button id="ai-chat-send" type="submit" aria-label="送出問題">➤</button>
        </form>
      </section>`,
    );

    const panel = document.getElementById("ai-deploy-chatbot");
    const openButton = document.getElementById("ai-chat-open");
    const messages = document.getElementById("ai-chat-messages");
    const input = document.getElementById("ai-chat-input");
    const sendButton = document.getElementById("ai-chat-send");
    const form = document.getElementById("ai-chat-form");
    let history = loadHistory();

    function appendMessage(role, text, persist = true) {
      const item = document.createElement("article");
      item.className = role === "user" ? "ai-chat-user" : "ai-chat-bot";
      if (role === "user") {
        item.textContent = text;
      } else {
        item.innerHTML = renderMarkdown(text);
      }
      messages.appendChild(item);
      messages.scrollTop = messages.scrollHeight;
      if (persist) {
        history.push({ role: role === "user" ? "user" : "model", parts: [{ text }] });
        history = history.slice(-maxHistoryMessages);
        saveHistory(history);
      }
    }

    function drawHistory() {
      messages.replaceChildren();
      if (history.length === 0) {
        appendMessage(
          "bot",
          "嗨！我是 AI KM 筆記助理。你可以問我：\n\n- HTTP GET 和 POST 有什麼差別？\n- Flask 為什麼搭配 Gunicorn？\n- Cloud Run Service、Revision 和 Instance 有什麼差別？",
          false,
        );
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

    async function sendMessage(event) {
      event.preventDefault();
      const message = input.value.trim();
      if (!message || waiting) return;

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

      setWaiting(true);
      const typing = document.createElement("div");
      typing.className = "ai-chat-typing";
      typing.textContent = "正在整理文件內容…";
      messages.appendChild(typing);

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 60_000);
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
        appendMessage("bot", payload.text);
      } catch (error) {
        const messageText = error.name === "AbortError" ? "請求逾時，請稍後再試。" : error.message;
        appendMessage("bot", `抱歉，AI 助理目前無法回答：${messageText}`);
      } finally {
        window.clearTimeout(timeout);
        typing.remove();
        setWaiting(false);
        input.focus();
      }
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
