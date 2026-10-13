// The screen between signing in and the app: the logo draws itself while the account
// is checked and the data file is read from Google Drive.

import type { UserProfile } from '../google/auth'
import './landing.css'
import { Logo } from './Site'

export type OpeningStep = 'auth' | 'drive'

const STEPS: { key: OpeningStep; text: string }[] = [
  { key: 'auth', text: '確認 Google 帳號' },
  { key: 'drive', text: '從 Google Drive 讀取資料' },
]

interface Props {
  step: OpeningStep
  profile?: UserProfile
}

export function Opening({ step, profile }: Props) {
  const current = STEPS.findIndex((s) => s.key === step)
  return (
    <div className="opening wl-opening" role="status" aria-live="polite">
      <div className="wl-opening-card">
        <Logo size={84} animated className="wl-opening-logo" />
        <p className="wl-opening-title">{profile ? `歡迎回來，${profile.name || profile.email}` : 'Wealthline'}</p>
        <ol className="wl-opening-steps">
          {STEPS.map((s, i) => (
            <li key={s.key} className={i < current ? 'done' : i === current ? 'active' : ''}>
              <span className="wl-opening-mark" aria-hidden>
                {i < current ? '✓' : null}
              </span>
              {s.text}
            </li>
          ))}
        </ol>
        <div className="wl-opening-bar" aria-hidden>
          <span />
        </div>
      </div>
    </div>
  )
}
