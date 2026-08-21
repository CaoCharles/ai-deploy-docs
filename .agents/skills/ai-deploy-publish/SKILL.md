---
name: ai-deploy-publish
description: 驗證、預覽或發布 ai-deploy-docs 的 MkDocs Material 網站。當使用者要求同步 uv 環境、啟動本機網站、執行 strict build、檢查頁面，或設定與執行 GitHub Pages 部署時使用；未獲明確要求時不得 push 或發布正式網站。
---

# AI Deploy 網站預覽與發布

使用 uv 管理環境，先驗證，再預覽或發布。

## 本機驗證

1. 確認位於含有 `pyproject.toml`、`uv.lock` 與 `mkdocs.yml` 的專案根目錄。
2. 執行 `uv sync --locked`。
3. 執行 `uv run mkdocs build --strict`。
4. 需要本機預覽時執行 `uv run mkdocs serve`。
5. 開啟 `http://127.0.0.1:8000/ai-deploy-docs/`，檢查：
   - 導覽與內部連結。
   - Mermaid 圖表。
   - 程式碼區塊與表格。
   - 桌面與行動版。
   - 深色與淺色模式。

不要提交 `.venv/`、`site/`、Token、Secret 或本機測試產物。

## GitHub Pages 發布

- 以 GitHub Actions 建置並發布 Pages artifact；不要把本機 `site/` 提交進 Repository。
- workflow 應從鎖定的 uv 環境執行 `uv run mkdocs build --strict`。
- 發布前確認 `site_url`、Repository 名稱、Pages source 與 workflow 權限一致。
- 只有使用者明確要求發布時，才能 commit、push、手動觸發 workflow 或修改 GitHub Pages 設定。
- 發布後檢查 workflow 結果與正式網址，不以 workflow 綠燈取代實際頁面驗證。

## 故障排查

1. 先保留第一個明確錯誤，不被後續連鎖訊息干擾。
2. 本機成功、CI 失敗時，比較 Python、uv lock、工作目錄、權限與 Pages 設定。
3. CI 成功、頁面異常時，檢查 `site_url`、資源路徑、導覽連結與瀏覽器 Console。
4. 不用跳過 strict build、放寬權限或移除鎖檔掩蓋問題。

