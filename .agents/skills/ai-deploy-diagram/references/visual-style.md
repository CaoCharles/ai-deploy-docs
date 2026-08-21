# AI Deploy 圖表視覺規範

## 畫布

- 白色背景，避免透明 PNG 在 MkDocs 深色模式出現低對比文字。
- 16px 以上外邊界；PNG 以 2x scale 匯出。
- 預設由左至右閱讀，時間順序圖由上至下。
- 標題放在畫布左上，legend 放在不干擾主流程的角落。

## 顏色

| 類型 | Fill | Stroke | 用途 |
|---|---|---|---|
| Person | `#F3F0F8` | `#5E35B1` | 使用者或角色 |
| Internal System/Container | `#EDE7F6` | `#673AB7` | ai-asst-km 負責的元件 |
| Focus Container | `#D1C4E9` | `#512DA8` | 本章主要元件 |
| External System | `#F5F5F5` | `#616161` | 外部供應商與資料系統 |
| Deployment Node | `#F7F4FB` | `#7E57C2` | GCP、Cloud Run、Firebase 等節點 |

不要只用顏色表達含義；Element label 與 legend 仍要寫出類型。

## 文字

- 字體：`Noto Sans TC`，找不到時退回 `Arial`。
- 標題 24–28px；Element 名稱 16–18px；描述與技術 12–14px；Relationship 12–13px。
- Element label 順序：`[Type]`、名稱、`[Technology]`、責任說明。
- 避免全大寫與難懂縮寫；必要縮寫在 legend 解釋。

## Connector

- 主流程使用實線單向箭頭，次要或非同步關係才使用虛線。
- 線寬 1.5–2px，直角 Connector 優先。
- Relationship label 靠近線段但不要壓住 Element。
- 避免線條交叉；無法避免時重新排列 Element，不靠大量跳線修補。

## 圖示

- C4 Element 以方塊、文字和邊界為主。
- GCP/Azure 圖示只能輔助辨識，不能取代 Element type、名稱與責任。
- 使用圖示時在 legend 說明，並保持同一套官方 icon style。
