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
  └─ reads GEMINI_API_KEY from Secret Manager and calls Gemini API
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

`.github/workflows/deploy-chatbot.yml` 先測試，再交叉驗證 GCP Project、WIF 與三個 Service Account，最後透過 Workload Identity Federation 執行 `gcloud run deploy --source backend`。正式服務名稱為 `ai-deploy-docs-chatbot`，Region 為 `asia-east1`。

部署使用 `--update-secrets GEMINI_API_KEY=ai-deploy-docs-gemini-api-key:latest`，不把 Key 寫成一般環境變數。若舊服務已使用同名的一般環境變數，首次遷移必須在同一個 deploy 指令加上 `--remove-env-vars GEMINI_API_KEY`；Cloud Run 不允許直接把同名變數改成不同型別，同一次部署內先移除再掛載也可避免產生缺少 Key 的中間 revision。部署後必須確認 Secret reference、公開 invoker IAM、Health、CORS 與一次最小聊天測試；`--allow-unauthenticated` 出現在命令中不代表 IAM 一定已落地。

### Pages

`.github/workflows/deploy-pages.yml` 使用 root `uv.lock` 建置 MkDocs。Repository Variable `CHATBOT_API_URL` 會注入 hook，寫入 build artifact 的 `chatbot-config.js`。

## Secret Manager 與共用 Gemini Key

共用代表兩個服務使用同一個 API Key 值，不代表 GitHub Secret 或 Secret Manager 自動跨 Repository／Project 共用。本站正式部署使用 GCP Secret Manager；Runtime Service Account 只取得指定 Secret 的 `secretAccessor`。Deployer 可保留該 Secret 的 `viewer` 以檢查 metadata，但不需要也不得讀取 Secret value；一次性版本寫入權限應在遷移後移除。

第一次移轉可以由使用者直接將值寫入 Secret Manager，或由一次性 GitHub workflow 把 Repository Secret 經 stdin 傳給 Secret Manager。兩種方式都不得輸出值；完成移轉後，正式部署 workflow 只引用 Secret 名稱。

共用 Key 也代表共用配額與停用風險。排查 429 或用量異常時，要同時檢查 DCKA 和 ai-deploy-docs 兩個 Cloud Run Service。

## 本機開發

Backend：

```bash
uv sync --project backend --locked
read -rsp "Gemini API Key: " GEMINI_API_KEY && echo
export GEMINI_API_KEY
uv run --project backend uvicorn chat_server:app --app-dir backend --reload
unset GEMINI_API_KEY
```

Frontend：

```bash
CHATBOT_API_URL="http://127.0.0.1:8001" uv run mkdocs serve
```

建議 Backend 使用 8001、MkDocs 使用 8000，避免 Port 衝突。Key 不會進入 shell history；完成測試後要 `unset`。不要把含有 Key 的命令貼進 Issue、文章或 CI log。

## 公開 API 邊界

`CHATBOT_API_URL` 是公開 runtime config，不是 Secret。CORS 只限制瀏覽器跨來源行為，不能阻止 curl 或其他程式直接呼叫公開 API。Backend 的 per-instance rate limit、輸入長度限制、Gemini quota 與 Cloud Run max instances 共同限制影響；若流量增加，應改用跨 instance 的集中式 rate limit 或受驗證的 API gateway。
