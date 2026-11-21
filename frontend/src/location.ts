import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
// Location permission shared by 활동 찾기 and the place picker in 활동 만들기.
// Only the answer is remembered (never the position): '1' allowed, '0' declined in the place picker.
const REMEMBER = 'volink.nearby'
const read = () => { try { return localStorage.getItem(REMEMBER) } catch { return null } }
export const remembered = () => read() === '1'
export const declined = () => read() === '0'
export const remember = (on: boolean) => { try { if (on) localStorage.setItem(REMEMBER, '1'); else localStorage.removeItem(REMEMBER) } catch { /* private mode */ } }
export const decline = () => { try { localStorage.setItem(REMEMBER, '0') } catch { /* private mode */ } }

/** One position from the browser, or null when refused, unsupported or too slow. */
/**
 * One position, or null when refused, unsupported or too slow (2026-11-21). In the app the phone's own location service
 * (@capacitor/geolocation, Google fused location) is asked: the WebView's navigator.geolocation often found nothing in
 * the APK although location was allowed. A quick answer first (network/Wi-Fi, an answer up to {@code maxAgeMs} old),
 * then GPS when that fails. The browser and the PC site keep navigator.geolocation.
 */
export async function locate(options: { high?: boolean; timeoutMs?: number; maxAgeMs?: number } = {}): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  const timeout = options.timeoutMs ?? 8000, maximumAge = options.maxAgeMs ?? 60000
  if (Capacitor.isNativePlatform()) {
    try {
      const status = await Geolocation.checkPermissions()
      if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
        const asked = await Geolocation.requestPermissions()
        if (asked.location !== 'granted' && asked.coarseLocation !== 'granted') return null
      }
    } catch { /* checked again by getCurrentPosition */ }
    for (const high of options.high ? [true] : [false, true]) {
      try {
        const at = await Geolocation.getCurrentPosition({ enableHighAccuracy: high, timeout, maximumAge })
        return { lat: at.coords.latitude, lng: at.coords.longitude, accuracy: at.coords.accuracy }
      } catch { /* the next way, or none */ }
    }
    return null
  }
  if (!navigator.geolocation) return null
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }),
      () => resolve(null), { enableHighAccuracy: options.high ?? false, timeout, maximumAge })
  })
}

/** {@code maxAgeMs}: how old a position the phone already has may be (홈 takes one up to 10 minutes old, so no GPS wait). */
export async function currentPosition(maxAgeMs = 60000): Promise<{ lat: number; lng: number } | null> {
  const at = await locate({ maxAgeMs })
  return at && { lat: at.lat, lng: at.lng }
}
