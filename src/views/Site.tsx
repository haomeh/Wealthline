// Site-wide components shared by the signed-out pages and the app: links, the logo and the footer.

import { useState, type AnchorHTMLAttributes, type MouseEvent } from 'react'
import './landing.css'
import { AUTHOR, AUTHOR_URL, LICENSE_ZH_URL, OPERATOR, OPERATOR_URL, PAGES, PRIVACY_UPDATED, REPO_URL, SUPPORT_URL, navigate, type PageKey } from '../site'

// An in-app link: a real <a href> (so it can be opened in a new tab) that navigates without a reload.
// `replace` swaps the current history entry instead of adding one.
export function Link({ to, replace, onClick, ...rest }: { to: string; replace?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to, { replace })
  }
  return <a href={to} onClick={click} {...rest} />
}

// The mark (Claude Design "Wealthline Brand" 5a): a terracotta tile with a cream W-shaped line that
// ends in a gold dot. Large sizes add a faint area under the line; at 24px and below only the line
// stays, drawn thicker, so the mark stays clear. `animated` draws the line in a loop (the opening screen).
const W_LINE = 'M13 22 22.5 43 32 29 41.5 43 49.5 19.5'
const W_AREA = `${W_LINE}V50H13Z`
const CREAM = '#fff8ef'
const GOLD = '#f2c46d'

export function Logo({ size = 28, animated = false, className }: { size?: number; animated?: boolean; className?: string }) {
  const large = animated || size >= 64
  const tiny = !large && size <= 24
  return (
    <svg className={className ? `logo ${className}` : 'logo'} width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="18" style={{ fill: 'var(--accent)' }} />
      {large && <path className={animated ? 'wl-logo-area' : undefined} d={W_AREA} fill={CREAM} fillOpacity={animated ? 0.22 : 0.2} />}
      <path
        className={animated ? 'wl-logo-line' : undefined}
        d={W_LINE}
        pathLength={animated ? 100 : undefined}
        fill="none"
        stroke={CREAM}
        strokeWidth={tiny ? 7 : large ? 5.5 : 6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {!tiny &&
        (large ? (
          <circle className={animated ? 'wl-logo-dot' : undefined} cx="49.5" cy="19.5" r="4.5" fill={GOLD} stroke={CREAM} strokeWidth="2" />
        ) : (
          <circle cx="49.5" cy="19.5" r="5" fill={GOLD} />
        ))}
    </svg>
  )
}

export function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <Logo size={20} />
          <span>
            © 2026 <a href={AUTHOR_URL}>{AUTHOR}</a> · 由 <a href={OPERATOR_URL}>{OPERATOR}</a> 營運 · 開放原始碼，非商業授權
          </span>
        </div>
        <nav aria-label="網站資訊">
          {(Object.keys(PAGES) as PageKey[]).map((k) => (
            <Link key={k} to={PAGES[k].path}>
              {PAGES[k].title} {PAGES[k].en}
            </Link>
          ))}
          <a href={SUPPORT_URL} className="gh" target="_blank" rel="noopener noreferrer" aria-label="支持 Wealthline（Ko-fi，開啟新分頁）">
            <span aria-hidden="true">☕</span> 支持 Wealthline
          </a>
          <a href={LICENSE_ZH_URL}>授權條款</a>
          <a href={REPO_URL} className="gh">
            <GitHubMark size={14} /> 原始碼
          </a>
        </nav>
      </div>
    </footer>
  )
}

const PRIVACY_SEEN_KEY = 'wealthline.privacySeen'

// Tells a returning user that the privacy policy changed since they last used the app.
// A first visit just records the current version: the user agreed to it when signing in.
export function PrivacyNotice() {
  const [show, setShow] = useState(() => {
    try {
      const seen = localStorage.getItem(PRIVACY_SEEN_KEY)
      if (!seen) localStorage.setItem(PRIVACY_SEEN_KEY, PRIVACY_UPDATED)
      return !!seen && seen !== PRIVACY_UPDATED
    } catch {
      return false
    }
  })
  if (!show) return null
  const dismiss = () => {
    try {
      localStorage.setItem(PRIVACY_SEEN_KEY, PRIVACY_UPDATED)
    } catch {
      // Storage blocked: the notice simply shows again next time.
    }
    setShow(false)
  }
  return (
    <div className="banner privacy-notice" role="status">
      <span>
        隱私權政策已於 {PRIVACY_UPDATED} 更新。<Link to={PAGES.privacy.path}>查看變更內容</Link>
      </span>
      <button className="small" onClick={dismiss}>
        知道了
      </button>
    </div>
  )
}
