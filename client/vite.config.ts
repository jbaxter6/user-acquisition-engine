import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The public About and Privacy pages are static files served by the API
    // server. Without this, the dev server treats them as app routes and the
    // React app redirects them to the inbox.
    proxy: {
      '/about': 'http://127.0.0.1:4000',
      '/privacy': 'http://127.0.0.1:4000',
    },
  },
})
