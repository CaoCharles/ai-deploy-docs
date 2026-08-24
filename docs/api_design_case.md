---
authors:
  - name: Charles Cao
tags:
  - API
  - Flask
  - REST
---

# REST API 設計案例

[HTTP Request、GET、POST 與 REST API](http_get_post_rest_api.md) 講了 Method 語意與怎麼決定用哪一個 Method。這篇把那套框架套進 `ai-asst-km` 的實際系統，看正式環境的 API 地圖，以及幾個「照理論該用 A、實際用 B」的設計取捨。

## 學習目標

- [ ] 讀懂 `ai-asst-km` 的完整 API 地圖，說出每支 Route 的 Method 與用途。
- [ ] 說明 `session-history` 端點為什麼用 `POST`，而不是嚴格套用 `GET`。
- [ ] 分辨 Model API（Flask-RESTX）與 Data API（原生 route）的寫法差異與原因。
- [ ] 看懂 HTTP Method 如何對應到 PyMongo 的實際操作。

## 這篇筆記涵蓋的範圍

這篇只談 Frontend、Model API、Data API 之間的 Route 設計與取捨，不重講 HTTP Method、Status Code 的通用定義；Request 進入 Container 後由誰接住，見 [Gunicorn 與 Uvicorn 架構案例](server_architecture_case.md)。

## 前置知識

先讀 [HTTP Request、GET、POST 與 REST API](http_get_post_rest_api.md)，能說出 Method 的副作用與冪等性判斷即可。

## ai-asst-km 的主要 API 地圖

| 呼叫者 | Method 與 Path | 主要用途 | 是否可能寫入資料 |
|---|---|---|---|
| Frontend | `POST /model_predict` | 送出問題並取得回答 | Model API 不寫 session |
| Frontend | `GET /data-api/sessions` | 取得目前使用者的 session 清單 | 否 |
| Frontend | `GET /data-api/sessions/{session_id}` | 取得完整對話歷史 | 否 |
| Frontend | `GET /data-api/sessions/{session_id}/meta` | 輕量檢查歷史是否更新 | 否 |
| Frontend | `POST /data-api/sessions/{session_id}` | 附加一輪問題與回答 | 是 |
| Frontend | `PUT /data-api/sessions/{session_id}/feedback/{response_uuid}` | 更新回答回饋 | 是 |
| Frontend | `DELETE /data-api/sessions/{session_id}` | 刪除一段對話 | 是 |
| Model API | `POST /data-api/session-history` | 使用 service token 唯讀歷史 | 否 |

大部分 Route 都對得上講義裡的決策框架：清單／查詢用 `GET`，附加對話用 `POST`（每次呼叫都新增一輪，不冪等），更新回饋用 `PUT`（覆蓋整筆 feedback，冪等），刪除用 `DELETE`。有兩個例外值得拆開看。

## 為什麼讀取歷史也有一支 POST？

`POST /data-api/session-history` 是 Model API 專用的 server-to-server 唯讀端點。它把 `session_id` 放在 JSON Body，並要求 service token。

依照講義的判斷框架，這是一個「無副作用」的操作，理論上該用 `GET`。實際選 `POST` 的原因是呼叫模式：這支 API 只給 Model API 內部呼叫，不經過瀏覽器，不需要 `GET` 帶來的可快取、可加書籤等特性；而 Body 需要放 `session_id` 與未來可能擴充的查詢條件，用 `POST` 比塞進 Query String 更容易維護結構化欄位。

!!! example "實際案例"
    這個端點雖然使用 `POST`，實際處理仍然只有查詢，不會寫入 MongoDB。判斷副作用不能只看 Method，還要查看 API 契約與實作；不過設計新 API 時，仍應盡量讓 Method 符合一般 HTTP 語意，降低理解成本。

## OPTIONS 為什麼常在程式碼裡出現？

瀏覽器進行跨來源請求前，可能先送出 `OPTIONS` Preflight，詢問 Server 是否允許目前的 Origin、Method 與 Header。Data API 會對 `/data-api/` 的 `OPTIONS` Request 回傳空的 `204`，再加入允許的 CORS Headers。

`OPTIONS` 通過只代表瀏覽器允許送出真正的 Request；後續的身分驗證仍然必須成功，`ai-asst-km` 的兩支 API 都會在 CORS 通過後再檢查 JWT 或 service token。

## Model API 與 Data API 的 Route 寫法為什麼不同？

!!! example "實際案例"
    Model API 使用 Flask + Flask-RESTX 的 `Resource` 寫法管理問答 Route 與輸出模型；Data API 使用 Flask 原生 `@app.route` 明確列出 `GET`、`POST`、`PUT`、`DELETE` 與 `OPTIONS`。兩者目前都不是 FastAPI。

```python title="ai-asst-model-api：Flask-RESTX Resource 概念範例"
@api.route("/model_predict")
class ModelPredict(Resource):
    def post(self):
        ...
```

```python title="ai-asst-data-api：Flask 原生 route 概念範例"
@app.route("/data-api/sessions/<session_id>", methods=["GET", "OPTIONS"])
def get_session(session_id: str):
    ...
```

Model API 需要輸出模型與較完整的 API 文件，Flask-RESTX 的 Resource／Schema 機制比較方便；Data API 的 Route 數量少、欄位相對單純，原生 decorator 已經足夠清楚，不必額外引入 Flask-RESTX 的複雜度。

## HTTP 與 MongoDB 的邊界

MongoDB 不接收上述 GET 或 POST。Data API 在 Flask 函式內使用 PyMongo 執行另一套資料庫操作：

```text
GET session    → find_one()
GET sessions   → find().sort().limit()
POST turn      → update_one(..., $push, upsert=True)
PUT feedback   → update_one(...)
DELETE session → delete_one()
```

HTTP Method 是 Client 與 Data API 之間的協定；`find_one()`、`update_one()`、`delete_one()` 才是 Data API 與 MongoDB 之間的操作。兩者是不同層次，不能互相取代。

## 實際設定查證

以下結論以三個 Repository 的最新 `origin/main` 為準：

| 查證項目 | 現行結論 | 來源 | 查證日期 |
|---|---|---|---|
| 問答 API | Flask-RESTX `Resource.post()` 處理 `/model_predict` | `ai-asst-model-api/prod/app.py` | 2026-08-23 |
| Data API routes | Flask `@app.route` 明確宣告允許的 Methods | `ai-asst-data-api/app.py` | 2026-08-23 |
| Frontend HTTP Client | Axios 分別呼叫 Model API 與 Data API | `ai-asst-frontend/src/services/api.ts`、`dataApi.ts` | 2026-08-23 |
| JSON 驗證 | Data API 檢查 JSON object、必填欄位與未知欄位 | `ai-asst-data-api/app.py` | 2026-08-23 |
| 身分傳遞 | Frontend 使用 `Authorization: Bearer` Header | Frontend API Client | 2026-08-23 |
| CORS Preflight | 兩支 API 都處理 OPTIONS 並加入允許的 CORS Headers | Model/Data API `app.py` | 2026-08-23 |
| MongoDB 邊界 | 只有 Data API 透過 PyMongo 查詢與寫入 session | `ai-asst-data-api/app.py` | 2026-08-23 |

## 常見問題

??? question "為什麼 Model API 不直接寫 session 到 MongoDB？"
    現行設計把「產生回答」與「保存對話紀錄」拆給兩支服務：Model API 專注呼叫模型與組裝回答，Data API 專注 session 的讀寫與資料驗證。Model API 需要歷史時，改呼叫 Data API 的唯讀端點，而不是共用同一個資料庫連線，降低兩支服務彼此耦合的風險。

??? question "`GET /data-api/sessions/{session_id}/meta` 跟 `GET /data-api/sessions/{session_id}` 差在哪？"
    兩者都是唯讀查詢，差別在回傳的資料量：`meta` 只回傳足以判斷歷史是否有更新的輕量欄位，完整歷史則回傳整段對話。這是同一個資源、依用途拆出不同粒度的查詢端點，而不是另外設計新的 Method。

## 小結

- `ai-asst-km` 的大部分 Route 都符合講義的決策框架：`GET` 查詢、`POST` 建立或附加、`PUT` 覆蓋、`DELETE` 刪除。
- `session-history` 是刻意偏離理論的例外：唯讀但用 `POST`，原因是呼叫模式（server-to-server）與結構化輸入的需求。
- Model API 用 Flask-RESTX、Data API 用 Flask 原生 route，取決於兩者對 Schema／文件的需求，不是規則不一致。
- HTTP Method 與 MongoDB 操作是兩個不同層次，Data API 負責把 Method 轉換成實際的資料庫呼叫。

## 延伸閱讀

- [HTTP Request、GET、POST 與 REST API](http_get_post_rest_api.md)：這篇案例對應的通用講義。
- [Gunicorn 與 Uvicorn 架構案例](server_architecture_case.md)：Request 進入 Container 後怎麼被接住。
- [Flask-RESTX 官方文件](https://flask-restx.readthedocs.io/en/latest/)
