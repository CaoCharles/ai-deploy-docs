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

這篇是通用講義：拆解 Web Framework、Application Interface 與 Application Server 三層，比較 Flask + Gunicorn 與 FastAPI + Uvicorn 兩種常見組合。`ai-asst-km` 實際的啟動指令、workers／threads 設定與容量對照，見 [ai-asst-km 的技術架構案例](server_architecture_case.md)。

## 學習目標

- [ ] 分辨 Web Framework、Application Interface 與 Application Server。
- [ ] 說明 WSGI 在 Gunicorn 與 Flask 之間扮演的角色。
- [ ] 看懂 Gunicorn 的 master、worker process、worker class 與 thread。
- [ ] 看懂啟動指令中 workers、threads、timeout、Application object 各參數的意義。
- [ ] 說明 Cloud Run concurrency 與 Application Server 容量為什麼是兩層不同的設定。
- [ ] 正確比較 Flask／FastAPI，以及 Gunicorn／Uvicorn。

## 這篇筆記涵蓋的範圍

```mermaid
flowchart LR
    Ingress["Cloud Run Ingress"] --> Server["Gunicorn／Uvicorn"]
    Server --> Interface["WSGI／ASGI"]
    Interface --> App["Flask／FastAPI Application"]
```

這篇只談 Request 進入 Container 後，怎麼被 Application Server 接住、再交給 Framework；實際某一個服務用了幾個 workers、幾個 threads，屬於案例文章的範圍。

## 前置知識

- 先閱讀[HTTP Request、GET、POST 與 REST API](http_get_post_rest_api.md)，能辨認 Request、Method、Path 與 Flask route。
- 若對 Cloud Run 的 Instance 還不熟，可以先快速閱讀[Cloud Run 的 Service、Revision 與 Instance](cloud_run_core_concepts.md)。

## 為什麼正式環境不能只執行 `flask run`？

Flask 內建的 Development Server 方便本機開發：啟動快、錯誤畫面清楚，也能搭配自動重新載入。但 Flask 官方明確說明，它不是為正式環境的安全性、穩定性與效率所設計。

正式服務需要額外處理：

- 綁定平台提供的監聽位址與 Port。
- 同時管理一個或多個 worker process。
- worker 異常退出時重新建立。
- 接收關閉訊號，讓 Container 可以正常停止。
- 依工作型態選擇同步或多執行緒 worker。

!!! info "基礎觀念"
    Flask 負責 Route、Request、Response 與應用程式邏輯；Gunicorn 負責監聽連線及管理 worker。兩者是合作關係，不是二選一。

## 先把四個技術層次拆開

一個 Python Web Request 會穿過幾個不同責任的層次：

| 層次 | 問題 | 常見選項 A | 常見選項 B |
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

### Application object 怎麼讀？

Gunicorn／Uvicorn 的啟動指令最後通常會看到 `module:object` 這種寫法，例如 `gunicorn module:app` 或 `uvicorn module:app`。它告訴 Server 要載入哪一個 Python module，以及取得其中哪一個 Application object；不是 API URL、Route 或服務名稱。

冒號左邊是 Python module，右邊是 module 內的變數名稱。例如 `module:app` 相當於從 `module.py` 取得 `app`，再交給 Server 執行。這裡的 `app`，指的就是程式碼中使用 Flask 或 FastAPI 建立的物件：

```python title="Flask"
app = Flask(__name__)
```

```python title="FastAPI"
app = FastAPI()
```

`ai-asst-km` 三個服務實際的 module 名稱，見 [ai-asst-km 的技術架構案例](server_architecture_case.md)。

## I/O 等待、`gthread` 與 async

比較 Gunicorn 與 Uvicorn 時，重點不是哪一個 Server 的名稱比較新，而是 Application 如何利用等待 I/O 的時間。

### 什麼是 I/O 等待？

服務呼叫外部 API、資料庫或其他 HTTP API 時，程式送出 Request 後，需要等待對方回傳結果。

```text
送出外部請求 → 等待數秒 → 收到回應
```

等待期間通常沒有持續進行 CPU 計算。單一同步 worker 必須等目前的 Request 完成，才能開始處理下一個 Request；這段等待時間會直接限制可同時處理的工作數。

### Gunicorn `gthread` 如何利用等待時間？

假設一個服務使用 3 個 `gthread` workers，每個 worker 配置 10 個 threads：

```text
3 workers × 10 threads = 30 個 thread 工作槽
```

某個 thread 等待外部服務回應時，其他 threads 可以處理不同 Request：

```text
Thread A：Request A → 等待外部回應 ─────────→ 繼續處理
Thread B：             Request B → 資料庫查詢 → 回傳
Thread C：             Request C → 呼叫其他 API → 回傳
```

每個進行中的 Request 通常占用一個 thread。等待 I/O 的 thread 不會持續使用 CPU，因此其他 threads 還能執行工作。

Threads 不是免費資源。每個 thread 都需要記憶體與排程成本；設定過多也可能造成 Connection Pool 不足、記憶體增加或執行緒切換成本上升。

### Uvicorn + async 如何利用等待時間？

Uvicorn 透過 event loop 執行 ASGI Application。當程式執行到 `await`，目前的工作會暫停，並把執行權交回 event loop：

```python
response = await async_http_client.post(url)
```

Event loop 可以在多個等待中的 Request 之間切換：

```text
Request A → await 外部 API ───────────────→ 繼續處理
                    ↓
Request B → await 資料庫 ─────────→ 繼續處理
                    ↓
Request C → 執行其他工作
```

這種模型不需要為每個 Request 建立一個 thread。大量 Request 都在等待網路 I/O 時，async 通常可以用較少的 threads 維持較多連線。

### 為什麼改成 Uvicorn 不一定更快？

`async` 必須從 Route 延伸到下游套件。下面的 Route 宣告為 `async def`，內部卻使用同步 HTTP Client；`requests.post()` 執行期間仍會阻塞 event loop：

```python
@app.post("/chat")
async def chat():
    response = requests.post(url)
    return response.json()
```

真正的非同步呼叫需要使用支援 `await` 的 Client：

```python
@app.post("/chat")
async def chat():
    response = await async_client.post(url)
    return response.json()
```

除了 Route，HTTP Client、Database Driver、Middleware 與第三方套件也不能長時間阻塞 event loop。CPU-heavy 的資料處理不會因為改用 async 自動變快，仍需評估更多 processes、Instances、背景工作或其他運算方式。

### 三種執行模型的差別

| 執行方式 | I/O 等待時怎麼處理？ | 主要成本或限制 |
|---|---|---|
| Gunicorn `gthread` | 目前 thread 等待，其他 threads 繼續處理 Request | 每個 thread 都有記憶體與排程成本 |
| Uvicorn + async | `await` 把執行權交回 event loop | Application 與下游套件都必須支援 async |
| 單一 `sync` worker | 等待目前的 Request 完成，再處理下一個 | 容易形成排隊並增加延遲 |

`gthread` 是同步 Flask Application 處理 I/O 等待的一種方式；若要改用 Uvicorn，不能只替換啟動指令，Application、外部 Client、資料庫 Client 與其他依賴都需要一起評估 ASGI／async 遷移。最後仍要透過負載測試比較吞吐量、延遲、CPU 與記憶體。

## Cloud Run concurrency 不是 Gunicorn concurrency

這是整個主題最容易混淆、也最重要的邊界：

| 設定 | 控制者 | 控制的事情 |
|---|---|---|
| Cloud Run concurrency | Cloud Run | 最多把多少個同時進行的 Request 送進同一個 Instance |
| Gunicorn workers／threads | Container 內的 Gunicorn | Instance 內有多少 Application 工作槽可以接手處理 |
| Cloud Run max instances | Cloud Run Autoscaler | Service 最多擴張到幾個 Instances |

Google Cloud 建議 Cloud Run concurrency 不高於程式本身能穩定處理的 concurrency。否則 Request 已被算進該 Instance 的進行中流量，卻只能在 Gunicorn 前面等待工作槽；這可能增加延遲，也可能讓 Autoscaler 比預期更晚建立新 Instance。`ai-asst-km` 每個服務實際的 concurrency 與 worker 拓撲對照，見 [ai-asst-km 的技術架構案例](server_architecture_case.md)。

### 兩層 timeout 也不相同

Cloud Run timeout 是「Service 必須在多久內回傳 Response」；超過後 Client 會收到 `504`，但處理該 Request 的 Container 不會因此自動被終止。Gunicorn `timeout` 則是 master 判斷 worker 是否沉默的存活機制；尤其對 `gthread` 這類非 sync worker，它不是精準的單一 Request deadline。兩層數字不一定要相等，但要一起檢視——只改其中一層，可能讓另一層先觸發預期外的行為。

## Flask vs FastAPI，Gunicorn vs Uvicorn

### Flask 與 FastAPI

| 比較 | Flask | FastAPI |
|---|---|---|
| Application Interface | WSGI | ASGI |
| Route 寫法 | Decorator；可搭配 Flask-RESTX | Decorator + Python type hints |
| 輸入驗證／Schema | 依套件與程式自行組合 | 內建整合 Pydantic 與 OpenAPI |
| `async` 生態 | 核心部署仍以 WSGI 為主 | 原生 ASGI，適合 async／await |

FastAPI 的型別驗證、自動 OpenAPI 文件與 ASGI 支援很方便，但把 Flask 專案改成 FastAPI 是 Framework migration，不只是把啟動指令換掉。Route、Request object、驗證、Extension、測試與部署方式都需要重新確認。

### Gunicorn 與 Uvicorn

| 比較 | Gunicorn | Uvicorn |
|---|---|---|
| 主要角色 | Process manager + Application Server | ASGI Server；也有內建多 worker 管理 |
| 原生 Application | WSGI | ASGI |
| 常見啟動 | `gunicorn module:app` | `uvicorn module:app --host 0.0.0.0 --port ...` |

Gunicorn 也能管理 ASGI worker，但 Uvicorn 官方已將舊的 `uvicorn.workers` module 標示為 deprecated，新的整合應使用獨立的 `uvicorn-worker` package，或直接使用 Uvicorn 內建的 `--workers`。因此網路上常見的舊指令不能不查版本就照抄。

!!! info "怎麼選不是看誰比較新"
    現有 Flask／WSGI 程式沒有 async 或自動 Schema 的需求時，Gunicorn 仍是合理而成熟的部署方式。新 API 若重視 type-driven validation、OpenAPI 與 async I/O，可以評估 FastAPI + Uvicorn；最終仍要依依賴套件、團隊維護能力與壓測結果決定。`ai-asst-km` 三個服務實際各選了哪一組，見 [ai-asst-km 的技術架構案例](server_architecture_case.md)。

## 常見問題

??? question "`workers × threads` 就代表每秒一定能處理那麼多個 Request 嗎？"
    不代表。這是同一 Instance 可安排的 thread 工作槽，不是每秒吞吐量。Request 時間、CPU、記憶體、GIL、Lock、外部 API rate limit 與 Connection Pool 都會影響實際結果。

??? question "Cloud Run 已經會自動擴張，Container 裡為什麼還需要 workers？"
    Cloud Run 擴張的是 Instance 數量；workers／threads 控制每個 Instance 內的 Application 容量。兩層會一起決定延遲、吞吐量、成本與擴張速度。

??? question "用了 FastAPI 就不需要 Gunicorn 或 Uvicorn 嗎？"
    仍需要 ASGI Server 接收連線並驅動 Application。常見做法是直接使用 Uvicorn，也可以讓 Gunicorn 搭配相容的 ASGI worker。

??? question "把 Flask 換成 FastAPI，現有同步程式就會自動變快嗎？"
    不會。同步資料庫 Client、同步 HTTP Client 或 CPU-bound 函式仍然是阻塞工作。遷移前要先找出真正瓶頸，再確認依賴是否支援 async。

## 小結

- Flask 與 FastAPI 是 Web Framework；Gunicorn 與 Uvicorn 是 Application Server，不能跨層直接比較。
- WSGI 讓 Gunicorn 呼叫 Flask；ASGI 則支援非同步 Application 與較多連線型態。
- Gunicorn master 管理 workers，真正處理 Request 的是 worker process／thread。
- Cloud Run concurrency 與 Gunicorn 工作槽是兩層設定，必須一起用壓測調整。
- Timeout 也有平台、Application Server、程式與 Client 多層，最短的一層通常先影響使用者。

接著閱讀 [ai-asst-km 的技術架構案例](server_architecture_case.md)，看這些概念在正式環境的實際數字。

## 延伸閱讀

- [Flask：Deploying to Production](https://flask.palletsprojects.com/en/stable/deploying/)
- [Flask：Gunicorn](https://flask.palletsprojects.com/en/stable/deploying/gunicorn/)
- [Gunicorn：Server Model 與 Worker Types](https://docs.gunicorn.org/en/stable/design.html)
- [Gunicorn：workers、threads 與 timeout 設定](https://docs.gunicorn.org/en/stable/settings.html)
- [Uvicorn：Deployment](https://www.uvicorn.org/deployment/)
- [FastAPI：Concurrency 與 async／await](https://fastapi.tiangolo.com/async/)
- [Google Cloud：Cloud Run Maximum Concurrent Requests](https://docs.cloud.google.com/run/docs/about-concurrency)
- [Google Cloud：Cloud Run Request Timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout)
