import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { initSentry } from '@/lib/sentry'
import { initAnalytics } from '@/lib/analytics'
import '@/index.css'

initSentry()
initAnalytics()

// Registers public/sw.js -- src/lib/showNotification.js prefers
// navigator.serviceWorker.ready so browser notifications work on Android
// Chrome, which requires a service worker and throws on a direct
// `new Notification(...)` call. Best-effort: showNotification() already
// falls back to the direct constructor if no service worker is available.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
