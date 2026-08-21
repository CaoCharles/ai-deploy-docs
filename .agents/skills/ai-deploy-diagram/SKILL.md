---
name: ai-deploy-diagram
description: 設計、建立、修改、匯出或校對 ai-deploy-docs 的 draw.io 軟體架構圖，包含 C4 System Context、Container、Deployment 與 Dynamic/Sequence 圖。當文章需要正式架構圖、系統邊界、雲端部署節點或可編輯 PNG 來源時使用；簡單的小型流程仍可留在 Mermaid。
---

# AI Deploy 架構圖

將可查證的系統結構轉成可編輯 `.drawio` 原始檔與供 MkDocs 顯示的 PNG。圖的目標是解釋架構，不是堆疊雲端圖示。

## 選擇圖表

先讀 [`references/c4-guidelines.md`](references/c4-guidelines.md) 判斷抽象層級：

- System Context：使用者、目標系統與外部系統。
- Container：目標系統內的應用程式、API 與資料儲存。
- Deployment：Container instance 如何部署到 Firebase、Cloud Run、Artifact Registry 等節點。
- Dynamic／Sequence：一次複雜請求或交付情境的時間順序；簡單 3～5 步驟流程優先保留 Mermaid。

不要在同一張圖混用不同抽象層級。若一篇文章同時需要 Runtime 與 Deployment，使用兩張各自聚焦的圖，或讓較簡單的一條流程保留 Mermaid。

## 建立流程

1. 查證實際 Repository、workflow、Cloud Run 唯讀設定或既有文章；列出 scope、audience、elements、relationships 和 evidence。
2. 新圖或大幅改圖時讀 [`references/visual-style.md`](references/visual-style.md)，從 `assets/templates/` 中最接近的樣板開始，不從空白 XML 猜測版面。
   - System Context：`assets/templates/c4-context.drawio`
   - Container：`assets/templates/c4-container.drawio`
   - Deployment：`assets/templates/deployment.drawio`
   - Dynamic／複雜時序：`assets/templates/dynamic.drawio`
3. 將可編輯來源放在 `docs/assets/diagrams/source/<name>.drawio`，將 PNG 放在 `docs/assets/diagrams/<name>.png`。
4. 使用未壓縮 draw.io XML；一個檔案只表達一個主要故事，使用穩定、具語意的 cell ID。
5. 每個 Element 都標示類型、名稱與一句責任；Container/Component 另標示技術。
6. 每條 Relationship 都使用單向箭頭並標示動作；跨程序呼叫加上 HTTPS/JSON、MongoDB/TLS 等協定。
7. 不放 Project ID、Secret、Token、內部帳號或完整正式 Service URL。
8. 依 [`references/drawio-workflow.md`](references/drawio-workflow.md) 匯出與驗證。

## 驗證

```bash
.agents/skills/ai-deploy-diagram/scripts/export_drawio.sh \
  docs/assets/diagrams/source/example.drawio \
  docs/assets/diagrams/example.png

uv run python .agents/skills/ai-deploy-diagram/scripts/validate_diagram.py \
  docs/assets/diagrams/source/example.drawio \
  --png docs/assets/diagrams/example.png
```

再以圖片檢視器檢查：標籤沒有裁切、箭頭不穿過方塊、文字在文章寬度下可讀、白色畫布在深淺色網站都清楚。最後執行 `uv run mkdocs build --strict` 並檢查實際文章。

## 文章嵌入

使用有意義的替代文字、圖說與原始檔連結：

```markdown
<figure markdown="span">
  ![圖表類型與內容說明](assets/diagrams/example.png)
  <figcaption>這張圖要幫讀者看懂的重點</figcaption>
</figure>

[下載 draw.io 可編輯原始檔](assets/diagrams/source/example.drawio)
```

圖後必須解釋閱讀順序與關鍵邊界，不讓 PNG 取代文字說明。

## 完成條件

- 圖表類型、scope 與 audience 明確。
- 元件與箭頭均能追溯到程式碼、設定或文章查證來源。
- `.drawio` 是 canonical source，PNG 只是衍生產物。
- `validate_diagram.py`、MkDocs strict build 與視覺檢查通過。
- 文章可下載原始檔，圖片具替代文字與圖說。
