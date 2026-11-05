import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import './finder.css'
import './v2.css'

// The web site (PC and narrow browser windows) keeps its own design. `vite --mode app` builds the Android app (APK)
// screens instead: a login-first app with a bottom tab bar (src/app). Both use the same server API.
const root = ReactDOM.createRoot(document.getElementById('root')!)
if (import.meta.env.MODE === 'app') {
  import('./app/index').then(({ default: MobileApp }) => root.render(<React.StrictMode><MobileApp /></React.StrictMode>))
} else {
  import('./App').then(({ default: App }) => root.render(<React.StrictMode><App /></React.StrictMode>))
}
