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
  // TEMP-DIAGNOSTIC: bakes the Vercel build's commit SHA into the client
  // bundle (as a normal import.meta.env.VITE_* var, so no eslint-globals
  // friction and no separate type declaration needed) so the auth-failure
  // diagnostic screen can show exactly which deploy is running. Vercel sets
  // VERCEL_GIT_COMMIT_SHA automatically as a build-time env var; it isn't
  // VITE_-prefixed so Vite wouldn't expose it on its own. Remove this
  // `define` block when removing the rest of the TEMP-DIAGNOSTIC code.
  define: {
    'import.meta.env.VITE_COMMIT_SHA': JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || 'local-dev'),
  },
  test: {
    // jsdom, not the vitest default (node) -- src/lib/utils.js reads
    // `window.self`/`window.top` at module scope (isIframe), so importing
    // it from a test under the default node environment throws
    // "window is not defined" before any test even runs.
    environment: 'jsdom',
  },
})
