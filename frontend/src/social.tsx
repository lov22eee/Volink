// Kakao / Google login for personal members, shared by the web site and the app.
// The buttons send the browser to the server, which sends it on to Kakao / Google. Without keys they say "준비 중".
import { useEffect, useState } from 'react'
import { api } from './api'

export type Provider = 'kakao' | 'google'
export const providerName: Record<Provider, string> = { kakao: '카카오', google: '구글' }

let cached: Promise<Record<Provider, boolean>> | null = null
const off: Record<Provider, boolean> = { kakao: false, google: false }

/**
 * Which buttons have server keys. Only a real answer is kept: a failed call (server restarting, no network) is asked
 * again next time instead of showing "준비 중" until the app restarts (2026-11-06, seen on the phone during an AWS update).
 */
export function loadProviders(fresh = false) {
  if (fresh || !cached) cached = api<Record<Provider, boolean>>('/api/auth/oauth/providers').catch(() => { cached = null; return off })
  return cached
}

export function useProviders() {
  const [on, setOn] = useState<Record<Provider, boolean>>(off)
  useEffect(() => { void loadProviders().then(setOn) }, [])
  return on
}

// The site goes there in the same tab; the Android app opens the phone browser instead (setSocialOpener).
let opener = (path: string) => { window.location.href = path }
export function setSocialOpener(open: (path: string) => void) { opener = open }

export function startSocial(provider: Provider) {
  opener('/api/auth/oauth/' + provider + '/start')
}

/** Why a social login came back to the login page (?oauth=CODE). */
export function socialError(code: string | null) {
  if (!code) return ''
  return ({
    off: '이 간편 로그인은 아직 준비 중이에요. 이메일로 로그인해 주세요.',
    OAUTH_DENIED: '간편 로그인을 취소했어요.',
    OAUTH_STATE: '로그인 시간이 지났어요. 다시 눌러 주세요.',
    OAUTH_FAILED: '카카오·구글과 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
  } as Record<string, string>)[code] ?? '간편 로그인을 하지 못했어요. 다시 시도해 주세요.'
}

export function KakaoMark({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path fill="#191919" d="M12 3.5c-5 0-9 3.1-9 7 0 2.5 1.7 4.7 4.2 6l-1 3.7c-.1.3.3.6.6.4l4.4-2.9h.8c5 0 9-3.1 9-7s-4-7.2-9-7.2Z" /></svg>
}

export function GoogleMark({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5Z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7Z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44Z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5Z" /></svg>
}
