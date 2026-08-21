---
name: ai-deploy-article
description: 撰寫或修改 ai-deploy-docs 的繁體中文 MkDocs 章節，主題涵蓋 ai-asst-km 的 Flask、Gunicorn、HTTP API、Docker、GitHub Actions、Artifact Registry、Cloud Run、Firebase Hosting、Secret Manager 與維運流程。當使用者要求新增章節、改寫文章、補部署圖或校對技術內容時使用；除非明確要求，排除 RAG、Prompt 與員工 KM 細節。
---

# AI Deploy 文章寫作

一次只完成使用者指定的一個章節。先確認真實程式碼與部署設定，再把它整理成能定位、能學習、能操作、能驗證的文章。

## 工作流程

1. 新增章節或重整文章結構時，先讀取 [`references/article-template.md`](references/article-template.md)，套用固定章節契約；主題不適用的內容可以精簡，但不要省略必備區塊。
2. 查看 `mkdocs.yml`、現有文章與樣式，維持網站一致性。
3. 若文章描述現行系統，先檢查本機 `ai-asst-km` 對應 Repository 的 Dockerfile、GitHub workflow、啟動命令與設定；不要靠印象補齊。
4. 在文章開頭標示「本章在整體架構的位置」，讓讀者先知道本章涵蓋哪個元件、流程或箭頭。
5. 區分以下內容，不要混寫：
   - Runtime：使用者送出 HTTP 請求後，系統如何處理。
   - Deployment：程式碼如何經 CI/CD 變成線上版本。
   - 現行設定：在程式碼或雲端查到的事實。
   - 基礎觀念：為協助理解而加入的一般說明。
6. 以 `!!! info "基礎觀念"` 說明通用知識，以 `!!! example "ai-asst-km 實際做法"` 呈現本系統實作。
7. 加入「實際設定查證」表格，記錄結論、查證來源與查證日期；只記錄檔案或服務種類，不公開機密值。
8. 為每個 Lab 標示安全等級：`本機實作`、`雲端唯讀` 或 `雲端寫入`。雲端寫入必須說明影響與復原方式，而且不代表已獲准操作正式環境。
9. 撰寫繁體中文文章。首次出現術語時保留英文，例如「修訂版本（Revision）」。
10. 對本次新增或修改的章節執行 `uv run python .agents/skills/ai-deploy-article/scripts/validate_article.py <article.md>`，再執行 `uv run mkdocs build --strict`；涉及圖表或版面時，再用瀏覽器檢查桌面與行動版、深色與淺色模式。

## 內容原則

- 以 `ai-asst-km` 的真實架構為主案例，不把它寫成抽象雲端教科書。
- Flask + Gunicorn 是現行 API 技術；不要誤寫成 FastAPI。
- API 與部署文章應解釋「為什麼」，並提供安全、可重現的唯讀或本機練習。
- 不揭露 Project ID、完整 Service URL、Secret 值、Token、帳號或內部資料。
- 無法由程式碼或唯讀查詢確認的內容，明確標成推測、待確認或一般示例。
- 不一次建立大量空白章節；首頁只列已完成內容與短期規劃。
- 不為了符合模板重複同一段內容；架構總覽章可以用一張全貌圖完成章節定位，專題章則只標示相關局部。

## Markdown 與圖表規則

- Mermaid 中文節點使用引號，例如 `A["GitHub Actions"]`。
- `subgraph` 使用 ID 與顯示名稱，例如 `subgraph deploy["部署流程"]`。
- Mermaid 節點不要使用 HTML `<br>`。
- 程式碼區塊標示語言；需要時加入 `title`。
- Admonition 只用於提醒、風險、補充或成功條件，不要讓每個段落都變成提示框。
- 表格用於精確對照；流程或多個元件關係優先使用 Mermaid。

## 完成條件

- 文章包含架構位置、基礎觀念、實際做法與查證來源。
- 章節目標、內容、練習、驗證與小結互相對應。
- 技術敘述與實際 Repository 或官方文件一致。
- Lab 已標示安全等級；若為雲端寫入，也已說明影響與復原方式。
- 導覽與內部連結有效。
- `validate_article.py` 通過。
- `uv run mkdocs build --strict` 通過。
