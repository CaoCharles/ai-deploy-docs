---
name: ai-deploy-chatbot
description: 建置、設定、測試或維護 ai-deploy-docs 的 Gemini AI 助理，涵蓋 MkDocs Chatbot UI、content.json、FastAPI 後端、GitHub Actions 與 Cloud Run。當使用者要求新增問答功能、調整 Prompt、更新模型、排查聊天錯誤或部署 Chatbot 時使用；未獲明確要求時不得 push、部署或修改 GitHub/GCP 正式設定。
---

# AI Deploy Chatbot 維護

維護本站的 GitHub Pages + Cloud Run + Gemini 問答架構。開始前依任務讀取 [`references/architecture.md`](references/architecture.md) 的相關段落。

## 不可破壞的邊界

- Gemini Key 只能存在 GitHub Secret 或伺服器端 Secret 管理機制，不得寫入 JavaScript、Markdown、workflow 明文、Docker Image 或測試輸出。
- Browser 只傳 `history`、`message` 與匿名 `session_id`；System Prompt 與文件內容由 Backend 控制。
- Backend 只回答本站部署筆記，清楚區分一般觀念和 `ai-asst-km` 可查證現況；不要擴張成員工 KM 助理。
- 公開回應不得暴露 Project ID、完整內部 URL、Token、Secret、帳號、Exception 或 Stack Trace。
- Chatbot 預設不保存問答紀錄。加入 Firestore、Analytics 或其他留存前，先取得使用者同意並定義告知、遮罩、存取權與刪除期限。
- 測試、本機預覽不代表已獲准 push 或部署；外部變更需要使用者明確要求。

## 修改路由

- 前端視窗、文字、可用性或連結：修改 `docs/assets/js/chatbot.js` 與 `docs/assets/css/chatbot.css`。
- 本機與 Pages API URL：修改 `docs/assets/js/chatbot-config.js` 的安全預設，正式 URL 由 `CHATBOT_API_URL` 建置環境變數注入。
- 文件索引或 runtime config：修改 `hooks/generate_content.py`。
- Prompt、模型、CORS、快取、限制或 API contract：修改 `backend/chat_server.py`，並同步 `backend/tests/`。
- Backend dependencies：修改 `backend/pyproject.toml` 後執行 `uv lock --project backend`。
- Cloud Run 部署：修改 `.github/workflows/deploy-chatbot.yml`。
- GitHub Pages 建置：修改 `.github/workflows/deploy-pages.yml`。

## 驗證順序

1. `uv sync --project backend --locked`
2. `uv run --project backend pytest -q backend/tests`
3. `uv run mkdocs build --strict`
4. 確認 `site/content.json` 與 `site/assets/js/chatbot-config.js` 已產生。
5. 需要 UI 驗證時啟動 MkDocs，檢查開啟、關閉、清除、全螢幕、深淺色與行動版。
6. 若有可用的測試 Key，只在本機環境變數中設定；不要把 Key 放進命令輸出或測試 fixture。

## GitHub 與 GCP 設定

兩個 Repository 可以使用同一組 Gemini API Key，但 GitHub Repository Secret 必須分別設定。GitHub 無法讀回另一個 Repository 的 Secret 值，不要嘗試從 workflow、Cloud Run Revision 或 log 擷取。

部署前確認新 Repository 具有：

- Variables：`GCP_PROJECT_ID`、`GCP_WIF_PROVIDER`、`GCP_DEPLOYER_SA`、`GCP_RUNTIME_SA`、`GCP_BUILD_SA`、`CHATBOT_API_URL`。
- Secret：`GEMINI_API_KEY`。
- GitHub Pages Source：GitHub Actions。
- GCP：Cloud Run、Cloud Build 與 Artifact Registry 所需 API 及最小 IAM 權限。

第一次 Backend 部署後，將輸出的 Cloud Run URL 設為 Repository Variable `CHATBOT_API_URL`，再重新執行 Pages workflow。這個 Skill 不得自行設定這些外部值，除非使用者明確要求。

## 完成條件

- Backend tests 與 MkDocs strict build 通過。
- Gemini Key 沒有出現在 tracked files 或輸出。
- `content.json` 使用本站正式 URL，Prompt 使用本站角色與範圍。
- 前端 API URL 來自 runtime config，不硬編在主要 JavaScript。
- Backend 與 Pages workflows 的 service、path、Python 和 uv 版本一致。
- 實際部署後另外驗證 Health endpoint、CORS、聊天回答與文件連結。

