import { useState } from 'react'
import { CARD_CATEGORIES } from '../expenses'
import { REPO_URL } from '../site'
import type { CsvImportType } from '../csvImport'

// In-app guide for CSV imports: the steps, each type's columns with an example file, a prompt to give the
// user's own AI tool, and how to read a rejected file. docs/csv-import.md holds the same format in full.

type Field = [name: string, required: boolean, note: string]
interface Spec { tab: string; fields: Field[]; example: string; prompt: string }

const RULES = `規則：
- UTF-8，逗號分隔，第一列是英文欄名，含逗號或引號的欄位用雙引號。
- 日期 YYYY-MM-DD；金額只用半形數字、小數點與負號，不加千分位或貨幣符號；幣別用三碼代號。
- 文字欄不要用 = + - @ 開頭；不要輸出完整卡號、帳號或身分證字號。
- 讀不清楚的列不要猜，改在 CSV 之後另起一段告訴我哪幾筆需要我自己核對。`

const SPECS: Record<CsvImportType, Spec> = {
  card: {
    tab: '信用卡消費',
    fields: [
      ['type', true, '固定 card'],
      ['date', true, '消費日 YYYY-MM-DD；沒有消費日時用入帳日'],
      ['description', true, '商家或說明'],
      ['amount', true, '消費為正數，退款為負數'],
      ['currency', true, '入帳幣別，如 TWD'],
      ['card', true, '自訂卡片名稱，如「國泰 CUBE」；同一張卡沿用同名，不填卡號'],
      ['category', false, `${CARD_CATEGORIES.join('、')}；留空自動判斷`],
      ['statement_month', false, '帳單月份 YYYY-MM'],
      ['statement_total', false, '本期新增消費減退款的合計，用來核對明細有沒有漏'],
    ],
    example: `type,date,description,amount,currency,card,category,statement_month,statement_total
card,2026-09-03,全聯福利中心,1280,TWD,國泰 CUBE,購物,2026-09,1220
card,2026-09-10,NETFLIX.COM,390,TWD,國泰 CUBE,數位服務,2026-09,1220
card,2026-09-12,誠品 退款,-450,TWD,國泰 CUBE,,2026-09,1220
`,
    prompt: `請讀取我提供的信用卡帳單，輸出一份 Wealthline 可匯入的 CSV。只輸出 CSV 內容，不要加說明或 Markdown 程式碼框。

${RULES}

欄位：
type,date,description,amount,currency,card,category,statement_month,statement_total
- type 固定 card；amount 消費為正、退款為負；card 用「銀行 卡名」，例如「國泰 CUBE」。
- 只列交易本身，不要列繳款、上期餘額、應繳總額、最低應繳、小計或總計。
- category 只能是 ${CARD_CATEGORIES.join('、')}，不確定就留空。
- statement_month 是帳單月份 YYYY-MM；statement_total 是本期新增消費減退款的合計，每一列填同一個值。`,
  },
  bank: {
    tab: '銀行流水',
    fields: [
      ['type', true, '固定 bank'],
      ['account', true, '流水帳戶標籤，如「台新 Richart」；同名時記入既有流水帳戶'],
      ['bank', false, '銀行名稱；期末餘額要補入資產歷史時填，HSBC 與星展加國家，如 HSBC SG'],
      ['date', true, '入帳日 YYYY-MM-DD'],
      ['description', true, '摘要；已辨識的帳號會遮蔽'],
      ['direction', true, 'debit（支出）或 credit（入帳）'],
      ['amount', true, '正數'],
      ['currency', true, '幣別，如 TWD'],
      ['classification', false, 'income:薪資、expense:餐飲、excluded:信用卡繳款 這類格式；留空依規則分類'],
      ['closing_balance', false, '期末餘額，填在任一列'],
      ['closing_date', false, '期末餘額日期；有 closing_balance 時必填'],
    ],
    example: `type,account,bank,date,description,direction,amount,currency,classification,closing_balance,closing_date
bank,台新 Richart,台新,2026-09-05,薪資轉入,credit,65000,TWD,income:薪資,,
bank,台新 Richart,台新,2026-09-10,信用卡費 國泰,debit,15320,TWD,excluded:信用卡繳款,,
bank,台新 Richart,台新,2026-09-30,利息,credit,12,TWD,income:利息,182340,2026-09-30
`,
    prompt: `請讀取我提供的銀行對帳單，輸出一份 Wealthline 可匯入的 CSV。只輸出 CSV 內容，不要加說明或 Markdown 程式碼框。

${RULES}

欄位：
type,account,bank,date,description,direction,amount,currency,classification,closing_balance,closing_date
- type 固定 bank；direction 支出是 debit、入帳是 credit；amount 一律是正數。
- account 用「銀行 帳戶名稱」，例如「台新 Richart」，不要用帳號；bank 填銀行名稱。
- 只列交易本身，不要列期初餘額、小計或總計。
- classification 可留空；確定時用 income:薪資、income:利息、excluded:信用卡繳款、excluded:自有帳戶轉帳 這類格式。
- 帳單有期末餘額時，在最後一列填 closing_balance 與 closing_date。`,
  },
  position: {
    tab: '帳戶餘額與持倉',
    fields: [
      ['type', true, '固定 position'],
      ['account', true, '帳戶名稱；同名帳戶的全部持倉會被取代'],
      ['kind', true, 'bank（銀行帳戶）或 investment（投資帳戶）'],
      ['country', false, 'TW、SG、US 這類兩碼代號'],
      ['category', false, '如 現金與外幣活存、台股、海外股票'],
      ['currency', true, '幣別，如 SGD、USD'],
      ['symbol', false, '留空是現金餘額；填代號是持倉，如 2330、VOO'],
      ['quantity', true, '現金是餘額，持倉是股數'],
      ['price', false, '持倉的固定手動價格；留空自動查價'],
    ],
    example: `type,account,kind,country,category,currency,symbol,quantity,price
position,HSBC SG,bank,SG,現金與外幣活存,SGD,,12500.5,
position,嘉信,investment,US,海外股票,USD,VOO,12,
position,嘉信,investment,US,海外股票,USD,AAPL,30,
`,
    prompt: `請讀取我提供的銀行或券商對帳單（或截圖），整理出各帳戶目前的現金餘額與持股，輸出一份 Wealthline 可匯入的 CSV。只輸出 CSV 內容，不要加說明或 Markdown 程式碼框。

${RULES}

欄位：
type,account,kind,country,category,currency,symbol,quantity,price
- type 固定 position；kind 銀行帳戶是 bank、證券或基金帳戶是 investment。
- 現金餘額一個幣別一列，symbol 留空，quantity 填餘額。
- 持股一個代號一列，symbol 填交易代號（台股填數字代號），quantity 填股數；price 留空。
- 同一個帳戶要包含全部現金與持股，因為匯入會取代該帳戶原本的全部持倉。`,
  },
}

function download(kind: CsvImportType) {
  const url = URL.createObjectURL(new Blob(['﻿' + SPECS[kind].example], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `wealthline-${kind}-example.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function CsvGuide({ kinds, where }: { kinds: CsvImportType[]; where: string }) {
  const [chosen, setChosen] = useState<CsvImportType>(kinds[0])
  const [copied, setCopied] = useState('')
  const kind = kinds.includes(chosen) ? chosen : kinds[0]
  const spec = SPECS[kind]
  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
    } catch {
      setCopied(`${label}:failed`)
    }
  }
  const copyLabel = (label: string, idle: string) => copied === label ? '已複製' : copied === `${label}:failed` ? '無法複製，請手動選取' : idle
  return <details className="csv-guide">
    <summary><span className="csv-guide-title">用 CSV 匯入：教學與 AI 提示詞</span><span className="muted small">其他銀行、Email 帳單或自己整理的資料</span></summary>
    <div className="csv-guide-body">
      <ol className="csv-guide-steps">
        <li><strong>準備資料</strong><span>帳單 PDF、Email 裡的帳單，或網路銀行匯出的明細。</span></li>
        <li><strong>整理成 CSV</strong><span>自己照下方欄位整理，或複製提示詞，連同帳單交給自己的 AI 工具（Gemini、Claude、ChatGPT 等）。</span></li>
        <li><strong>存成 .csv</strong><span>UTF-8 編碼；Excel 請選「CSV UTF-8（逗號分隔）」。</span></li>
        <li><strong>上傳並核對</strong><span>{where}，核對預覽後確認匯入，最後按「儲存變更」。</span></li>
      </ol>
      <p className="csv-guide-privacy">CSV 只在此瀏覽器讀取，不上傳、不保存原始檔。交給 AI 工具的帳單會傳送到該工具的供應商、依其條款處理，不經過 Wealthline；不需要的姓名、地址、完整卡號或帳號可以先遮住。</p>
      {kinds.length > 1 && <div className="segmented csv-guide-tabs" role="group" aria-label="CSV 類型">{kinds.map((k) =>
        <button key={k} type="button" aria-pressed={k === kind} className={k === kind ? 'on' : ''} onClick={() => { setChosen(k); setCopied('') }}>{SPECS[k].tab}</button>)}</div>}
      <section className="csv-guide-kind" aria-label={`${spec.tab} CSV`}>
        <h4>{spec.tab}的欄位</h4>
        <ul className="csv-guide-fields">{spec.fields.map(([name, required, note]) => <li key={name}>
          <code>{name}</code><span className={required ? 'tag csv-required' : 'tag'}>{required ? '必填' : '選填'}</span><span>{note}</span>
        </li>)}</ul>
        <div className="csv-guide-block">
          <div className="csv-guide-block-head"><strong>範例</strong><div className="row">
            <button type="button" onClick={() => void copy('example', spec.example)}>{copyLabel('example', '複製範例')}</button>
            <button type="button" onClick={() => download(kind)}>下載範例檔</button>
          </div></div>
          <pre className="csv-guide-example" aria-label={`${spec.tab}範例`}>{spec.example}</pre>
        </div>
        <div className="csv-guide-block">
          <div className="csv-guide-block-head"><strong>給 AI 工具的提示詞</strong>
            <button type="button" className="primary" onClick={() => void copy('prompt', spec.prompt)}>{copyLabel('prompt', '複製提示詞')}</button></div>
          <pre className="csv-guide-prompt" aria-label={`${spec.tab}提示詞`}>{spec.prompt}</pre>
          <p className="muted small">把提示詞和帳單一起交給 AI 工具，再把它回覆的內容存成 .csv 檔。Email 裡的帳單可以用 AI 工具自己的 Gmail 連接器找，Wealthline 不讀取 Gmail。</p>
        </div>
      </section>
      <h4>匯入失敗或需要核對時</h4>
      <ul className="csv-guide-errors">
        <li>只要有一列不合格，整份檔案都不匯入，畫面會列出「第 N 列：原因」。列號和試算表左側的列號相同，第 1 列是欄名。</li>
        <li>常見原因：日期不是 YYYY-MM-DD、金額有千分位或貨幣符號、檔案不是 UTF-8、同一檔混用不同 type、文字以 = + - @ 開頭。</li>
        <li>修正後重新選檔即可；也可以把錯誤訊息貼回 AI 工具請它修正。</li>
        <li>預覽中標示「核對」的交易，表示帳單總額和明細合計不符，請對照原帳單。</li>
      </ul>
      <p className="muted small">完整格式見 <a href={`${REPO_URL}/blob/main/docs/csv-import.md`} target="_blank" rel="noreferrer">CSV 匯入格式</a>。</p>
    </div>
  </details>
}
