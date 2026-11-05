import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './finder.css'
import './v2.css'

// The web site (PC and narrow browser windows) keeps its own design. `vite --mode app` builds the Android app (APK)
// screens instead: a login-first app with a bottom tab bar (src/app). Both use the same server API.
// MODE is fixed at build time, so the web build drops the app branch entirely (the offline one-file export needs that).
const root = ReactDOM.createRoot(document.getElementById('root')!)
if (import.meta.env.MODE === 'app') {
  import('./app/index').then(({ default: MobileApp }) => root.render(<React.StrictMode><MobileApp /></React.StrictMode>))
} else {
  root.render(<React.StrictMode><App /></React.StrictMode>)
}
