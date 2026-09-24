import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The public About and Privacy pages are static files in /public. In
// production the API server serves them at /about and /privacy; this does
// the same in dev by rewriting those URLs to the static files, so they work
// even when the API server is down or restarting (and aren't treated as app
// routes, which the React app would redirect to the inbox).
function publicPages(): Plugin {
  const pages: Record<string, string> = {
    '/about': '/about.html',
    '/privacy': '/privacy.html',
  }
  return {
    name: 'public-pages',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const request = req as { url?: string }
        const [pathname, query] = (request.url ?? '').split('?')
        const target = pages[pathname]
        if (target) request.url = query ? `${target}?${query}` : target
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), publicPages()],
})
