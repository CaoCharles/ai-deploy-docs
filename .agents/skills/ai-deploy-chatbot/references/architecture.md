# AI Deploy Chatbot 架構與維運參考

## 元件與資料流

```text
MkDocs build
  └─ hooks/generate_content.py
       ├─ site/content.json
       └─ site/assets/js/chatbot-config.js

Browser on GitHub Pages
  └─ chatbot.js → POST /api/chat
                       ↓
Cloud Run: ai-deploy-docs-chatbot
  ├─ FastAPI validates request
  ├─ fetches and caches content.json
  ├─ builds server-owned System Prompt
  └─ calls Gemini API with GEMINI_API_KEY
```

Gemini Key 不會傳給 Browser。`content.json` 是公開網站內容的索引，不包含 Secret。

## API contract

### Health check

```http
GET /
```

### Chat

```http
POST /api/chat
Content-Type: application/json
```

```json
{
  "history": [
    {"role": "user", "parts": [{"text": "Cloud Run 是什麼？"}]}
  ],
  "message": "Revision 又是什麼？",
  "session_id": "browser-generated-id"
}
```

成功回應：

```json
{"text": "..."}
```

Browser 不得傳 `system_instruction`；Pydantic 會拒絕未知欄位。

## GitHub Actions

### Backend

`.github/workflows/deploy-chatbot.yml` 先測試，再透過 Workload Identity Federation 執行 `gcloud run deploy --source backend`。正式服務名稱為 `ai-deploy-docs-chatbot`，Region 為 `asia-east1`。

### Pages

`.github/workflows/deploy-pages.yml` 使用 root `uv.lock` 建置 MkDocs。Repository Variable `CHATBOT_API_URL` 會注入 hook，寫入 build artifact 的 `chatbot-config.js`。

## 共用 Gemini Key

共用代表兩個服務使用同一個 API Key 值，不代表 GitHub Secret 自動跨 Repository 共用。新 Repository 仍需建立 `GEMINI_API_KEY` Secret；後續若要集中管理，應另行規劃 GCP Secret Manager 與 Runtime Service Account 的 `secretAccessor` 權限。

共用 Key 也代表共用配額與停用風險。排查 429 或用量異常時，要同時檢查 DCKA 和 ai-deploy-docs 兩個 Cloud Run Service。

## 本機開發

Backend：

```bash
uv sync --project backend --locked
GEMINI_API_KEY="..." uv run --project backend uvicorn chat_server:app --app-dir backend --reload
```

Frontend：

```bash
CHATBOT_API_URL="http://127.0.0.1:8001" uv run mkdocs serve
```

建議 Backend 使用 8001、MkDocs 使用 8000，避免 Port 衝突。不要把含有 Key 的命令貼進 Issue、文章或 CI log。

