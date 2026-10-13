// Renders the public pages to static HTML at build time (see scripts/prerender.mjs), so the
// home page and notice pages can be read without JavaScript or signing in, as Google's
// OAuth brand verification requires. In the browser, main.tsx replaces this markup.

import { renderToStaticMarkup } from 'react-dom/server'
import { PAGES, SITE_URL, type PageKey } from './site'
import { Landing } from './views/Landing'
import { LegalPage } from './views/Legal'

const noop = () => {}

export type Route = { file: string; path: string; url: string; title: string; description: string; html: () => string }

export const routes: Route[] = [
  {
    file: 'index.html',
    path: '/',
    url: `${SITE_URL}/`,
    title: 'Wealthline｜個人資產統計 Personal Asset Tracker',
    description: '開源個人資產統計工具：財務資料在瀏覽器處理，儲存到你的 Google Drive 或此瀏覽器，可下載備份。Wealthline processes financial records in your browser and saves them to your Drive or this browser.',
    html: () => renderToStaticMarkup(<Landing returning={null} hasLocal={false} busy={false} message={null} onSignIn={noop} onResume={noop} onLocal={noop} onUpload={noop} />),
  },
  ...(Object.keys(PAGES) as PageKey[]).map((k) => ({
    file: `${k}.html`,
    path: PAGES[k].path,
    url: `${SITE_URL}${PAGES[k].path}`,
    title: `${PAGES[k].title}｜Wealthline ${PAGES[k].en}`,
    description: PAGES[k].description,
    html: () => renderToStaticMarkup(<LegalPage page={k} signedIn={false} />),
  })),
]
