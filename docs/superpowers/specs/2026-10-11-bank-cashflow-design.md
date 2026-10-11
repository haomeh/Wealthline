# 銀行流水與統一收支 Overview 設計

狀態：使用者已批准功能範圍；本文件待獨立審查與使用者文件確認。基準：main c61c4a3。只做設計／計畫，未開始功能實作。

## 已批准的目標與非目標

銀行對帳單匯入獨立流水，不能加入既有消費明細表格；Overview 在同一圖表區塊統計收入與實際消費。總資產維護完全獨立：不可修改 accounts、positions、liabilities 或持倉歷史，不強制引用資產 accountId。不保存期初、期末、逐筆餘額、完整帳號、原始 PDF、完整擷取文字或明文密碼。

使用者指定的六個樣本：HSBC Taiwan、HSBC Singapore、DBS Taiwan、Taishin、Fubon、E.Sun。原始樣本與 BANK_PASSWORDS 僅在本機格式驗證；不提交、不傳外部服務、不寫入開發文件。首批版型支持以實際格式調查為準，不代表支持同銀行全部月份／產品；不可辨識時明確拒絕或標示未解析，不能推算交易方向或以餘額差推算金額。

## 路徑與模組邊界

- `bankTransactions.ts`：獨立流水型別、嚴格 allowlist parser、分類及規則、去重。
- `bankStatements.ts`／`bankStatements/`：中立文字 item 位置到版型專用交易解析；保留交易列定位 provenance，不保留客戶資料或餘額欄。
- `statementDocument.ts`：PDF.js 共用 lifecycle／worker／本機資源；顯式 bank / credit-card document mode，銀行路徑不得套用匯豐信用卡區段與 OCR。
- `cashflow.ts`：純函式，信用卡 expenses 與銀行流水生成報表投影，完全不修改來源資料。
- `views/BankTransactions.tsx`、`BankStatementImport.tsx`、`BankTransactionEditor.tsx`、`BankCategoryRules.tsx`：獨立頁面、預覽及分類管理；沿用密碼 vault。
- `views/CashflowSummary.tsx`、`CashflowChart.tsx`：統一 Overview 收支區塊，不合併資產走勢圖。

`/bank-transactions` 為獨立分頁；Overview 提供銀行流水與信用卡消費兩個入口。消費明細頁既有來源與資料不改。不要為此改寫全應用的帳戶／資產模型。

## 流水模型與帳戶身份

新增 optional `bankTransactionAccounts`、`bankTransactions`、`bankCategoryRules`，存在任一欄位時升 v13；舊版前端應拒讀 v13。空欄位仍保留 v13，避免背景儲存降版。無新資料的舊檔維持原有版本與欄位。

獨立帳戶：`{id, label, bank}`。id 為本機隨機 UUID，非資產 id，非完整帳號；label 可改名，bank 為名稱。匯入每個帳戶／幣別區段時須明確選擇既有獨立帳戶或新增標籤，不能把同一家銀行的不同戶號／PDF 混成同一帳戶。敏感帳號可只在記憶體用來分段，不保存、不作 UI 預設名稱；同幣別多戶顯示「帳戶區段 1／2」供使用者選擇。label 改名不得改去重身份；已被流水引用的獨立帳戶不得直接刪除，先清除其流水或保留該帳戶。不連動資產帳戶的改名／刪除。

流水：`{id, accountId, date, description, currency, direction, amount, classification?, sourceKey?, importKey?}`。

- direction = debit / credit；amount 為有限、非負數（含 0），絕對上限沿用 expense 1e12；YYYY-MM-DD 必須是有效日期。
- date 優先用銀行已明確定義的入出帳／交易日；同時存在交易日與記帳日時，銀行流水採記帳日、UI 與文件明確說明，不能任意取 PDF metadata 建立日期。月份推年只能基於已識別帳單期間；年不明或跨年不唯一時留待確認，不猜。
- classification 為逐筆手動覆寫：收入 category、消費 category、排除 reason 或待確認。不存在時套用規則與自動建議。禁止多個分類 target 同時存在。
- 收入分類：薪資、股利、利息、投資回收款、其他收入、未分類。
- 消費分類：重用 EXPENSE_CATEGORIES，不新建近似列表。
- 排除理由：自有帳戶轉帳、信用卡繳款、投資本金移動、其他不計收支。排除只影響報表，不刪流水。
- 收入不限 credit：手動標記 debit 為收入沖回時從收入扣除；消費不限 debit：credit 可手動標記消費退款，從同分類消費扣除。UI 顯示沖回／退款語意。

獨立帳戶 id 與流水 id 在各 collection 中必須唯一；每個流水 accountId 必須恰好引用一個獨立流水帳戶。JSON 載入與批次確認皆驗證，重複／懸空引用直接拒絕，不生成替代 id、不回退到資產帳戶。預覽新帳戶與其交易須原子確認，避免失敗後留下孤兒帳戶。

模型讀取只回傳允許欄位，額外 balance/accountNumber/rawText/password 等不得留存。錯誤訊息不得回顯敏感原文。allowlist 不能保護合法字串中夾帶的識別碼，因此 parser 摘要只取交易敘述，不附帶戶名／帳號表頭。對已識別的本戶／對手完整帳號、客戶識別碼，採固定「[帳號已遮蔽]／[識別碼已遮蔽]」替代：先做 deterministic 標準化，再依版型欄位／帳號語境與本次記憶體識別碼清單遮蔽，遮蔽後才顯示預覽、建立交易比對 signature、保存。不能把所有長數字一律刪除，合法訂單／交易 reference 可保留。

同一文字保護 helper 必須用於 parser、預覽／逐筆編輯／新增帳戶標籤、JSON 載入與保存驗證：有明確帳號／識別碼語境的輸入遮蔽或拒絕；label 中不要預設完整帳號。使用者任意輸入且無帳號語境的數字無法保證判別，UI 提示勿輸入完整帳號／身分資料，文件不得宣稱可識別所有敏感字串。驗收的『無完整帳號』限於已識別／明確標記的識別碼及結構化欄位，不宣稱任意自由文字皆已匿名化。未知識別碼歧義列在本機預覽提示確認，不將未遮蔽原文寫入日誌或 synthetic fixture。遮蔽策略固定且一致，避免因改動遮蔽造成重匯入 signature 不穩。

## 分類規則與判斷

沿用消費操作方式：手動分類 > 第一條匹配的自訂規則 > 高信心內建建議 > 待確認。規則使用 NFKC、大寫、空白標準化的摘要關鍵字，可限定 debit / credit；規則 target 使用與手動分類相同的 discriminated union。新增／編輯／刪除規則即更新未手動覆寫流水與報表，已匹配規則可直接再編輯，不新增重複條目；關閉／取消 modal 不丟失預覽。

「轉帳」本身不夠證明自有帳戶轉帳；未知 credit 或 debit 不能全部自動計入。只有明確薪資／股利／利息描述或明確繳卡費、已知消費語意等可自動建議；不保證對帳單摘要能辨識投資回收款，由使用者手動改或建規則。沒有明確記帳用途的有效金額／方向列仍是合法流水，分類為待確認；預览必須醒目顯示，使用者可保存待確認流水。

投資回收款整筆算入收入。固定提示「可能包含投入本金，不代表投資收益」；可改成其他收入或不計收支。

第一版不自動對帳兩邊轉帳、不比對跨幣別金額、不自動將一般轉帳排除。信用卡付款未辨識時維持待確認，不能為追求看似完整總額而猜測。

## PDF 匯入與去重

瀏覽器本機解析，沿用 20MB、100頁、500000字元限制、取消／離開 session abort、lazy PDF.js、密碼候選與 vault 帳號 scope。新增銀行入口，不把銀行 PDF 送入信用卡 parser。分頁／欄位位置必須保留，禁止只取列尾金額（列尾很可能是餘額）。排除存款總覽、投資／信用卡段落、廣告、期初期末餘額、合計、無交易區段。

每檔／區段結果分別顯示：已辨識、待確認、未辨識／拒絕的數量及原因。合法已辨識列可合併預覽；歧義列不能選為有效交易直到使用者補齊日期／方向／金額／幣別。不因一檔失敗阻擋其餘檔案。未交易區段為成功空區段，不捏造零金額交易。零筆不等於解析完整，必须區分無交易證據與沒有辨識。

預覽可改帳戶、摘要、日期、方向、金額、幣別及分類、取消勾選或手動補登。確認匯入只修改銀行 collection，需既有「儲存變更」才持久化。改預覽保留 parser 的原始 provenance。

去重 namespace 使用 bank-v1（不得與 card keys 互比）；sourceKey = hash(document hash, page/section/original row identity, independent account id)；importKey = hash(account id, original date/description/currency/direction/amount, repeated occurrence ordinal)。含方向與帳戶身份，兩帳戶的轉帳 counterpart 都保留。label 改名、逐筆編輯後重匯入保留識別碼；更改預覽 accountId 要重算 domain/account provenance，再和目的帳戶去重。批次內重複 PDF、重疊帳單及同日同額多筆依序數／數量比對。無银行 reference 的跨帳單完全相同交易有歧義，呈現疑似重複並允許使用者核對，不宣稱絕對準確。

## Overview 報表投影

單一 CashflowSummary 取代 Overview 原 ExpenseSummary，涵蓋有銀行／信用卡任一資料的情況，包括零資產 empty state。保留前往信用卡頁與銀行頁。銀行流水不加入 Expenses 頁或既有 credit-card transaction table；收支區塊若提供 drilldown，兩來源明確分開，不標為信用卡消費明細。

對各幣別、所選月份截止的1/3/6/12月：

- 收入 = 收入 credit − 收入 debit（沖回）。
- 實際消費 = 既有信用卡 signed amount 合計 + 消費 debit − 消費 credit（退款）。信用卡退款沿用現有手動 category／rule。
- 收支差額 = 收入 − 實際消費；不是帳戶餘額／淨資產，也不保證是財務期間完整現金流。
- 排除及待確認不計入總額；各自列筆數與按幣別金額、可前往修正。已分類未分類收入／消費仍按選定 kind 計入。
- 幣別各自計算，第一版不以資產 FX 換算為同一總額。
- 每月無任一來源記錄 = null／無紀錄；有該幣別記錄（包括排除／待確認）但某分類無流水 = 0，並呈現資料覆蓋提示。零不代表已完整匯入整月。

主圖月度並列長條圖，收入／消費使用分開圖例、可顯示負值，點月切換月份；有可用鍵盤的月份按鈕及完整數值表，不能只依賴滑鼠或顏色。近1月仍有兩個系列，不用資產線圖。圖表區塊可切換「趨勢／收入分類／消費分類」。分類圓環只繪製正的分類淨額；零／負分類（退款／沖回超出原額）另列帶符號數值，不把負值塞圓餅，標示圓環為正值占比，完整淨額以表格與總額為準。全部<=0時不用圓環，顯示明細與說明。投資回收款在收入占比可见，固定警告不可視為投資獲利。

不引入新圖表套件；沿用 SVG／現有 charts 色彩與樣式。手機320px頁面無横向溢出、可點擊／鍵盤，未載入資料不得呈現 NaN。

## Persistence、相容性與隱私

v13 適用於任一新 collection；model/App/history/saveState/quantityHistory/holdingPeriods/Expenses 的版本提升都不得降版。將重複 version 決策收斂成無循環依賴的純 helper，保持 v1–12 既有升版優先權（由測試確認），只做與新版本必要的重構。save conflict、deferred edits 保留已有 guard。

vault 不改加密格式；銀行與信用卡共享同一使用者 scope 與密碼 manager，不以密碼 label 猜銀行。完整 `.env` 不讀入網站、不使用 VITE_ secret、不配置部署 secret。开发只在本機腳本存取 BANK_PASSWORDS。真实样本／客戶內容／密碼不得提交，測試全部 synthetic。更新中英文隱私及銀行匯入文件：保存使用者選擇的交易紀錄及摘要、不保存餘額／原始文件；去重文件 hash 是不可逆識別不是 PDF 副本。

## 驗收與限制

1. 六份樣本完成每區段版型證據與 local-only驗證；不可靠者 fail closed 並標為不支持，不能以空成功掩蓋漏列。
2. 合成 positional fixtures 覆蓋各已支持銀行、日期／多幣別／跨行／續頁／摘要區段、入出帳、退款、歧義欄位與無交易。
3. 匯入／編輯／分類／保存後資產、負債、持倉歷史完全不變；保存 JSON 無 balance、結構化或已識別完整帳號、raw text、PDF 或明文 secret。合成摘要內嵌帳號、標籤／編輯／JSON roundtrip 同樣遮蔽，合法 numeric reference 不被誤刪；驗證遮蔽 deterministic。唯一帳戶／流水 id 及引用完整性在載入／批次確認皆強制驗證。
4. 新舊 JSON／所有 edit/save 路徑保留 v13 和 collections；deferred save 不覆蓋後續銀行編輯。
5. 重匯入／改名／改預覽／多帳戶 counterpart／同值多次與批次重複。
6. Overview 收入與消費／沖回／退款／排除／待確認／跨年／多幣別／無紀錄／負值分類，兩來源各一筆不重複列入。
7. 本機／模擬 Drive、密碼失效 fallback、取消、分類 modal 保留預覽；真实瀏覽器測試合成加密PDF與手機布局。
8. `npm test`、`npm run lint`、`npm run build`、`git diff --check` 通過；以证据报告未驗證的银行变种。部署／push／PR／合併需要後續明確授權。

## 格式調查附錄

本機已調查6份／20頁，去識別完整證據見 [銀行格式證據](2026-10-11-bank-format-evidence.md)。這是單一觀察版型，不是各銀行所有產品兼容承諾。

| 銀行 | 第一版明確範圍 | 必要限制 |
|---|---|---|
| HSBC Taiwan | TWD／已觀察外幣現金帳戶交易表 | DD/MM/YYYY；描述跨行／同日省略日期；不能以敘述中的幣別覆蓋區段幣別 |
| HSBC SG | 已觀察 SGD savings activity | DDMMMYYYY；同帳戶跨頁未完交易、Brought／Carried Forward 排除，連續性不明則拒絕 |
| 台新 | 已觀察 TWD 單列交易表 | YYYY/MM/DD；整數貨幣含 $／逗號；外幣與任意跨頁交易未證明 |
| 富邦 | 已觀察 TWD／USD 交易表 | YYYY/MM/DD；對手 reference 可占相反金額欄，必須幾何＋已證明小數金額格式，不可把純長整數帳號當貨幣 |
| 玉山 | 已觀察轉出交易明細（局部） | 民國年月日；空白幣別須唯一映射同文件帳戶摘要，否則拒絕；不能當作完整月流水或已支持入帳 |
| 星展 | 認得綜合對帳單，但不支持本樣本的交易匯入 | 樣本只有摘要／揭露，無活動表或無交易證明；顯示『未辨識到支持的交易明細，需提供含交易的樣本』，不能宣稱零交易成功 |

首批驗收為四個已觀察可解析版型＋玉山明示局部覆蓋＋星展明確拒絕；若使用者要求星展完整自動解析／玉山完整帳戶流水，需追加含交易樣本後再擴範圍。不得為涵蓋六銀行而套用泛用列尾金額 parser。
