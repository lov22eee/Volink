// Android app (Capacitor) wiring. The bundled pages run at https://localhost, so:
// - every call goes to the server address given at build time (VITE_API_BASE) and the app keeps its own refresh token;
// - Kakao / Google login opens in the phone browser and comes back through volink://{route} (see SocialController).
// In a normal browser (npm run dev:app) nothing here runs unless VITE_FORCE_NATIVE=1 (a local check of the token mode).
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { setServer } from '../api'
import { setSocialOpener } from '../social'
import { goBack } from './ui'

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
  // Android back key: an open sheet closes first (like Escape), a sub-screen goes back, the home screen puts the app
  // in the background instead of closing it.
  void App.addListener('backButton', () => {
    if (document.querySelector('.m-sheet-wrap')) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return }
    const page = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'home'
    if (page === 'home' || page === 'login') { void App.minimizeApp(); return }
    goBack('#/home')
  })
}

/**
 * The phone's notification permission (Android 13+ asks; older phones allow by default). Push delivery itself needs
 * Firebase, which is not connected yet; this only asks so the permission is ready. In a browser: the web prompt.
 */
export async function askNotifications(): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) return (await PushNotifications.requestPermissions()).receive === 'granted'
    if ('Notification' in window) return (await Notification.requestPermission()) === 'granted'
  } catch { /* not supported */ }
  return false
}
