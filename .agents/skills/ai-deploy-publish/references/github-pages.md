# GitHub Pages 初始化、部署與驗證

只有在第一次發布、Repository 初始化、CI/CD 排錯或正式站驗證時讀取本參考。GitHub Actions 的版本會變動；修改 workflow 前，以各 Action 的官方最新 release 與遷移說明為準。

## 發布前盤點

1. 執行 `git status --short`，辨識使用者既有的 staged、unstaged 與 untracked 檔案。
2. 執行 `git branch --show-current` 與 `git remote -v`，確認目前分支及實際 owner/repository。
3. 執行 `gh auth status`，確認 GitHub CLI 身分有效。
4. 只 stage 本次確認過的檔案；不要使用 `git add .`、`git add -A` 或其他會混入既有變更的指令。

## 判斷 Repository 狀態

- 本機不是 Git Repository、遠端也完全為空時，才初始化 `main`、加入精確檔案並建立初始提交。
- 遠端已存在預設分支時，先同步並保留既有歷史；不要重新初始化或覆寫遠端。
- 初始提交完成後，後續修改若位於預設分支，使用功能分支與 Pull Request，除非使用者明確指定其他流程。
- push、建立或合併 Pull Request、重跑 workflow、啟用 Pages 都是外部變更，必須在使用者已明確要求發布的範圍內執行。

## Workflow 必要條件

Pages workflow 應具備：

- `contents: read`、`pages: write` 與 `id-token: write` 權限。
- build job 產生 `site/` artifact；deploy job 使用 `github-pages` environment 發布該 artifact。
- `actions/checkout` 使用 `fetch-depth: 0`，讓建立／更新日期外掛取得完整 Git history。
- 從 `.python-version` 安裝完整直譯器版本：

  ```bash
  uv python install "$(cat .python-version)"
  uv sync --locked
  uv run mkdocs build --strict
  ```

- uv 必須能取得 `.python-version` 指定的平台與 patch 版本。若 CI 顯示找不到直譯器或沒有可用下載，先更新 CI 的 uv 版本並核對 Python 發行版本，不要移除 lockfile 或略過 strict build。
- 採用官方仍支援的 GitHub Pages Actions major，並留意 Node.js runtime 淘汰警告。

本專案在 2026-08-21 核對的 Pages Actions 為：

- `actions/configure-pages@v6`
- `actions/upload-pages-artifact@v5`
- `actions/deploy-pages@v5`

這是目前 Repository 的實作基準，不是永久版本；日後修改 workflow 時重新查看官方 release。

## 啟用 GitHub Pages

workflow 存在不代表 Pages 已啟用。先查詢：

```bash
gh api repos/OWNER/REPOSITORY/pages
```

若回傳尚未建立，且使用者已授權正式發布，再設定 GitHub Actions 為 Pages source：

```bash
gh api --method POST repos/OWNER/REPOSITORY/pages -f build_type=workflow
```

不要在尚未解析出精確 owner/repository 時直接執行，也不要重複建立已存在的 Pages 設定。

## 發布後驗證

依序確認：

1. workflow run 與所有 jobs 成功，並檢查 warnings/annotations。
2. Pages API 的 `build_type` 是 `workflow`，正式網址符合 `mkdocs.yml` 的 `site_url`。
3. 正式首頁可取得且標題正確。
4. CSS、JavaScript、圖片等靜態資源不是 404。
5. `content.json` 可取得、頁數合理，文件 URL 指向正式站。
6. 任一文章頁的建立日期與更新日期可見，首頁不必顯示。
7. 若有 Chatbot，只驗證 Pages 產出的 runtime config；後端、Gemini、WIF 與 Cloud Run 交給 `$ai-deploy-chatbot`。

CI 成功但正式站異常時，優先比較 artifact 與正式 URL 的 base path、`site_url`、資源路徑和瀏覽器 Console。不要只靠 workflow 綠燈判定發布完成。
