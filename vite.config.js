import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  logLevel: 'error',
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // jsdom, not the vitest default (node) -- src/lib/utils.js reads
    // `window.self`/`window.top` at module scope (isIframe), so importing
    // it from a test under the default node environment throws
    // "window is not defined" before any test even runs.
    environment: 'jsdom',
  },
})
