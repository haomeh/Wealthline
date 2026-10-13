// Google sign-in via Google Identity Services (GIS) token model.
// The access token lives only in memory; nothing is stored on any server.

const GIS_SRC = 'https://accounts.google.com/gsi/client'

export const SCOPES = [
  'openid',
  'email',
  'profile',
  // Only files this app creates or the user opens with it; the files stay visible in the user's Drive.
  'https://www.googleapis.com/auth/drive.file',
].join(' ')

export interface AccessToken {
  value: string
  expiresAt: number
}

export interface UserProfile {
  sub: string
  email: string
  name: string
  picture?: string
}

let gisLoaded: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  gisLoaded ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      gisLoaded = null
      reject(new Error('無法載入 Google 登入元件'))
    }
    document.head.appendChild(script)
  })
  return gisLoaded
}

function clientId(): string {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!id) throw new Error('尚未設定 VITE_GOOGLE_CLIENT_ID，請參考 docs/google-cloud-setup.md')
  return id
}

// Starts loading GIS before the user clicks: Safari only lets the click open Google's popup if
// the popup opens in that click, not after the script finishes downloading.
export function preloadGis(): void {
  loadGis().catch(() => {
    // The click retries the load and shows the error.
  })
}

// prompt '' reuses an existing grant without showing the consent screen again;
// 'consent' forces the account chooser and consent screen.
// loginHint (an email) lets Google skip the account chooser for a returning user.
export function requestAccessToken(
  prompt: '' | 'consent' | 'select_account' = '',
  loginHint?: string,
): Promise<AccessToken> {
  // When GIS is already loaded, open the popup synchronously so it stays inside the user's click.
  if (window.google?.accounts?.oauth2) return openTokenPopup(prompt, loginHint)
  return loadGis().then(() => openTokenPopup(prompt, loginHint))
}

function openTokenPopup(prompt: '' | 'consent' | 'select_account', loginHint?: string): Promise<AccessToken> {
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPES,
      prompt,
      login_hint: loginHint,
      callback: (res) => {
        if (res.error || !res.access_token) {
          reject(new Error(res.error_description || res.error || '登入失敗'))
          return
        }
        if (!window.google!.accounts.oauth2.hasGrantedAllScopes(res, 'https://www.googleapis.com/auth/drive.file')) {
          reject(new Error('需要授權 Google Drive 存取權限才能儲存資料'))
          return
        }
        resolve({ value: res.access_token, expiresAt: Date.now() + Number(res.expires_in) * 1000 })
      },
      error_callback: (err) => reject(new Error(err.type === 'popup_failed_to_open'
        ? 'Google 登入視窗被瀏覽器擋下，請再按一次登入，或允許此網站開啟彈出式視窗。'
        : err.message || err.type)),
    })
    client.requestAccessToken()
  })
}

export async function revokeAccessToken(token: AccessToken): Promise<void> {
  await loadGis()
  await new Promise<void>((resolve) => window.google!.accounts.oauth2.revoke(token.value, () => resolve()))
}

export async function fetchProfile(token: AccessToken): Promise<UserProfile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token.value}` },
  })
  if (!res.ok) throw new Error(`讀取使用者資料失敗 (${res.status})`)
  const profile = await res.json() as UserProfile
  if (typeof profile.sub !== 'string' || !profile.sub || typeof profile.email !== 'string' || !profile.email) {
    throw new Error('Google 帳號資料不完整，請重新登入')
  }
  return { sub: profile.sub, email: profile.email, name: typeof profile.name === 'string' ? profile.name : profile.email,
    picture: typeof profile.picture === 'string' ? profile.picture : undefined }
}

// A login hint is not proof of identity: Google may return another account.
export async function renewAccessToken(profile: UserProfile): Promise<AccessToken> {
  const next = await requestAccessToken('', profile.email)
  const actual = await fetchProfile(next)
  if (!profile.sub || actual.sub !== profile.sub) {
    throw new Error('Google 帳號與目前資料不一致，請使用原帳號重新授權，或先登出再切換帳號。')
  }
  return next
}

// The profile (a login hint) lives in localStorage. The access token lives in sessionStorage
// so a reload keeps the user signed in, but it is gone when the tab or browser is closed and
// is never shared with other tabs. Neither is readable by other sites.
const SESSION_KEY = 'we-wealth.session'
const TOKEN_KEY = 'we-wealth.token'

export interface StoredSession {
  profile: UserProfile
  token?: AccessToken
}

function readProfile(value: unknown): UserProfile | null {
  const p = (value as { profile?: Record<string, unknown> } | null)?.profile
  if (typeof p?.email !== 'string' || !p.email) return null
  return {
    sub: typeof p.sub === 'string' ? p.sub : '',
    email: p.email,
    name: typeof p.name === 'string' ? p.name : p.email,
    picture: typeof p.picture === 'string' ? p.picture : undefined,
  }
}

export function loadSession(): StoredSession | null {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')
    // Remove a bearer token left in localStorage by an older version, even if the profile is malformed.
    localStorage.removeItem(SESSION_KEY)
    const profile = readProfile(raw)
    if (!profile) return null
    storeSession({ profile })
    return { profile, token: loadToken(profile) }
  } catch {
    clearSession()
    return null
  }
}

// Only a token that was stored for this very account and has not expired is returned.
function loadToken(profile: UserProfile): AccessToken | undefined {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null') as { token?: AccessToken; sub?: string } | null
    if (typeof t?.token?.value === 'string' && typeof t.token.expiresAt === 'number' && profile.sub && t.sub === profile.sub && isFresh(t.token)) {
      return { value: t.token.value, expiresAt: t.token.expiresAt }
    }
  } catch {
    // Unreadable: fall through and drop it.
  }
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing stored.
  }
  return undefined
}

export function storeSession(session: StoredSession): void {
  try {
    const { sub, email, name, picture } = session.profile
    localStorage.setItem(SESSION_KEY, JSON.stringify({ profile: { sub, email, name, picture } }))
  } catch {
    // Storage blocked (private mode): the user simply signs in again next time.
  }
  try {
    if (session.token) sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ sub: session.profile.sub, token: session.token }))
  } catch {
    // Storage blocked: the token only lives in memory.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // Nothing stored.
  }
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing stored.
  }
}

export const isFresh = (t: AccessToken) => t.expiresAt - Date.now() > 60_000
