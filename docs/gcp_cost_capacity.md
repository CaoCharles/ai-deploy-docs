---
authors:
  - name: Charles Cao
tags:
  - GCP
  - Cost
  - Capacity
---

# GCP 成本與整體容量

Cloud Run CPU 小，不代表整套 KM 便宜；concurrency 高，也不代表每秒能完成同樣多次問答。成本取決於資源使用時間、儲存與外部呼叫，容量則取決於整條請求鏈中先飽和的環節。

## 學習目標

- [ ] 將 KM 成本分到運算、儲存、網路、維運與模型供應商。
- [ ] 分辨並行請求數、完成速率、登入人數與可承諾容量。
- [ ] 用有單位的假設估算成本，並指出仍缺少的實測資料。

## 這篇筆記涵蓋的範圍

整合 Model、Data、Monitor、Eval、Hosting、Scheduler、Storage、Logging，以及外部 MongoDB／Azure 成本。本文不是實際帳單，也不宣告正式 SLA；TPM／RPM 的細節見 [Azure 配額](azure_openai_quota.md)。

## 前置知識

先讀 [Cloud Run 擴縮](cloud_run_core_concepts.md)、[JMeter 與持久化多輪測試](jmeter_load_testing.md)。

## 基礎觀念：成本與容量要分開計算

Cloud Run 有 request-based 與 instance-based billing，計費生命週期不同；同時還要考慮資源規格、地區、minimum instances、啟動與網路流量。不能把單次 elapsed 直接乘請求數當作精確 CPU 計費秒數，因為多個請求可能共用同一段 Instance 活躍時間。[Cloud Run pricing](https://cloud.google.com/run/pricing)

| 成本層 | KM 中的消耗來源 | 主要用量單位與設定影響 |
|---|---|---|
| Cloud Run | Model、Data、Monitor、Eval、實驗 Service | vCPU-second、GiB-second、request；規格、活躍時間、billing mode 與 min/max 改變費用 |
| Hosting／網路 | 靜態 JS、Monitor 報表、API 回應及跨雲流量 | 儲存量與傳輸 GB；快取、檔案大小、Region 與目的地影響使用量 |
| Artifact Registry／建置 | 正式、實驗 Image 與多版 layers；Actions 或個別 Cloud Build 路徑 | 儲存與建置時間；保留數量及重建頻率影響成本 |
| Cloud Storage | 文件、catalog、trace、保留的物件版本 | GB-month、讀寫／列舉操作與傳輸；lifecycle、cache hit rate 與重算頻率相關 |
| Secret／Scheduler | Secret 版本與存取、排程 Job | Secret Manager 與 Scheduler 各有計價；Job 引發的 API／DB 工作另計 |
| Logging／Monitoring | 詳細日誌、留存、付費指標或其他觀測功能 | 依產品計價項目，不能把所有 built-in metrics 當成付費；詳細度、保留與 cardinality 影響用量 |
| 外部服務 | Azure 模型、MongoDB 方案／備份／傳輸 | 不包含在單一 GCP Cloud Run 費用裡；需各自帳單與配額 |

Storage 與 Observability 價格包含多種用量維度，本文採公式與假設，不寫死跨地區或方案的單價。[Storage pricing](https://cloud.google.com/storage/pricing)、[Observability pricing](https://cloud.google.com/products/observability/pricing)

## 本專案採用方式：目前資源基線

以下每格是**單一 Instance** 的資源；數值來自 2026-09-07 唯讀 Service 設定，版本記錄見 [GCP 資源地圖](gcp_resource_map.md)。

| 元件 | CPU／Memory | Concurrency／Run timeout | Revision max | 容量解讀 |
|---|---|---|---:|---|
| 主 Model API | 1／2 GiB | 100／300 秒 | 2 | `4×25` gthread 是程式工作槽的名目配置，不是 100 TPS |
| Data API | 1／512 MiB | 80／60 秒 | 3 | Dockerfile 是單 sync worker，平台接收上限不是實際同時執行量 |
| Monitor API | 1／1 GiB | 80／900 秒 | 3 | 單 sync worker／120 秒；聚合與 refresh 也會佔住處理器工作槽 |
| Eval API | 1／512 MiB | 80／60 秒 | 3 | 管理／評測用途需與主要問答流量分開 |

Model、Data、Monitor 的 Service 層 max 另為 20，與表中的 Revision max 作用範圍不同。目前各自 100% 流量集中在一個 Revision，不能將 Service max 20 當成當前 20 個相同 Revision Instance。官方也說明擴縮上限存在短暫超出等情況，不能作為精確帳單封頂。[Cloud Run maximum instances](https://docs.cloud.google.com/run/docs/configuring/max-instances)

額外 experiment／ablation Service、定時暖機、管理者瀏覽與壓測也可能消耗費用。同一 Project 不等於只存在正式問答成本；目前實例上限更不是所有服務的已用實例數。

## 容量模型：先定義一輪成功是什麼

若成功交易定義為「Model final 成功且 Data append 成功」，一輪就包含不只一個 HTTP Request。SSE token event 也不是一筆獨立業務交易；報 TPS 前需固定分子與觀測秒數。

```text title="穩態估算；不是 KM 實測容量"
L ≈ λ × W
L：平均進行中的交易數 [筆]
λ：平均完成速率 [筆/秒]
W：平均交易耗時 [秒]

封閉迴圈 users N ≈ λ × (回應時間 R + 使用者停頓 Z)
```

假設 100 位活躍使用者，每輪 final 加 append 平均 20 秒，閱讀停頓 5 秒，則 offered rate 約為 `100 ÷ 25 = 4 輪/秒`。這是穩態負載估算，需滿足系統穩定、窗口足夠長等前提；不是 100 users 一定可承受的證明，也不能拿來解釋尚未收斂的一次 burst。

在已知資源限制下，可先寫出上界的候選集合，再用實測找瓶頸：

```text
整體完成速率 ≤ min(
  API 實測服務能力,
  Data API／MongoDB 可持續讀寫能力,
  LLM 每分鐘請求額度 ÷ 每輪模型呼叫數 ÷ 60,
  LLM 每分鐘 token 額度 ÷ 每輪配額估算 token ÷ 60
)
```

多個模型 deployment 要各自檢查；每輪可能呼叫模型多次，token 配額估算也不等於最後帳單 tokens。Cloud Run concurrency 只是其中一個入口限制，額外 threads 不會創造新的 Azure 配額或 MongoDB 連線能力。

## 成本估算案例：寫清楚單位與缺口

假設每月 20 個工作天、每天 1,000 輪成功交易，共 20,000 輪。假設每輪合計輸入 20,000 tokens、輸出 800 tokens，則分別為 4 億與 1,600 萬 tokens。若模型輸入／輸出每百萬 tokens 單價為 `P_in`、`P_out`，模型費估算為：

```text
模型費 ≈ 400 × P_in + 16 × P_out
Cloud Run 費 ≈ Σ(各資源適用的 billable vCPU-seconds × CPU 單價
                  + billable GiB-seconds × Memory 單價)
              + 適用的 request／network 費用
總費 ≈ 模型 + Cloud Run + DB + Storage + Hosting + 交付 + 維運
```

所有數字都是教學假設；錯誤請求、重試、warm-up、history 準備、trace 重算與管理流量可能仍花錢，必須加回用量。免費額度、折扣、快取 token 計價及稅費另行對照實際 SKU，不能直接用上述總 tokens 當帳單。

| 仍缺的量測 | 為什麼影響估算 |
|---|---|
| 各服務 billing mode、billable time 與帳單 SKU | 決定 CPU／Memory 秒數怎麼計價 |
| 實際模型呼叫數、deployment 價格與配額 | 影響每輪成本及最高吞吐量 |
| MongoDB 方案、連線／查詢峰值、備份 | Data append 與 Monitor 全量查詢會共用資料層 |
| Storage 用量、操作與 cache hit rate | 影響儲存、下載與排程重算成本 |
| 持久化多輪穩態與尾端延遲 | 短 burst 結果不足以支撐長期容量承諾 |

本輪沒有讀帳單、正式 Azure quota 或 DB 容量，故沒有「每月實際花多少」或「可承諾幾人」的結論。

## 設定改變會有什麼影響？

提高 min instances 可以減少部分冷啟動，增加閒置成本；提高 max instances 可增加總並行工作，也提高下游模型與 DB 壓力。增加 Memory 能容納更多程序／下載快取，但不保證提高單輪速度。降低 Monitor 快取 TTL、增加 Scheduler 頻率或打開詳細日誌，則可能增加沒有員工提問時的背景成本。

預算告警（alerts-only budget）用於通知成本趨勢，不自動停止費用；官方另有具條件限制的 spend cap 功能，不能假定本專案已啟用。預算、配額、Instance 上限與測試停止條件是不同機制。[Cloud Billing budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets)

??? question "2026-08-28 的 FastAPI 2.627 TPS 可以直接當正式容量嗎？"
    不行。那是單次 100-user runtime burst，沒有逐輪 Data append，也不是 180 秒穩態。它支持當時特定配置下的效能差異，正式多輪容量仍須另量測。

## 小結

容量由整條服務鏈限制，成本由所有資源與外部供應商共同形成。先固定成功交易、負載型態與版本，再以用量單位估算，才能知道改某個設定究竟改善了什麼、增加了什麼。

## 延伸閱讀

- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Cloud Storage pricing](https://cloud.google.com/storage/pricing)
- [Google Cloud Observability pricing](https://cloud.google.com/products/observability/pricing)
- [Cloud Billing budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets)
- [效能測試與容量學習路徑](performance_overview.md)
