import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './finder.css'
import './v2.css'

// The web site (PC and narrow browser windows) keeps its own design. `vite --mode app` builds the Android app (APK)
// screens instead: a login-first app with a bottom tab bar (src/app). Both use the same server API.
// MODE is fixed at build time, so the web build drops the app branch entirely (the offline one-file export needs that).
// The QR link https://site/c/{id}?t=… opened in a browser (no Volink app): the hash route of the check-in page.
const qrLink = /^\/c\/(\d+)\/?$/.exec(window.location.pathname)
if (qrLink) window.history.replaceState(null, '', '/#/checkin/' + qrLink[1] + window.location.search)
const root = ReactDOM.createRoot(document.getElementById('root')!)
if (import.meta.env.MODE === 'app') {
  import('./app/index').then(({ default: MobileApp }) => root.render(<React.StrictMode><MobileApp /></React.StrictMode>))
} else if (window.__VOLINK_UI_DEMO__) {
  // The offline one-file export (no server) keeps the old web screens with their sample data.
  root.render(<React.StrictMode><App /></React.StrictMode>)
} else {
  // PC (2026-11-11): public pages, 기관센터 and the admin console; personal members use the app.
  import('./pc/index').then(({ default: PcApp }) => root.render(<React.StrictMode><PcApp /></React.StrictMode>))
}
