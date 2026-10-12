import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { handleApiRequest, isApiPath } from './server/yahoo.ts'

// Serves /api/quote and /api/history during `npm run dev` and `npm run preview`, mirroring the
// Cloudflare Worker in worker/index.ts.
function quoteApi(): Plugin {
  const middleware = async (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!isApiPath(url.pathname)) return next()
    const r = await handleApiRequest(url)
    res.statusCode = r.status
    r.headers.forEach((v, k) => res.setHeader(k, v))
    res.end(await r.text())
  }
  return {
    name: 'quote-api',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), quoteApi()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules\/(?:react|react-dom|scheduler)\// },
            // Keep Vite's shared preload helper out of the lazy PDF chunk.
            { name: 'pdf', test: /node_modules\/pdfjs-dist\/legacy\/build\/pdf\.mjs$/, includeDependenciesRecursively: false },
          ],
        },
      },
    },
  },
})
