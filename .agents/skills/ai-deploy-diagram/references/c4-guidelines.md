# C4 圖表選擇與檢查

## System Context

- Scope：一個軟體系統。
- Audience：技術與非技術讀者。
- Elements：Person、目標 Software System、直接互動的外部 Software System。
- 不放：Framework、Container、資料表、Cloud Run Revision 等實作細節。

## Container

- Scope：一個軟體系統內部。
- Audience：開發、維運與架構人員。
- Elements：SPA、Web/API Application、Background Worker、Database、File Store 等可獨立執行或儲存資料的單位。
- 每個 Container 都標示主要技術與責任。
- 外部 Person/System 可以出現，但要放在 system boundary 外。
- 不把 Docker Container 或 Cloud Run Instance 誤當成 C4 Container；C4 Container 是應用程式或資料儲存的邏輯單位。

## Deployment

- Scope：單一環境，例如 Production。
- Elements：Deployment Node、Infrastructure Node、Container Instance。
- Node 可以巢狀表示 GCP、Region、Cloud Run Service、Firebase Hosting 等執行環境。
- Image repository、load balancer、DNS 等只有在能幫助理解部署時才加入。

## Dynamic／Sequence

- Scope：一個 use case、請求或部署情境。
- 只顯示該情境需要的元素。
- Interaction 依時間順序編號或由上到下排列。
- 複雜互動從 `assets/templates/dynamic.drawio` 開始；若必須使用 lifeline，仍維持相同顏色、標籤與編號規則。
- 用於真正需要順序才能理解的互動；小型線性流程繼續使用 Mermaid。

## 通用 Review Checklist

- 圖名包含 diagram type 和 scope。
- 有 legend，且顏色、邊框、線型在所有圖一致。
- Element 明確標示 Person、Software System、Container 或 Deployment Node。
- Element 有短描述；Container 有 technology。
- Relationship 為單向、有動詞標籤，方向與文字一致。
- 跨 Container 關係標示 protocol/technology。
- 沒有無法由來源證明的服務或箭頭。
- 一張圖只講一個故事；讀者不需要把畫布放大數次才能找到入口。
