// Location permission shared by 활동 찾기 and the place picker in 활동 만들기.
// Only the answer is remembered (never the position): '1' allowed, '0' declined in the place picker.
const REMEMBER = 'volink.nearby'
const read = () => { try { return localStorage.getItem(REMEMBER) } catch { return null } }
export const remembered = () => read() === '1'
export const declined = () => read() === '0'
export const remember = (on: boolean) => { try { if (on) localStorage.setItem(REMEMBER, '1'); else localStorage.removeItem(REMEMBER) } catch { /* private mode */ } }
export const decline = () => { try { localStorage.setItem(REMEMBER, '0') } catch { /* private mode */ } }

/** One position from the browser, or null when refused, unsupported or too slow. */
export function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return }
    navigator.geolocation.getCurrentPosition(position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }), () => resolve(null), { timeout: 8000, maximumAge: 60000 })
  })
}
