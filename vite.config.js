import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  logLevel: 'error',
  plugins: [
    react(),
    VitePWA({
      // injectManifest, NOT generateSW. generateSW would write its own
      // worker and silently drop the notificationclick handler that
      // Android notifications depend on -- see the header of src/sw.js.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',

      // The manifest is hand-maintained in public/manifest.json and
      // already complete (name, icons, standalone, theme colour), and
      // index.html already links it. Letting the plugin generate one too
      // would ship two manifests and two <link> tags.
      manifest: false,
      injectRegister: false,

      injectManifest: {
        // index.html, the hashed JS/CSS, the icons, and the offline page.
        // `json` is in the list for public/manifest.json specifically.
        // An earlier version listed `webmanifest` and the file is
        // manifest.json, so it was silently left out of the precache --
        // caught by inspecting the generated manifest rather than by the
        // build, which does not care.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,json}'],
        // The default is 2 MiB and the entry chunk alone is ~530 KiB raw,
        // with recharts near 370 KiB. Without this, the largest chunks are
        // dropped from the precache without failing the build, and a cold
        // offline start renders a blank page -- the failure this phase
        // exists to prevent.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },

      devOptions: {
        // Off by default, per the brief. `VITE_PWA_DEV=true npm run dev`
        // turns it on; otherwise a stale cached shell in dev is a very
        // confusing way to lose an afternoon.
        enabled: process.env.VITE_PWA_DEV === 'true',
        type: 'module',
      },
    }),
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
