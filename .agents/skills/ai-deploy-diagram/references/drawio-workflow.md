# draw.io 來源、匯出與故障排查

## 檔案責任

```text
docs/assets/diagrams/source/name.drawio  canonical editable source
docs/assets/diagrams/name.png           derived website image
```

`.drawio` 使用未壓縮 XML，方便 review 與 AI 修改。PNG 不直接修改，每次來源變更後重新匯出。

## CLI 位置

匯出腳本依序尋找：

1. PATH 中的 `drawio`。
2. `/Applications/draw.io.app/Contents/MacOS/draw.io`。

macOS 可以使用 Homebrew cask 安裝 draw.io Desktop。安裝或升級本機 App 前先取得使用者同意。

## 標準輸出

```bash
.agents/skills/ai-deploy-diagram/scripts/export_drawio.sh SOURCE.drawio OUTPUT.png
```

標準參數為 PNG、2x scale、16px border、白色畫布。自動 CLI 流程不使用 `--embed-diagram`；可編輯來源由獨立 `.drawio` 保存。若使用 GUI 匯出，可勾選 Include a copy of my diagram，但 PNG metadata 不是 canonical source。

## 驗證

- `xmllint --noout`：XML well-formed。
- `validate_diagram.py`：Element、Relationship、敏感字串、PNG 尺寸與新舊時間。
- 圖片檢視：文字裁切、線條交叉、留白與對比。
- MkDocs 頁面：縮圖、放大、手機寬度、深色與淺色模式。

## 常見問題

- CLI 啟動但未輸出：確認 App 已完整安裝，輸出目錄存在，並關閉正在編輯同一檔案的 draw.io 視窗。
- 中文變成方塊：確認 `Noto Sans TC` 可用，或將 diagram 字體改為 Arial/系統無襯線字體。
- 深色模式看不清：不要用透明背景加深色文字，改用白色 diagram background。
- PNG 模糊：使用 2x scale；不要在 XML 中把文字縮得太小。
- PNG 比來源舊：重新執行 export script，不手動調整檔案時間。
