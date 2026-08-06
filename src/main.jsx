import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { initSentry } from '@/lib/sentry'
import { initAnalytics } from '@/lib/analytics'
import '@/index.css'

initSentry()
initAnalytics()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
