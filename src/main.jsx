import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { initSentry } from '@/lib/sentry'
import { initAnalytics } from '@/lib/analytics'
import { registerServiceWorker } from '@/lib/pwa'
import '@/index.css'

initSentry()
initAnalytics()

// The worker is now built from src/sw.js by vite-plugin-pwa and does
// precaching as well as notifications, so registration moved into
// lib/pwa.js where update handling lives. Same /sw.js URL, same
// best-effort behaviour: showNotification() still falls back to the
// direct Notification constructor if no worker is available.
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
