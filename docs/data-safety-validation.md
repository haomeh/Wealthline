# 資料安全修復與驗證

本輪基準為 `origin/main` 的 `300a43d9c2b93a792818960ae0d0ee9de0ff4fe9`（2026-10-09 fetch 後核對），未改動 OAuth scope、憑證或既有 `version: 1` JSON 格式。本次驗證沒有部署正式站。

## Drive 條件寫入

- v3 繼續用於尋找資料檔與資料夾。既有資料檔直接相容。
- 使用 v2 `files.get?fields=id,etag,headRevisionId` 在同一 metadata 回應取得 ETag 和內容 revision，再以 `alt=media&revisionId=...` 下載指定內容。下載後再確認 ETag 與 headRevisionId；任一不同或後讀失敗即拒絕載入，不把下載內容配上較新的 ETag。缺少 revision 也拒絕載入。
- 現有檔案的 media upload 改走 v2 PUT，必須帶「載入或上次成功寫入回應的」`If-Match`。安全性依賴伺服器在實際寫入時原子執行條件判斷，不依賴儲存前再讀一次。
- 成功後只採用該寫入回應中的 ETag，不另行讀取最新 ETag，避免誤認他人版本為本機已存版本。缺少有效版本、412 或網路失敗皆不清除未儲存資料，也不無條件重試。
- 新建使用 v2 multipart，`title`、`parents[].id`、private `properties` 對應既有 v3 的名稱、父資料夾及 `appProperties`。JSON 內容不新增版本控制欄位。
- Drive 沒有檔名唯一限制。首次建立前若已出現資料檔就停止；建立後、載入時及既有會話每次儲存前若發現多檔就拒絕自動選擇。儲存前的檔案搜尋只偵測重複／選錯檔，不是原子版本檢查。兩裝置同時首次建立仍可能產生兩份資料，兩份都保留，需人工比對整理。
- 衝突顯示明確錯誤，保留本機修改並提供 JSON 備份下載。重新載入前先備份，之後手動比對合併；沒有強制覆蓋按鈕。

官方參考：[v2 檔案 ETag](https://developers.google.com/workspace/drive/api/reference/rest/v2/files)、[v2/v3 欄位差異](https://developers.google.com/workspace/drive/api/guides/v2-to-v3-reference)、[v2 files.update](https://developers.google.com/workspace/drive/api/reference/rest/v2/files/update)。這些參考不能代替下述真實並行測試。

## 非同步儲存

手動儲存和每日快照共用同步 ref 鎖；重複點擊也不會同時寫入。儲存時固定提交的資料與編輯序號，完成後只合併歷史／時間戳，請求期間的新編輯保留且維持 dirty。使用者在等待期間刪除的歷史／持倉不復活。會話版本不同則不套用回應。

儲存確認視窗在寫入中禁止取消與 Escape；失敗後關閉視窗，讓錯誤與備份操作可見。尚未送出時取消只返回編輯，不丟棄資料。

## 試算表匯入

`currencies.ts` 集中 crypto 幣別代碼，匯率服務和匯入共用；保留原先三字母／手動匯率工作流程，支援 USDT／USDC。為了舊資料相容性，未收緊 Drive JSON 讀取器的幣別規則。

匯入先產生預覽，列出同名帳戶全部將被刪除的原持倉、匯入後持倉及匯率差異。使用者明確確認後才套用到本機，仍需手動儲存到 Drive。有任何錯誤就整批不套用；逐列呈現缺少數量、不合法數值／幣別、匯率矛盾、現有重複帳戶名稱等問題。編輯貼上文字或預覽期間資料變更時，必須重新預覽。

## 自動檢查

已執行並通過：

```sh
npm test                 # 46 項，含 24 項新增回歸測試
npm run lint
npm exec tsc -- -b
npm run build            # client、SSR、公開頁面預渲染
git diff --check
```

`tests/data-safety.test.mjs` 使用模擬 Drive 端的原子版本判斷，涵蓋兩裝置競爭、讀取中版本變動、缺失版本、回應遺失重試、首次建立衝突，以及匯入和儲存合併。

`tests/ui-data-safety.test.mjs` 以 jsdom 掛載 React，實際觸發輸入、點擊與 dialog cancel 事件，涵蓋匯率儲存期間編輯、二次儲存採用新 ETag、連點、每日快照互斥、衝突保留修改、Escape／取消及匯入預覽流程。jsdom 僅為測試 devDependency，未新增正式執行依賴。

## 尚未完成的真實 Drive 驗證

沒有使用真實 Google 帳戶、存取權杖或測試資料檔，因此**尚未證實實際 Drive v2 media PUT 的 If-Match／412 原子行為、瀏覽器 CORS，以及 v2 private properties 與 v3 搜尋的互通**。模擬測試不構成此項證明；在這些驗證通過前，不應視為可部署的並行安全保證。

後續應在獲授權的測試帳戶、沿用既有 OAuth 設定，以可丟棄的 JSON 檔驗證：

1. 用明確錯誤的 ETag 執行 media PUT，必須回 412 且內容不變。若被接受，停止採用此條件寫入方案，不可把前置 GET 當替代。
2. 兩個分頁／裝置載入同一檔案與版本，同時寫入不同內容，必須僅一方成功、另一方 412，失敗端保留 dirty 與備份能力。
3. 成功方再儲存，確認使用回應 ETag 可成功；失敗方不能自動改用最新 ETag 重試。
4. 在網路節流下修改第一個匯率並儲存，等待期間修改第二個，確認第二個修改保留、下一次儲存包含它。
5. 確認新建檔可由 v3 appProperties 找到；模擬同時首次建立，兩份原始內容都保留且下次載入拒絕自動選檔。
6. 使用真正瀏覽器確認 dialog 的 Escape、取消、焦點及 JSON 備份下載。

舊版客戶端仍會無條件覆寫，新的條件寫入無法阻止舊版客戶端在之後覆蓋資料。發布前須一併規劃讓舊分頁重新載入；本輪不執行正式部署或 Google 帳戶操作。


## 追加的官方文件核對（2026-10-09）

| 項目 | 官方文件可證明的內容 | 限制／結果 |
| --- | --- | --- |
| media update | [v2 files.update](https://developers.google.com/workspace/drive/api/reference/rest/v2/files/update) 指定 `/upload/drive/v2/files/{fileId}` 使用 PUT、支援 `uploadType=media`、成功回傳 File | 此頁未明載 `If-Match` 或 412；[Drive 錯誤指南](https://developers.google.com/workspace/drive/api/guides/handle-errors) 也未找到 412。不能據此宣稱 Drive 對 media update 提供原子 compare-and-swap 保證；尚待真實錯誤 ETag 與競爭寫入測試。 |
| ETag／revision 配對 | [v2 File](https://developers.google.com/workspace/drive/api/reference/rest/v2/files) 列出 `etag` 和 binary content 的 `headRevisionId`；[v2 files.get](https://developers.google.com/workspace/drive/api/reference/rest/v2/files/get) 明載 `alt=media` 時可用 `revisionId` 指定下載版本 | 已由前後 metadata 檢查加強為指定 revision 下載，仍保留前後檢查。若舊 revision 已不可下載則失敗停止，沒有退回下載最新內容。 |
| OAuth | 同上 get/update 與 [v2 files.insert](https://developers.google.com/workspace/drive/api/reference/rest/v2/files/insert) 的 scopes 都列出 `drive.file` | 現有 `src/google/auth.ts` 已要求此 scope，毋須新憑證或擴權。實際檔案授權仍由 Google 判斷。 |
| private properties | [v2/v3 對照](https://developers.google.com/workspace/drive/api/guides/v2-to-v3-reference) 明載 v2 PRIVATE properties 對應 v3 appProperties | 欄位映射有文件依據；新建後搜尋可見時間仍須實測。 |
| CORS | [WHATWG Fetch CORS 規範](https://fetch.spec.whatwg.org/#http-cors-protocol) 定義 preflight 與允許方法／標頭的回應 | PUT、Authorization、application/json 與 If-Match 需 preflight。Google 端須允許來源、PUT 和這些 request headers；etag 從 JSON 讀取，故不依賴 `Access-Control-Expose-Headers: ETag`。本專案 CSP 已允許 www.googleapis.com，不能替代 Google 端 CORS。 |

曾嘗試不帶憑證、以虛構檔案 ID 發送 OPTIONS preflight（沒有發送 PUT 或接觸帳戶），但環境代理在 CONNECT 階段回傳 403。這不是 Google Drive 的回應，**不能據此判斷 Google 允許或拒絕 If-Match 的 CORS**。未要求擴權或繞過代理。

### 寫入結果不明的處理

- 現在使用 PUT（非原本 v3 PATCH）。既有檔寫入成功後不再讀 metadata：只接收該 PUT 的 File/ETag 回應。
- 若伺服器已寫入、但網路斷線／JSON 回應截斷／ETag 缺失，呼叫失敗，本機仍維持 dirty 和原 ETag。程式不自動重試、不讀最新 ETag 來授權覆寫。使用者重試也只能帶原 ETag；安全性仍依賴尚待實測的伺服器條件判斷。
- 首次建立後若搜尋失敗，已建立檔案不刪除，本機仍保留資料；下次嘗試先搜尋，發現檔案即拒絕再建。這不是 exactly-once 建立保證：搜尋延遲／另一裝置並行仍可能留下多份，全部保留並在發現歧義時停止，沒有刪除或自動選出勝出檔案。
- 新增五項回歸涵蓋指定 revision、缺失 revision／後讀失敗、已開啟會話發現重複檔、成功但回應截斷，以及建立成功後搜尋失敗。它們只驗證用戶端保護流程，不驗證 Google 的原子行為或搜尋一致性。


## 每月核對與報表（v16）

`tests/monthly-review-integration.test.mjs` 使用合成九筆九月紀錄及八／十月對照，串接 fake Drive 摘要先行、明細就緒、圖表分類、來源編輯返回、核對、既有儲存及報表。固定 FX 24 的具名預期為收入 930、消費 470、差額 460；FX 改為 25 時交易確認仍有效，消費變為 480、差額 450。跨月移動使九／十月過時但不影響八月；完整備份本機還原與舊 JSON 快照保持獨立。明細讀取 503 不允許核對或完整報表。

`monthly-review-storage` 額外檢查 v16 流水分檔成功寫入後，最終主檔 412 失敗的回復，核對及原有紀錄均保留。來源分組與原因欄位有來源名稱，原因修改在重新確認前顯示草稿提示。這些是 fake Drive／jsdom 的資料路徑證據，不是實際 Drive 原子性、授權、完整端到端或真實帳單覆蓋率證明。

報表內容雜湊不是驗證簽章。匯入報表僅開啟唯讀快照；不會復原或覆寫財務資料。完整備份與月報的差異、未知與零、舊客戶端相容性見 [每月收支核對與報表](monthly-review.md)。
