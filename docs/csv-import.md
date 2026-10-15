# CSV 匯入格式

Wealthline 可以匯入三種 CSV：信用卡消費、銀行流水、帳戶餘額與持倉。CSV 可以自己整理，也可以請你選用的 AI 工具（Gemini、Claude、ChatGPT／Codex 等）從帳單 PDF、Email 或其他來源整理出來。

- **在哪裡匯入**：信用卡消費與銀行流水在「匯入帳單」（`/cashflow/import`），和 PDF 一起選也可以，依 `type` 欄自動分到「信用卡帳單」「銀行對帳單」分頁。帳戶餘額與持倉在「帳戶」頁的「從試算表或 CSV 匯入」。
- **一樣要核對**：CSV 和 PDF 走同一個預覽、去重與「儲存變更」前的確認，確認前不寫入資料。
- **隱私**：CSV 只在瀏覽器讀取，不上傳、不保存原始檔；確認後只保存各欄位整理後的資料。你把帳單或資料交給 AI 工具時，資料會送到該工具的供應商，依該工具的條款處理，不經過 Wealthline。

## 通則

- UTF-8 編碼（可帶 BOM）。Excel 請選「CSV UTF-8（逗號分隔）」；Big5 等其他編碼會被拒絕。
- 逗號分隔，含逗號、引號或換行的欄位用雙引號包起來，引號寫成兩個 `""`（RFC 4180）。
- 第一列是英文欄名，順序不限；不認得的欄位會被忽略。每一列都要有 `type` 欄，同一個檔案只能放一種 `type`。
- 日期一律 `YYYY-MM-DD`，月份 `YYYY-MM`。
- 金額只用半形數字、小數點與負號，不加千分位、貨幣符號或括號。
- 幣別用三碼代號（TWD、USD、SGD、JPY…）。帳戶餘額與持倉另外接受 BTC、ETH、SOL、USDT、USDC。
- 文字欄不可用 `=`、`+`、`-`、`@` 開頭（避免再次用試算表開啟時被當成公式）。
- 只要有一列不合格，整份檔案不匯入，畫面會列出前 20 個問題的列號。最多 5 MB、20,000 列。

## 信用卡消費 `type=card`

| 欄位 | 必填 | 說明 |
|---|---|---|
| `type` | 是 | 固定 `card` |
| `date` | 是 | 消費日；帳單沒有消費日時用入帳日 |
| `description` | 是 | 商家或說明，最多 500 字 |
| `amount` | 是 | 消費為正數，退款為負數 |
| `currency` | 是 | 入帳幣別 |
| `card` | 是 | 自訂的銀行／卡片名稱，最多 100 字；同一張卡請沿用相同名稱。不要填完整卡號 |
| `category` | 否 | 餐飲、交通、購物、旅遊住宿、娛樂、數位服務、生活繳費、醫療、政府規費、未分類；留空時依商家與分類規則自動判斷 |
| `statement_month` | 否 | 帳單月份，用來核對帳單總額 |
| `statement_total` | 否 | 這張帳單本期新增消費的合計（消費減退款，不含繳款與上期餘額）；同卡、同帳單月份、同幣別的每一列填同一個值 |

不要列入：繳款、上期餘額、本期應繳總額、最低應繳等摘要列。

有填 `statement_total` 時，Wealthline 會把同一張帳單的 `amount` 加總比對。不相符時這張帳單的交易仍會列出，但標示「核對」並在解析結果說明差額。

```csv
type,date,description,amount,currency,card,category,statement_month,statement_total
card,2026-09-03,全聯福利中心,1280,TWD,國泰 CUBE,購物,2026-09,1220
card,2026-09-10,NETFLIX.COM,390,TWD,國泰 CUBE,數位服務,2026-09,1220
card,2026-09-12,誠品 退款,-450,TWD,國泰 CUBE,,2026-09,1220
```

## 銀行流水 `type=bank`

| 欄位 | 必填 | 說明 |
|---|---|---|
| `type` | 是 | 固定 `bank` |
| `account` | 是 | 流水帳戶標籤，例如「台新 Richart」。和既有流水帳戶同名（不分大小寫）時記入該帳戶，否則新增一個 |
| `bank` | 否 | 銀行名稱；留空時用 `account` |
| `date` | 是 | 入帳日 |
| `description` | 是 | 摘要，最多 500 字。帳號、身分證字號等已辨識的識別碼會遮蔽 |
| `direction` | 是 | `debit`（支出）或 `credit`（入帳） |
| `amount` | 是 | 正數；方向由 `direction` 決定 |
| `currency` | 是 | 幣別 |
| `classification` | 否 | `income:薪資`、`income:股利`、`income:利息`、`income:投資回收款`、`income:其他收入`、`expense:<信用卡同一套消費分類>`、`excluded:自有帳戶轉帳`、`excluded:信用卡繳款`、`excluded:投資本金移動`、`excluded:其他不計收支`；留空或 `pending` 表示依分類規則或待分類 |
| `closing_balance` | 否 | 帳單的期末餘額，填在這個帳戶與幣別的任一列即可 |
| `closing_date` | 有 `closing_balance` 時必填 | 期末餘額的日期 |

同一個 `account` 的不同幣別會分成不同預覽區段。期末餘額只在 `bank` 是已支援的銀行時補入資產歷史：台新、富邦、玉山、富邦奈米投、Wise，或 HSBC TW、HSBC SG、DBS TW、DBS SG（HSBC 與星展要加國家）。其他銀行，或 `account` 對到的既有流水帳戶屬於另一家銀行時，只匯入流水，並在解析報告說明餘額沒有補入。

```csv
type,account,bank,date,description,direction,amount,currency,classification,closing_balance,closing_date
bank,台新 Richart,台新,2026-09-05,薪資轉入,credit,65000,TWD,income:薪資,,
bank,台新 Richart,台新,2026-09-10,信用卡費 國泰,debit,15320,TWD,excluded:信用卡繳款,,
bank,台新 Richart,台新,2026-09-30,利息,credit,12,TWD,income:利息,182340,2026-09-30
```

## 帳戶餘額與持倉 `type=position`

| 欄位 | 必填 | 說明 |
|---|---|---|
| `type` | 是 | 固定 `position` |
| `account` | 是 | 帳戶名稱；和既有帳戶同名（不分大小寫）時取代該帳戶的全部持倉 |
| `kind` | 是 | `bank`（銀行帳戶，只有現金）或 `investment`（投資帳戶） |
| `country` | 否 | TW、SG、US 這類兩碼代號；留空時沿用既有帳戶或依名稱推測 |
| `category` | 否 | 資產類別，例如 現金與外幣活存、台股、海外股票、基金與退休金、加密貨幣資產 |
| `currency` | 是 | 幣別 |
| `symbol` | 否 | 留空表示現金餘額；有值表示持倉代號（2330、AAPL、BTC…） |
| `quantity` | 是 | 現金是餘額，持倉是股數或顆數 |
| `price` | 否 | 只給持倉用。填了就固定為手動價格；沒填時沿用目前價格，新標的由下次「更新報價」查價 |

一個帳戶一列現金幣別或一個代號，不可重複。匯入前會列出被取代的原持倉，確認後仍需按「儲存變更」。既有持倉沿用原本的識別碼與加入日期，異動紀錄會接著記錄。

```csv
type,account,kind,country,category,currency,symbol,quantity,price
position,HSBC SG,bank,SG,現金與外幣活存,SGD,,12500.5,
position,HSBC SG,bank,SG,現金與外幣活存,USD,,3200,
position,嘉信,investment,US,海外股票,USD,VOO,12,
position,嘉信,investment,US,海外股票,USD,AAPL,30,
```

## 給 AI 工具的提示詞範本

把下面這段和帳單一起交給你的 AI 工具，再把它產生的 CSV 存成 `.csv` 檔匯入。請先確認你接受該工具處理帳單內容的條款；帳單上的姓名、地址、完整卡號或帳號不需要交出去時，可以先遮住。

```text
請讀取我提供的信用卡帳單（或銀行對帳單），輸出一份 Wealthline 可匯入的 CSV。只輸出 CSV 內容，不要加說明或 Markdown 程式碼框。

規則：
- UTF-8，逗號分隔，第一列是英文欄名，含逗號或引號的欄位用雙引號。
- 日期 YYYY-MM-DD；金額只用半形數字、小數點與負號，不加千分位或貨幣符號；幣別用三碼代號。
- 文字欄不要用 = + - @ 開頭；不要輸出完整卡號、帳號或身分證字號。
- 只列交易本身，不要列繳款、上期餘額、應繳總額、最低應繳、小計或總計。
- 讀不清楚的列不要猜，改在 CSV 之後另起一段告訴我哪幾筆需要我自己核對。

信用卡帳單用這些欄位：
type,date,description,amount,currency,card,category,statement_month,statement_total
- type 固定 card；amount 消費為正、退款為負；card 用「銀行 卡名」，例如「國泰 CUBE」。
- category 只能是 餐飲、交通、購物、旅遊住宿、娛樂、數位服務、生活繳費、醫療、政府規費、未分類，不確定就留空。
- statement_month 是帳單月份 YYYY-MM；statement_total 是本期新增消費減退款的合計，每一列填同一個值。

銀行對帳單用這些欄位：
type,account,bank,date,description,direction,amount,currency,classification,closing_balance,closing_date
- type 固定 bank；direction 支出是 debit、入帳是 credit；amount 一律是正數。
- account 用「銀行 帳戶名稱」，例如「台新 Richart」，不要用帳號。
- classification 可留空；確定時用 income:薪資、income:利息、excluded:信用卡繳款、excluded:自有帳戶轉帳 這類格式。
- 帳單有期末餘額時，在最後一列填 closing_balance 與 closing_date。
```

Gmail 裡的帳單：可以用 AI 工具自己的 Gmail 連接器找帳單信與附件，再套用上面的提示詞；也可以自己下載附件後直接用 Wealthline 的 PDF 匯入，PDF 只在瀏覽器解析。Wealthline 本身不讀取 Gmail。
