// Android app (Capacitor) wiring. The bundled pages run at https://localhost, so:
// - every call goes to the server address given at build time (VITE_API_BASE) and the app keeps its own refresh token;
// - Kakao / Google login opens in the phone browser and comes back through volink://{route} (see SocialController).
// In a normal browser (npm run dev:app) nothing here runs unless VITE_FORCE_NATIVE=1 (a local check of the token mode).
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { api, setServer } from '../api'
import { setSocialOpener } from '../social'
import { goBack } from './ui'

const SERVER = String(import.meta.env.VITE_API_BASE ?? '').trim()

/** volink://oauth?code=… → #/oauth?code=… (only the routes the server sends back). */
export function appRoute(url: string) {
  const match = /^volink:\/\/(oauth|social-signup|login)\/?(\?[^#]*)?$/.exec(url)
  return match ? '#/' + match[1] + (match[2] ?? '') : null
}

/**
 * The organizer's check-in QR → the app's check-in screen (2026-11-08). The phone camera opens https://site/c/{id}?t=…
 * in this app (App Links); older QRs (…/#/checkin/{id}?t=…) still work from the in-app scanner.
 */
export function checkInRoute(url: string) {
  const link = /^https?:\/\/[^/?#]+\/c\/(\d+)\/?(\?t=[^#\s]+)$/.exec(url.trim())
  if (link) return '#/checkin/' + link[1] + link[2]
  const old = /#\/checkin\/(\d+)(\?t=[^#\s]+)$/.exec(url.trim())
  return old ? '#/checkin/' + old[1] + old[2] : null
}

export function setupNative() {
  const native = Capacitor.isNativePlatform()
  if (!SERVER || !(native || import.meta.env.VITE_FORCE_NATIVE === '1')) return
  setServer(SERVER)
  if (!native) return
  setSocialOpener(path => { void Browser.open({ url: SERVER + path + '?app=1' }) })
  void App.addListener('appUrlOpen', ({ url }) => {
    const qr = checkInRoute(url)
    if (qr) { window.location.hash = qr; return }
    const route = appRoute(url)
    if (!route) return
    void Browser.close().catch(() => {})
    window.location.hash = route
  })
  // The app was closed and the QR link started it: the check-in screen (login first if needed, then back there).
  void App.getLaunchUrl().then(launch => { const qr = launch?.url ? checkInRoute(launch.url) : null; if (qr) window.location.hash = qr }).catch(() => {})
  // Android back key: an open sheet closes first (like Escape), a sub-screen goes back, the home screen puts the app
  // in the background instead of closing it.
  void App.addListener('backButton', () => {
    if (document.querySelector('.m-sheet-wrap')) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return }
    const page = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'home'
    if (page === 'home' || page === 'login') { void App.minimizeApp(); return }
    goBack('#/home')
  })
}

/** Phone push is in this build only when GitHub Actions had the Firebase file (GOOGLE_SERVICES_JSON); without it
 * registering would crash the app, so nothing here runs. */
const PUSH = import.meta.env.VITE_PUSH === '1'
const PUSH_TOKEN = 'volink.pushToken'
let pushReady = false

/**
 * After sign-in (and right after the person allows notifications): get this phone's Firebase token and give it to the
 * server, which pushes each new notification here (respecting 알림 설정). Tapping a push opens its screen.
 */
export async function startPush() {
  if (!PUSH || !Capacitor.isNativePlatform()) return
  try {
    if ((await PushNotifications.checkPermissions()).receive !== 'granted') return
    if (!pushReady) {
      pushReady = true
      await PushNotifications.createChannel({ id: 'volink', name: 'Volink 알림', importance: 4, visibility: 1 }).catch(() => {})
      void PushNotifications.addListener('registration', ({ value }) => {
        try { localStorage.setItem(PUSH_TOKEN, value) } catch { /* storage blocked */ }
        void api('/api/me/push-token', 'PUT', { token: value, platform: 'ANDROID' }).catch(() => {})
      })
      void PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
        const link = String(notification.data?.link ?? '')
        if (/^#\/[a-z-]+/.test(link)) window.location.hash = link
      })
    }
    await PushNotifications.register()
  } catch { /* push not available on this phone */ }
}

/** Sign-out: this phone stops getting the member's pushes (before the session ends, while the call is still allowed). */
export async function stopPush() {
  if (!PUSH) return
  let token: string | null = null
  try { token = localStorage.getItem(PUSH_TOKEN); localStorage.removeItem(PUSH_TOKEN) } catch { /* storage blocked */ }
  if (token) await api('/api/me/push-token/remove', 'POST', { token }).catch(() => {})
}

/**
 * The phone's notification permission (Android 13+ asks; older phones allow by default); when allowed, push starts.
 * In a browser: the web prompt.
 */
export async function askNotifications(): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const granted = (await PushNotifications.requestPermissions()).receive === 'granted'
      if (granted) void startPush()
      return granted
    }
    if ('Notification' in window) return (await Notification.requestPermission()) === 'granted'
  } catch { /* not supported */ }
  return false
}
