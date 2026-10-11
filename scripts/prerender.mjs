// Writes static HTML for the public pages into dist/ after `vite build`:
// dist/index.html, dist/privacy.html, dist/terms.html, dist/disclaimer.html, plus dist/sitemap.xml
// listing exactly those pages. Cloudflare serves /privacy from privacy.html; other paths still fall
// back to index.html, and worker/index.ts marks those fallbacks noindex.

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const { routes } = await import(pathToFileURL('dist-ssr/prerender.js').href)
const shell = readFileSync('dist/index.html', 'utf8')
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const today = new Date().toISOString().slice(0, 10)

// Structured data for the home page, so search engines and AI assistants can tell what the app is.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Wealthline',
  url: routes[0].url,
  description: routes[0].description,
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web',
  inLanguage: 'zh-Hant',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'TWD' },
  image: new URL('/icon-512.png', routes[0].url).href,
  sameAs: ['https://github.com/haomeh/Wealthline'],
}

for (const r of routes) {
  const { url } = r
  const fill = (html, pattern, value) => {
    if (!pattern.test(html)) throw new Error(`prerender: ${pattern} not found in the shell for ${r.file}`)
    return html.replace(pattern, value)
  }
  let html = shell
  html = fill(html, /<title>[^<]*<\/title>/, `<title>${escape(r.title)}</title>`)
  html = fill(html, /<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escape(r.description)}" />`)
  html = fill(html, /<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escape(r.title)}" />`)
  html = fill(html, /<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escape(r.description)}" />`)
  html = fill(html, /<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`)
  html = fill(html, /<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`)
  if (r.path === '/') {
    const ld = JSON.stringify(jsonLd).replace(/</g, '\\u003c')
    html = fill(html, /<\/head>/, `  <script type="application/ld+json">${ld}</script>\n  </head>`)
  }
  html = fill(html, /<div id="root"><\/div>/, `<div id="root">${r.html()}</div>`)
  writeFileSync(`dist/${r.file}`, html)
  console.log(`prerendered dist/${r.file}`)
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map((r) => `  <url><loc>${r.url}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`
writeFileSync('dist/sitemap.xml', sitemap)
console.log('wrote dist/sitemap.xml')
