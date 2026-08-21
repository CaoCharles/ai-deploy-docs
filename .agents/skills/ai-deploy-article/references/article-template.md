# AI Deploy 章節格式契約

新增或重整章節時使用這份契約。必備區塊維持一致，區塊內的深度依主題調整；不要為了湊篇幅加入無關內容。

## 固定骨架

```markdown
---
authors:
  - name: Charles Cao
tags:
  - Topic
---

# 第 N 章：章節名稱

## 學習目標

- [ ] 可觀察、可驗證的學習成果

## 本章在整體架構的位置

使用一段精確文字或一張適合的圖標示本章涵蓋的元件與上下游。正式 C4／Deployment 架構使用 draw.io PNG 並提供 source；小型流程才使用 Mermaid。

## 前置知識

## N.1 核心問題或情境

## N.2 基礎觀念

!!! info "基礎觀念"
    說明適用於一般系統的技術概念。

## N.3 ai-asst-km 實際做法

!!! example "ai-asst-km 實際做法"
    說明目前程式碼或雲端設定採取的方式。

## 實際設定查證

| 查證項目 | 現行結論 | 來源 | 查證日期 |
|---|---|---|---|
| 啟動方式 | Flask + Gunicorn | Dockerfile／啟動命令 | YYYY-MM-DD |

不要貼 Secret 值、完整 Service URL、Token、Project ID 或內部帳號。若尚未確認，將現行結論標示為「待確認」，不要猜測。

## Lab 實作練習

**安全等級**：本機實作

### 目標

### 環境需求

### 步驟

### 驗證結果

若安全等級是「雲端寫入」，必須再加入：

### 影響

### 復原方式

## 常見問題

## 小結

## 延伸閱讀
```

`date` 與 `updated` 不寫入 frontmatter。網站使用 Git history 自動產生建立日期與更新日期，避免文章內容與日期出現兩套來源；GitHub Pages checkout 必須保留完整歷史。

## 章節選擇原則

- 架構總覽：先分 Runtime 與 Deployment，再介紹元件責任與資料流；全貌圖本身可以同時作為章節定位。
- HTTP/API：從 Request、Response、Method、Path、JSON、Status Code 開始，再對照 Flask route。
- Gunicorn：先說明 Flask 開發伺服器的限制，再解釋 WSGI、worker、timeout 與 Cloud Run 的關係。
- Docker：從 Dockerfile 每一層與 Image/Container 差異切入，再連到 Artifact Registry。
- GitHub Actions：拆解 trigger、job、step、WIF、build、push、deploy，不直接貼整份 workflow 取代說明。
- Cloud Run：說明 Service、Revision、Instance、traffic、scale to zero、cold start、環境變數與 Secret。
- 維運：涵蓋 logs、health check、rollback、權限與設定漂移，但任何變更正式環境的步驟都要標出風險。

## 練習安全分級

- `本機實作`：可在專案或本機測試環境完成，清楚說明如何啟動、驗證與停止。
- `雲端唯讀`：使用 `list`、`describe`、`logs read` 等不改變服務狀態的指令。
- `雲端寫入`：可能產生 Revision、改變流量、設定或成本；文章必須說明影響與復原方式，實際執行仍需使用者明確授權。

## 風格界線

- 以短段落、精確表格和必要圖表為主，不把每段文字都包成 Admonition。
- 「基礎觀念」只說通用原理；「ai-asst-km 實際做法」只說可查證現況。
- 查證來源優先寫 Repository 內的相對位置或服務種類，不把本機絕對路徑寫進公開文章。
- 延伸閱讀優先連結官方文件；第三方文章只在能補足實務觀點時加入。
- draw.io 圖後必須說明圖表類型、閱讀順序與邊界；不要只放一張沒有解說的圖片。
