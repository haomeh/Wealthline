# 建立 Google Cloud OAuth 用戶端

本專案是純前端應用程式：使用者在瀏覽器中以 Google 登入，App 直接呼叫 Google Drive API，資料只存放在使用者自己的 Google Drive。只需要一個「網頁應用程式」類型的 OAuth 用戶端 ID，**不需要用戶端密鑰（client secret）**，也不需要後端。

## 1. 建立專案並啟用 API

1. 開啟 [Google Cloud Console](https://console.cloud.google.com/)，建立新專案（例如 `wealthline`）。
2. 前往「API 和服務 → 程式庫」，搜尋並啟用 **Google Drive API**。

## 2. 設定 OAuth 同意畫面（Google Auth Platform）

1. 前往「API 和服務 → OAuth 同意畫面」（新版介面稱為 Google Auth Platform → 品牌）。
2. 使用者類型選 **外部（External）**。
3. 填入應用程式名稱、使用者支援電子郵件、開發人員聯絡資訊。應用程式標誌可以用 `public/icon-512.png`（Google 要求 120×120 以上的正方形圖片）。
   「應用程式網域」填入正式網址的頁面：首頁 `https://wealthline.haomeh.com/`、隱私權政策 `https://wealthline.haomeh.com/privacy`、服務條款 `https://wealthline.haomeh.com/terms`，授權網域填 `haomeh.com`。這三頁不需登入即可瀏覽，發布應用程式時 Google 會檢查。
   這三頁在建置時會預先產生靜態 HTML（`scripts/prerender.mjs`），不執行 JavaScript 也能讀到內容。
   首頁網域必須先在 [Google Search Console](https://search.google.com/search-console) 驗證為你所有，而且要用擁有這個 Cloud 專案的同一個 Google 帳號驗證：新增「網域」資源 `haomeh.com`，把 Google 提供的 TXT 記錄加到 DNS（Cloudflare → DNS → 新增 TXT 記錄，名稱填 `@`）。驗證成功後，等 24 小時再重新送出品牌驗證。
4. 在「資料存取（Scopes）」加入：
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `.../auth/drive.file`
5. 在「目標對象 → 測試使用者」加入自己的 Google 帳號。發布狀態為「測試中」時，只有測試使用者能登入，且授權大約每 7 天會失效一次。

`drive.file` 屬於「非敏感」範圍，App 只能看到它自己建立的檔案，看不到使用者 Drive 中的其他檔案。日後要公開給其他人使用時，按「發布應用程式」並完成品牌驗證即可，不需要經過敏感／受限範圍的安全審查。

## 3. 建立 OAuth 用戶端 ID

1. 前往「API 和服務 → 憑證 → 建立憑證 → OAuth 用戶端 ID」（或 Google Auth Platform → 用戶端）。
2. 應用程式類型選 **網頁應用程式**。
3. 「已授權的 JavaScript 來源」加入：
   - `http://localhost:5173`（本機開發）
   - `http://localhost:4173`（`npm run preview`）
   - 正式部署的網址，例如 `https://wealthline.haomeh.com`

   只填「協定 + 網域 + port」，結尾不要加 `/` 或路徑。`localhost` 和 `127.0.0.1` 算不同來源，要和瀏覽器網址列完全一致。存檔後通常要等 5 分鐘到幾小時才會生效。
4. 「已授權的重新導向 URI」留空即可（使用 Google Identity Services 的 token 彈出視窗流程，不需要 redirect）。
5. 建立後複製「用戶端 ID」。

## 4. 設定到專案

```bash
cp .env.example .env.local
# 編輯 .env.local，填入 VITE_GOOGLE_CLIENT_ID
npm install
npm run dev
```

部署到 Cloudflare Workers 時，在 Workers Builds 的建置環境變數中設定 `VITE_GOOGLE_CLIENT_ID`，並記得把正式網址加入「已授權的 JavaScript 來源」。用戶端 ID 會出現在前端程式碼中，這是正常的，它不是機密。

## 常見錯誤

| 錯誤 | 原因 |
| --- | --- |
| `401 invalid_client` + `no registered origin` | 這個用戶端 ID 沒有登記目前的網址來源。到該用戶端的「已授權的 JavaScript 來源」加入瀏覽器網址列的來源（例如 `http://localhost:5173`），不是填在「重新導向 URI」。也請確認類型是「網頁應用程式」、`.env.local` 的 ID 和 Console 中的是同一個，改完 `.env.local` 要重新啟動 `npm run dev`。與測試使用者名單無關 |
| `origin_mismatch` / `redirect_uri_mismatch` | 目前網址沒有列在「已授權的 JavaScript 來源」，注意 port 與 http/https 要完全一致 |
| `access_denied`（存取遭封鎖） | 帳號不在測試使用者名單中 |
| `Google Drive API has not been used in project…` | 尚未在專案中啟用 Google Drive API |
| 彈出視窗被擋 | 允許瀏覽器對此網站顯示彈出視窗 |
