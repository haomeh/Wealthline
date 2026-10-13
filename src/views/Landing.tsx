// The signed-out home page: what the app does, where the data lives, and sign-in.
// Layout follows Claude Design "Wealthline Landing" (7a desktop, 7b phone, 7c sign-in states).

import type { ReactNode } from 'react'
import type { UserProfile } from '../google/auth'
import { DATA_FILE_NAME, FOLDER_NAME, HISTORY_FOLDER_NAME, LEDGER_FOLDER_NAME } from '../google/drive'
import { LICENSE_ZH_URL, PAGES, REPO_URL, SUPPORT_URL } from '../site'
import './landing.css'
import { UploadButton } from './LocalData'
import { GitHubMark, Link, Logo, SiteFooter } from './Site'

interface Props {
  returning: UserProfile | null
  // Whether this browser already holds local-mode data.
  hasLocal: boolean
  busy: boolean
  message: { kind: 'busy' | 'error'; text: string } | null
  onSignIn: () => void
  onResume: () => void
  onLocal: () => void
  onUpload: (file: File) => void
}

export function Landing({ returning, hasLocal, busy, message, onSignIn, onResume, onLocal, onUpload }: Props) {
  return (
    <div className="landing">
      <header className="landing-top">
        <div className="brand">
          <Logo size={32} />
          <span className="wordmark">Wealthline</span>
        </div>
        <nav className="landing-nav" aria-label="首頁段落">
          <a href="#features">功能</a>
          <a href="#data">資料在哪裡</a>
          <a href="#open-source">開放原始碼</a>
        </nav>
        <a className="gh-link" href={REPO_URL}>
          <GitHubMark /> 原始碼
        </a>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="pill">個人資產統計 · 免費、開放原始碼</span>
            <h1 className="hero-title">
              你的資產，
              <br />
              存在你自己的
              <br />
              <span className="accent-text">Drive 或瀏覽器</span>
            </h1>
            <p className="lead">
              用帳戶整理銀行存款、股票、基金與加密貨幣，自動換算報價與匯率，一眼看清資產配置與每日走勢。財務資料由瀏覽器處理，依使用模式儲存到你自己的 Google Drive 或此瀏覽器；下載備份會另產生一份由你保管的檔案。
            </p>
            <div className="signin-box">
              {returning ? (
                <>
                  <button className="google returning" onClick={onResume} disabled={busy}>
                    <span className="avatar" aria-hidden>
                      {initial(returning)}
                    </span>
                    <span className="returning-text">
                      <span>以 {returning.email} 繼續</span>
                      <span className="returning-sub">上次使用的帳號</span>
                    </span>
                  </button>
                  <button className="ghost other-account" onClick={onSignIn} disabled={busy}>
                    使用其他帳號
                  </button>
                </>
              ) : (
                <button className="google" onClick={onSignIn} disabled={busy}>
                  <GoogleMark />
                  使用 Google 登入
                </button>
              )}
              <div className="or-divider" role="separator">
                <span>或</span>
              </div>
              <button className={hasLocal ? 'local-start has-local' : 'ghost local-start'} onClick={onLocal} disabled={busy}>
                {hasLocal ? '繼續使用此瀏覽器中的資料' : '不登入，直接在瀏覽器使用'}
              </button>
              {message && <p className={message.kind === 'error' ? 'error small signin-message' : 'muted small signin-message'}>{message.text}</p>}
              <p className="muted small">
                不登入時，財務資料保存在這個瀏覽器；查價代號仍會送至行情服務。可以隨時下載成資料檔，之後再
                <UploadButton className="link inline" onFile={onUpload} disabled={busy}>
                  上傳資料檔
                </UploadButton>
                繼續使用。使用本服務即表示你同意<Link to={PAGES.terms.path}>使用條款</Link>與<Link to={PAGES.privacy.path}>隱私權政策</Link>。
              </p>
            </div>
          </div>
          <Preview />
        </section>

        <section className="landing-section about" aria-labelledby="about-title">
          <h2 id="about-title">Wealthline 是做什麼的</h2>
          <div className="about-grid">
            <div>
              <p>
                Wealthline 是免費、開放原始碼的<strong>個人資產統計網頁工具</strong>。你可以建立自己的銀行與投資帳戶，記錄各幣別存款、股票、基金與加密貨幣持倉；Wealthline
                會自動查詢價格與匯率，換算成新臺幣，呈現總資產、資產配置、幣別曝險與每日走勢。也能記錄負債與還款，回看每日淨資產快照。不想登入也可以直接在瀏覽器使用，財務資料保存在此瀏覽器。
              </p>
              <p>
                使用 Google 登入，是為了把你的資料存進<strong>你自己的 Google Drive</strong>：本服務要求 <code>openid</code>、<code>email</code>、<code>profile</code> 來確認與顯示登入身分，並使用 <code>drive.file</code> 建立和更新自己的資料夾與資料檔，不要求讀取整個雲端硬碟。詳見
                <Link to={PAGES.privacy.path}>隱私權政策</Link>。
              </p>
            </div>
            <div lang="en" className="about-en">
              <p>
                <strong>Wealthline</strong> is a free, open-source web app for tracking your personal assets. Create your bank and brokerage accounts, record cash
                balances, stocks, funds and crypto holdings, and Wealthline fetches prices and exchange rates to show your total net worth, asset allocation, currency
                exposure and daily trend. Financial records are processed in your browser and saved in your own Google Drive or this browser, depending on mode. Downloaded backups are separate copies that you manage. Track debts, repayment estimates and daily net-worth snapshots too. You can also use it without signing in, keeping the data only in this browser.
              </p>
              <p>
                Google sign-in is used to save your data in <strong>your own Google Drive</strong>. Wealthline requests <code>openid</code>, <code>email</code> and <code>profile</code> to identify the signed-in account, plus <code>drive.file</code> to create and update its own folders and data files. That scope can also cover files you open with or share with an app, but Wealthline currently has no such file-selection flow. It does not request access to your entire Drive. See the{' '}
                <Link to={PAGES.privacy.path}>privacy policy</Link>.
              </p>
            </div>
          </div>
        </section>

        <section className="landing-section" id="features" aria-labelledby="features-title">
          <h2 id="features-title">需要的功能都在這裡</h2>
          <ol className="feature-grid">
            <Feature n="01" title="以帳戶為中心">
              先建立銀行或投資帳戶，再填各幣別餘額與持有標的，和實際資產結構一致。
            </Feature>
            <Feature n="02" title="自動報價與匯率">
              持倉只要輸入代號和數量，價格與幣別自動查詢，外幣換算成新臺幣。
            </Feature>
            <Feature n="03" title="配置一目了然">
              依類別、帳戶、幣別、國家拆解總資產，看清集中度與幣別曝險。
            </Feature>
            <Feature n="04" title="歷史與變動紀錄">
              每天首次開啟時保存快照；每次修改留下前後數值，儲存前提醒異常變動。
            </Feature>
          </ol>
        </section>

        <section className="landing-section split" id="data" aria-labelledby="data-title">
          <div>
            <h2 id="data-title">資料只放在你看得到的地方</h2>
            <ul className="checks">
              <li>Google Drive 僅要求 drive.file 權限；目前只建立及讀寫 Wealthline 的資料檔，不要求讀取整個雲端硬碟。</li>
              <li>財務資料是普通的 JSON：Google 模式分存主資料檔與子資料夾，本機模式存在此瀏覽器；下載備份會另產生一份由你保管的檔案。</li>
              <li>不想登入也可以：財務資料存在這個瀏覽器的儲存空間，下載成檔案後可以再上傳還原。</li>
              <li>不使用分析工具、廣告或追蹤 Cookie。</li>
              <li>隨時可以在 Google 帳戶設定中撤銷授權。</li>
            </ul>
            <Link to={PAGES.privacy.path} className="more">
              閱讀隱私權政策 →
            </Link>
          </div>
          <div className="drive-path" aria-label="資料檔位置">
            <div className="drive-row">我的雲端硬碟</div>
            <div className="drive-row indent">
              <span className="folder" aria-hidden>
                ▸
              </span>
              {FOLDER_NAME}
            </div>
            <div className="drive-row indent-2 file">
              <span className="file-icon" aria-hidden>
                {'{ }'}
              </span>
              {DATA_FILE_NAME}
            </div>
            {[LEDGER_FOLDER_NAME, HISTORY_FOLDER_NAME].map((name) => (
              <div className="drive-row indent-2" key={name}>
                <span className="folder" aria-hidden>
                  ▸
                </span>
                {name}
              </div>
            ))}
          </div>
        </section>

        <div className="landing-section landing-cards" id="open-source">
          <section className="landing-card" aria-labelledby="source-title">
            <h2 id="source-title">程式碼完全公開，歡迎審查</h2>
            <p>
              處理你財務資料的程式，應該讓任何人都能檢查。完整原始碼放在 GitHub，個人學習、研究與教育用途可以自由使用與修改；商業用途需取得作者書面授權。Wealthline 由 GitHub 組織 haomeh 營運。
            </p>
            <div className="row">
              <a className="button" href={REPO_URL}>
                <GitHubMark /> 在 GitHub 查看
              </a>
              <a className="button ghost" href={LICENSE_ZH_URL}>
                授權說明
              </a>
            </div>
          </section>
          <section className="landing-card deep" aria-labelledby="support-title">
            <h2 id="support-title">讓好用的工具持續成長</h2>
            <p>如果 Wealthline 對你有幫助，歡迎請我喝杯咖啡，支持持續維護與伺服器費用。贊助完全自願，所有功能仍可免費使用。</p>
            <a className="button support" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" aria-label="支持 Wealthline（Ko-fi，開啟新分頁）">
              <span aria-hidden="true">☕</span> 支持 Wealthline
            </a>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}

function initial(p: UserProfile): string {
  return (p.name || p.email).trim().charAt(0).toUpperCase() || 'W'
}

function Feature({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <li className="feature">
      <span className="feature-num" aria-hidden>
        {n}
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </li>
  )
}

// A static sketch of the overview tiles; the numbers are made up.
const SPARK = 'M0 201.5 L83 186 L167 193.8 L250 164 L333 145.9 L417 154.9 L500 123.9 L583 100.6 L667 112.2 L750 79.9 L833 60.5 L917 38.5 L1000 32.5'

function Preview() {
  return (
    <figure className="preview" aria-label="總覽畫面示意">
      <div className="preview-tiles">
        <div className="preview-tile tile-total">
          <div className="preview-head">
            <span>總資產（新臺幣）</span>
            <span className="tag good">↑ 2.4% 本月</span>
          </div>
          <span className="preview-total">NT$ 3,284,500</span>
          <svg className="preview-spark" viewBox="0 0 1000 240" preserveAspectRatio="none" aria-hidden>
            <path d={`${SPARK} L1000 240 L0 240 Z`} className="spark-area" />
            <path d={SPARK} className="spark-line" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <div className="preview-tile tile-net">
          <span>淨資產</span>
          <span className="preview-net">2,914,300</span>
        </div>
        <div className="preview-tile tile-mix">
          <span className="preview-donut" aria-hidden />
          <span className="preview-mix-legend">
            <span>台股 34%</span>
            <span>海外 26%</span>
            <span>現金 22%</span>
          </span>
        </div>
      </div>
      <figcaption>畫面示意，數字為虛構</figcaption>
    </figure>
  )
}

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
