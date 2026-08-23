---
authors:
  - name: Charles Cao
tags:
  - Flask
  - WSGI
  - Gunicorn
  - Uvicorn
  - FastAPI
---

# Flask、FastAPI、Gunicorn 與 Uvicorn

理解 HTTP Method 與 Route 後，下一個問題是：HTTP Request 是誰先接住的？`workers`、`threads` 又是在控制什麼？

這篇會沿著 Cloud Run Instance 內部往下看，先拆解 `ai-asst-km` 現行的 Flask + Gunicorn，再比較 FastAPI + Uvicorn。這兩組名稱分屬不同層次，不能直接把四個工具放在同一列比較。

## 學習目標

- [ ] 分辨 Web Framework、Application Interface 與 Application Server。
- [ ] 說明 WSGI 在 Gunicorn 與 Flask 之間扮演的角色。
- [ ] 看懂 Gunicorn 的 master、worker process、worker class 與 thread。
- [ ] 逐段解讀兩支 API 的正式啟動命令。
- [ ] 說明 Cloud Run concurrency 與 Gunicorn 容量為什麼必須一起調整。
- [ ] 正確比較 Flask／FastAPI，以及 Gunicorn／Uvicorn。

## 這篇筆記涵蓋的範圍

<figure markdown="span">
  ![ai-asst-km 正式環境中 Cloud Run、Gunicorn worker 與 Flask WSGI application 的 Deployment Diagram](assets/diagrams/04_cloud_run_gunicorn_flask_runtime.png)
  <figcaption>兩支 API 都是 Flask + Gunicorn，但 Model API 與 Data API 的 worker 拓撲不同</figcaption>
</figure>

[下載 draw.io 可編輯原始檔](assets/diagrams/source/04_cloud_run_gunicorn_flask_runtime.drawio)

這是一張 **Deployment Diagram**，範圍是正式環境中兩支 API 的單一 Cloud Run Instance。閱讀順序由左至右：Cloud Run Ingress 收到 Request，交給 Instance 內的 Gunicorn master；master 管理 worker process，worker 再透過 WSGI 呼叫 Flask Application。

圖中只畫「服務如何啟動與接住 Request」，不重複完整系統邊界，也沒有畫 Flask 函式後面的 Azure OpenAI 或 MongoDB 呼叫。

## 前置知識

- 先閱讀[HTTP Request、GET、POST 與 REST API](http_get_post_rest_api.md)，能辨認 Request、Method、Path 與 Flask route。
- 若對 Cloud Run 的 Instance 還不熟，可以先快速閱讀[Cloud Run 的 Service、Revision 與 Instance](cloud_run_core_concepts.md)。

## 為什麼正式環境不能只執行 `flask run`？

Flask 內建的 Development Server 方便本機開發：啟動快、錯誤畫面清楚，也能搭配自動重新載入。但 Flask 官方明確說明，它不是為正式環境的安全性、穩定性與效率所設計。

正式服務需要額外處理：

- 綁定 Cloud Run 提供的監聽位址與 `PORT`。
- 同時管理一個或多個 worker process。
- worker 異常退出時重新建立。
- 接收關閉訊號，讓 Container 可以正常停止。
- 依工作型態選擇同步或多執行緒 worker。

!!! info "基礎觀念"
    Flask 負責 Route、Request、Response 與應用程式邏輯；Gunicorn 負責監聽連線及管理 worker。兩者是合作關係，不是二選一。

## 先把四個技術層次拆開

一個 Python Web Request 會穿過幾個不同責任的層次：

| 層次 | 問題 | 現行 `ai-asst-km` | 比較方案 |
|---|---|---|---|
| Web Framework | Route、驗證、Response 怎麼寫？ | Flask | FastAPI |
| Application Interface | Server 怎麼呼叫 Python Application？ | WSGI | ASGI |
| Application Server | 誰監聽 Port、解析 HTTP、驅動 Application？ | Gunicorn | Uvicorn |
| Process／Concurrency | 同一 Instance 同時能安排多少工作？ | Gunicorn workers／threads | Uvicorn event loop／workers |

所以正確的比較方式是：

- **Flask vs FastAPI**：兩個 Web Framework。
- **WSGI vs ASGI**：Server 與 Application 之間的介面規格。
- **Gunicorn vs Uvicorn**：兩個 Application Server，但原生面向的介面不同。

### WSGI 是什麼？

WSGI（Web Server Gateway Interface）定義 WSGI Server 如何把 HTTP Request 轉成 Python 呼叫，以及 Application 如何交回 HTTP Response。

可以把它想成一個插座規格：Gunicorn 與 Flask 不需要知道彼此內部怎麼實作，只要兩邊都遵守 WSGI，就能接在一起。

```text
HTTP Request → Gunicorn → WSGI 呼叫 → Flask Application
HTTP Response ← Gunicorn ← WSGI 回傳 ← Flask Application
```

### ASGI 又多了什麼？

ASGI（Asynchronous Server Gateway Interface）支援非同步呼叫與較長時間的雙向連線情境。FastAPI 建立在 ASGI 生態上，常由 Uvicorn 執行。

但 `async def` 不是自動加速按鈕。只有當程式等待的資料庫 Client、HTTP Client 或其他函式也支援 `await`，event loop 才能在等待期間切去處理其他工作。若在 `async def` 中直接執行阻塞 I/O 或大量 CPU 運算，仍可能卡住 event loop。

## Gunicorn 的 master、worker 與 thread

Gunicorn 使用 pre-fork server model。啟動後，至少會看到兩類程序：

| 元件 | 責任 | 是否直接執行 Flask Route |
|---|---|---|
| Master process | 建立、監督及重新啟動 workers，處理作業系統訊號 | 否 |
| Worker process | 接收並處理 Request | 是 |
| Worker thread | `gthread` worker 內的 Request 工作槽 | 是 |

Master 不處理個別 Request。真正呼叫 Flask Application 的是 worker。

### `sync` worker

`sync` 是 Gunicorn 的預設 worker class。每個 sync worker 一次主動處理一個 Request；程式必須等這個 Request 完成，才能由同一個 worker 處理下一個。

它的優點是執行模型簡單，適合先建立正確、容易推理的基準。代價是當 Request 長時間等待資料庫或外部 API 時，該 worker 也會一起等待。

### `gthread` worker

`gthread` 會在每個 worker process 中建立 thread pool。某個 thread 等待外部 I/O 時，同一個 process 的其他 threads 可以處理不同 Request。

`workers × threads` 可以估算每個 Instance 的 thread 工作槽數，但不能直接當成「同時完成的 Request 數」或「CPU 核心數」：

- Threads 共享同一個 process 的記憶體，通常比建立同量 processes 節省記憶體。
- 每個 worker process 仍會載入自己的 Python Application 與程序狀態。
- CPython 的 GIL 讓 CPU-bound Python 程式不會因增加 threads 就等比例平行加速。
- I/O-bound 工作較可能從 threads 得到好處，但仍受外部 API、Connection Pool、Lock、記憶體與 CPU 限制。

!!! warning "不是越多越好"
    增加 workers 或 threads 都會消耗資源。設定必須用負載測試觀察吞吐量、延遲、記憶體、CPU 與錯誤率，而不是套用一條固定公式。

## 逐段讀懂 `ai-asst-km` 的啟動命令

### Model API

正式分支目前使用：

```dockerfile title="ai-asst-model-api/prod/Dockerfile"
CMD gunicorn -w 4 -k gthread --threads 25 --timeout 600 \
    -b 0.0.0.0:${PORT:-6001} bootstrap_cloud:app
```

| 片段 | 意義 |
|---|---|
| `gunicorn` | 啟動 Gunicorn master process |
| `-w 4` | 建立 4 個 worker processes |
| `-k gthread` | 每個 worker 使用 thread pool |
| `--threads 25` | 每個 worker 建立 25 個 Request threads |
| `--timeout 600` | worker 沉默超過 600 秒時，由 master 終止並重啟 |
| `-b 0.0.0.0:${PORT:-6001}` | 接受 Container 外部連線；Cloud Run 注入 `PORT`，本機預設 6001 |
| `bootstrap_cloud:app` | Import `bootstrap_cloud` module，再取得其中名為 `app` 的 WSGI Application |

這個拓撲共有 `4 × 25 = 100` 個 thread 工作槽。Repository 註解記錄這是經過內網 JMeter 驗證的組合；Cloud Run workflow 同時明確設定 `--concurrency 100`。

!!! example "ai-asst-km 實際做法"
    Model API 會等待外部模型與檢索相關 I/O，現行設定以 `gthread` 增加等待期間可安排的 Request 數。它仍只有 1 vCPU，因此 100 個工作槽不代表能同時進行 100 份 CPU 平行運算。

### Data API

正式分支目前使用：

```dockerfile title="ai-asst-data-api/Dockerfile"
CMD gunicorn -w 1 -k sync --timeout 60 \
    -b 0.0.0.0:${PORT:-6002} app:app
```

| 片段 | 意義 |
|---|---|
| `-w 1` | 只有 1 個 worker process |
| `-k sync` | 一次主動處理 1 個 Request |
| 未設定 `--threads` | 維持 1 個 thread；對 sync worker 不增加併發能力 |
| `--timeout 60` | sync worker 沉默超過 60 秒時會被終止並重啟 |
| `app:app` | Import `app.py`，取得其中的 Flask `app` object |

Data API 的單一 Instance 目前只有一個 Gunicorn Request 工作槽。它的 Request 通常較短，但仍需考慮 MongoDB 查詢、Connection Pool 與突發流量。

## Cloud Run concurrency 不是 Gunicorn concurrency

這是整個主題最容易混淆、也最重要的邊界：

| 設定 | 控制者 | 控制的事情 |
|---|---|---|
| Cloud Run concurrency | Cloud Run | 最多把多少個同時進行的 Request 送進同一個 Instance |
| Gunicorn workers／threads | Container 內的 Gunicorn | Instance 內有多少 Application 工作槽可以接手處理 |
| Cloud Run max instances | Cloud Run Autoscaler | Service 最多擴張到幾個 Instances |

Google Cloud 建議 Cloud Run concurrency 不高於程式本身能穩定處理的 concurrency。否則 Request 已被算進該 Instance 的進行中流量，卻只能在 Gunicorn 前面等待工作槽；這可能增加延遲，也可能讓 Autoscaler 比預期更晚建立新 Instance。

### 現行設定的容量對照

| Service | Cloud Run concurrency | Gunicorn 拓撲 | 可直接讀出的工作槽 | 判讀 |
|---|---:|---|---:|---|
| Model API | 100 | 4 gthread workers × 25 threads | 100 | 平台上限與 thread 工作槽對齊；仍須以壓測確認 1 vCPU、記憶體與下游服務能承受 |
| Data API | 80 | 1 sync worker | 1 | 平台上限高於 Application 工作槽；不一定立即出錯，但應用壓測確認排隊、延遲與擴縮行為 |

!!! warning "這是容量檢查點，不是直接改設定的結論"
    Data API 的 `80 對 1` 是目前可查證的設定差異。是否改成較低 Cloud Run concurrency、增加 Gunicorn workers，或改用 gthread，必須先測量 Request 延遲、MongoDB Connection Pool、CPU、記憶體與成本；這篇不直接修改正式服務。

### 兩層 timeout 也不相同

| Service | Cloud Run Request timeout | Gunicorn timeout | 先記住的重點 |
|---|---:|---:|---|
| Model API | 300 秒 | 600 秒 | Cloud Run 可能先中斷對 Client 的連線；Container 內的工作不一定立刻停止 |
| Data API | 60 秒 | 60 秒 | 兩層數字相同，但 Client、資料庫與程式內部仍可能有更短 timeout |

Cloud Run timeout 是「Service 必須在多久內回傳 Response」；超過後 Client 會收到 `504`，但處理該 Request 的 Container 不會因此自動被終止。Gunicorn `timeout` 則是 master 判斷 worker 是否沉默的存活機制；尤其對 `gthread` 這類非 sync worker，它不是精準的單一 Request deadline。

## Flask vs FastAPI，Gunicorn vs Uvicorn

### Flask 與 FastAPI

| 比較 | Flask | FastAPI |
|---|---|---|
| Application Interface | WSGI | ASGI |
| Route 寫法 | Decorator；可搭配 Flask-RESTX | Decorator + Python type hints |
| 輸入驗證／Schema | 依套件與程式自行組合 | 內建整合 Pydantic 與 OpenAPI |
| `async` 生態 | 核心部署仍以 WSGI 為主 | 原生 ASGI，適合 async／await |
| 現行角色 | Model API、Data API | `ai-deploy-docs` 的 AI 助理後端；不是 `ai-asst-km` 兩支正式 API |

FastAPI 的型別驗證、自動 OpenAPI 文件與 ASGI 支援很方便，但把 Flask 專案改成 FastAPI 是 Framework migration，不只是把啟動命令換掉。Route、Request object、驗證、Extension、測試與部署方式都需要重新確認。

### Gunicorn 與 Uvicorn

| 比較 | Gunicorn | Uvicorn |
|---|---|---|
| 主要角色 | Process manager + Application Server | ASGI Server；也有內建多 worker 管理 |
| 原生 Application | WSGI | ASGI |
| 現行使用 | 執行兩支 Flask API | 執行本站 FastAPI Chatbot backend |
| 常見啟動 | `gunicorn module:app` | `uvicorn module:app --host 0.0.0.0 --port ...` |

Gunicorn 也能管理 ASGI worker，但 Uvicorn 官方已將舊的 `uvicorn.workers` module 標示為 deprecated，新的整合應使用獨立的 `uvicorn-worker` package，或直接使用 Uvicorn 內建的 `--workers`。因此網路上常見的舊指令不能不查版本就照抄。

!!! info "怎麼選不是看誰比較新"
    現有 Flask／WSGI 程式沒有 async 或自動 Schema 的需求時，Gunicorn 仍是合理而成熟的部署方式。新 API 若重視 type-driven validation、OpenAPI 與 async I/O，可以評估 FastAPI + Uvicorn；最終仍要依依賴套件、團隊維護能力與壓測結果決定。

## 實際設定查證

| 查證項目 | 現行結論 | 來源 | 查證日期 |
|---|---|---|---|
| Model Framework／Server | Flask 3.1 + Flask-RESTX + Gunicorn 23 | `ai-asst-model-api/prod/requirements.txt` | 2026-08-23 |
| Model Gunicorn | 4 gthread workers、每個 25 threads、600 秒 timeout | `ai-asst-model-api/prod/Dockerfile` | 2026-08-23 |
| Model Cloud Run | concurrency 100、1 vCPU、300 秒 Request timeout | Model deploy workflow；Cloud Run Service 唯讀查詢 | 2026-08-23 |
| Data Framework／Server | Flask 3.1 + Gunicorn 23 | `ai-asst-data-api/requirements.txt` | 2026-08-23 |
| Data Gunicorn | 1 sync worker、未設定額外 threads、60 秒 timeout | `ai-asst-data-api/Dockerfile` | 2026-08-23 |
| Data Cloud Run | concurrency 80、1 vCPU、60 秒 Request timeout | Data deploy workflow；Cloud Run Service 唯讀查詢 | 2026-08-23 |
| 本站 Chatbot | FastAPI Application 由 Uvicorn 執行 | `ai-deploy-docs/backend/Dockerfile` | 2026-08-23 |

## Lab 實作練習

**安全等級**：本機實作

### 目標

不啟動正式服務、不讀取 Secret，從兩個 Repository 的正式分支判讀 Flask、Gunicorn 與 Cloud Run concurrency 是否對齊。

### 環境需求

- 本機已有 `ai-asst-model-api` 與 `ai-asst-data-api`。
- 可使用 Git、`rg` 與基本 Shell 指令。
- 在 `ai-asst-km` 根目錄執行。

### 步驟

1. 找出兩支 API 的 Gunicorn 啟動命令：

    ```bash
    git -C ai-asst-model-api show origin/main:prod/Dockerfile \
      | rg '^CMD gunicorn'

    git -C ai-asst-data-api show origin/main:Dockerfile \
      | rg '^CMD gunicorn'
    ```

2. 找出 workflow 是否明確設定 Cloud Run concurrency：

    ```bash
    git -C ai-asst-model-api show origin/main:.github/workflows/deploy.yml \
      | rg -- '--concurrency|--cpu|--timeout'

    git -C ai-asst-data-api show origin/main:.github/workflows/deploy.yml \
      | rg -- '--concurrency|--cpu|--timeout'
    ```

3. 對 Model API 做紙上計算：

    ```text
    4 workers × 25 threads = 100 thread 工作槽
    Cloud Run concurrency = 100
    ```

4. 對 Data API 記錄「workflow 沒有明確寫 concurrency」。若要確認正式服務的實際值，應使用 Cloud Run 筆記中的雲端唯讀 `gcloud run services describe`，而不是直接猜預設值。

### 驗證結果

- [ ] 能指出 `bootstrap_cloud:app` 與 `app:app` 的 module、Application object。
- [ ] 能說明 Model API 為什麼只有 1 vCPU，卻仍可設定多個 I/O 工作 threads。
- [ ] 能說明 Data API 的 1 sync worker 不等於 Cloud Run 只會送 1 個 Request。
- [ ] 能分辨 Cloud Run Request timeout 與 Gunicorn worker timeout。
- [ ] 全程沒有啟動、修改或重新部署正式 Cloud Run Service。

## 常見問題

??? question "4 workers × 25 threads 就代表每秒一定能處理 100 個 Request 嗎？"
    不代表。100 是同一 Instance 可安排的 thread 工作槽，不是每秒吞吐量。Request 時間、CPU、記憶體、GIL、Lock、外部 API rate limit 與 Connection Pool 都會影響實際結果。

??? question "Cloud Run 已經會自動擴張，Container 裡為什麼還需要 workers？"
    Cloud Run 擴張的是 Instance 數量；workers／threads 控制每個 Instance 內的 Application 容量。兩層會一起決定延遲、吞吐量、成本與擴張速度。

??? question "用了 FastAPI 就不需要 Gunicorn 或 Uvicorn 嗎？"
    仍需要 ASGI Server 接收連線並驅動 Application。常見做法是直接使用 Uvicorn，也可以讓 Gunicorn 搭配相容的 ASGI worker。

??? question "把 Flask 換成 FastAPI，現有同步程式就會自動變快嗎？"
    不會。同步 MongoDB Client、同步 HTTP Client 或 CPU-bound 函式仍然是阻塞工作。遷移前要先找出真正瓶頸，再確認依賴是否支援 async。

??? question "Data API 的 Cloud Run concurrency 80 是從哪裡來的？"
    Data deploy workflow 沒有明確宣告 `--concurrency`；80 是 2026-08-23 對正式 Cloud Run Service 的唯讀查詢結果。這也示範了為什麼只看 workflow 可能看不到完整現況。

## 小結

- Flask 與 FastAPI 是 Web Framework；Gunicorn 與 Uvicorn 是 Application Server，不能跨層直接比較。
- WSGI 讓 Gunicorn 呼叫 Flask；ASGI 則支援非同步 Application 與較多連線型態。
- Gunicorn master 管理 workers，真正處理 Request 的是 worker process／thread。
- Model API 現在是 4 gthread workers × 25 threads；Data API 是 1 sync worker。
- Cloud Run concurrency 與 Gunicorn 工作槽是兩層設定，必須一起用壓測調整。
- Timeout 也有平台、Application Server、程式與 Client 多層，最短的一層通常先影響使用者。

後續可以沿著 Data API 往後，繼續整理 MongoDB 的資料模型、Connection Pool 與 Index。

## 延伸閱讀

- [Flask：Deploying to Production](https://flask.palletsprojects.com/en/stable/deploying/)
- [Flask：Gunicorn](https://flask.palletsprojects.com/en/stable/deploying/gunicorn/)
- [Gunicorn：Server Model 與 Worker Types](https://docs.gunicorn.org/en/stable/design.html)
- [Gunicorn：workers、threads 與 timeout 設定](https://docs.gunicorn.org/en/stable/settings.html)
- [Uvicorn：Deployment](https://www.uvicorn.org/deployment/)
- [FastAPI：Concurrency 與 async／await](https://fastapi.tiangolo.com/async/)
- [Google Cloud：Cloud Run Maximum Concurrent Requests](https://docs.cloud.google.com/run/docs/about-concurrency)
- [Google Cloud：Cloud Run Request Timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout)
