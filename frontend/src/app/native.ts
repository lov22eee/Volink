// Android app (Capacitor) wiring. The bundled pages run at https://localhost, so:
// - every call goes to the server address given at build time (VITE_API_BASE) and the app keeps its own refresh token;
// - Kakao / Google login opens in the phone browser and comes back through volink://{route} (see SocialController).
// In a normal browser (npm run dev:app) nothing here runs unless VITE_FORCE_NATIVE=1 (a local check of the token mode).
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { setServer } from '../api'
import { setSocialOpener } from '../social'

const SERVER = String(import.meta.env.VITE_API_BASE ?? '').trim()

/** volink://oauth?code=… → #/oauth?code=… (only the routes the server sends back). */
export function appRoute(url: string) {
  const match = /^volink:\/\/(oauth|social-signup|login)\/?(\?[^#]*)?$/.exec(url)
  return match ? '#/' + match[1] + (match[2] ?? '') : null
}

export function setupNative() {
  const native = Capacitor.isNativePlatform()
  if (!SERVER || !(native || import.meta.env.VITE_FORCE_NATIVE === '1')) return
  setServer(SERVER)
  if (!native) return
  setSocialOpener(path => { void Browser.open({ url: SERVER + path + '?app=1' }) })
  void App.addListener('appUrlOpen', ({ url }) => {
    const route = appRoute(url)
    if (!route) return
    void Browser.close().catch(() => {})
    window.location.hash = route
  })
}
