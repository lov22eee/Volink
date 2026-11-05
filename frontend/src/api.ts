// Server calls. The access token lives only in memory; the HttpOnly refresh cookie restores it after a reload.
import type { Errors } from './rules'

export const preview = Boolean(window.__VOLINK_UI_DEMO__)

export type Organization = { id: number; name: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'; rejectReason: string | null }
export type User = {
  id: number; email: string; name: string; role: 'USER' | 'ADMIN'; memberType: 'GENERAL' | 'INSTITUTION'
  status: string; interests: string[]; organization: Organization | null
}
export type LiveActivity = {
  id: number; title: string; description: string; category: string; activityType: 'GENERAL' | 'INSTITUTION'
  organizationName: string | null; placeId: number | null; placeName: string | null; placeAddress?: string | null; meetingPoint?: string | null
  date: string; startTime: string
  durationMinutes: number; capacity: number; confirmed: number; status: string; riskLevel: 'LOW' | 'REVIEW' | 'BLOCKED'
  organizerName: string; riskReasons?: string | null; reviewNote?: string | null
  latitude?: number | null; longitude?: number | null; distanceKm?: number; organizerId?: number; supplies?: { name: string; provided: boolean }[]
  /** Only for the organizer: applications that lock the full edit. */
  applicants?: number
  /** Week 6 (V9): labels, one reschedule, the organizer's cancel reason; counts only in the organizer's own list. */
  difficulty?: 'EASY' | 'NORMAL' | 'HARD'; placeKind?: 'OUTDOOR' | 'INDOOR' | 'MIXED'; newcomerOk?: boolean | number
  rescheduleCount?: number; cancelReason?: string | null; pending?: number; unanswered?: number; checkedIn?: number
}
export type ParticipationStatus = 'APPLIED' | 'CONFIRMED' | 'REJECTED' | 'WAITLISTED' | 'OFFERED' | 'EXPIRED' | 'CANCELLED' | 'CHECKED_IN' | 'COMPLETED' | 'NO_SHOW' | 'HELD' | 'INVALIDATED'
export type Participation = { id: number; status: ParticipationStatus; waitOrder: number | null; offerExpiresAt: string | null; cancelCount?: number; lateMinutes?: number | null }
export type Seats = { confirmed: number; offered: number; waiting: number; pending: number }
export type ViewerInfo = Seats & { participation: Participation | null }
export type Applicant = Participation & { name: string; appliedAt: string; checkInMethod?: 'QR' | 'CODE' | 'MANUAL' | null; checkInReason?: string | null; checkedInAt?: string | null }
export type MyRecord = { id: number; activityId: number; title: string; placeName: string | null; date: string; startTime: string; durationMinutes: number; checkInMethod: 'QR' | 'MANUAL'; confirmedAt: string; appealDeadline: string; status: 'VALID' | 'HELD' | 'INVALIDATED' }
export type MyParticipation = Participation & { activityId: number; title: string; placeName: string | null; date: string; startTime: string; durationMinutes?: number; activityStatus?: string; cancelReason?: string | null; organizerId?: number }
export type AppNotification = { id: number; type: string; title: string; body: string; link: string | null; read: boolean | number; createdAt: string }
export type PlaceInfo = {
  id: number; name: string; area: string; addressNote?: string; meetingPoint?: string | null
  latitude: number | null; longitude: number | null; coordinateStatus?: string
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fieldErrors: Errors) {
    super(message)
  }
}

let accessToken: string | null = null

// The Android app (Capacitor) runs its bundled pages at https://localhost, so it calls the server by its address and
// keeps the refresh token itself (the server returns it in the body only to the app's origin). The site leaves this
// empty: same-origin calls and the HttpOnly cookie.
let server = ''
const KEEP = 'volink.refresh'
export function setServer(base: string) { server = base.replace(/\/+$/, '') }
export function serverBase() { return server }
/** The public site address, for links people open outside the app (the check-in QR). */
export function siteUrl() { return server ? server + '/' : window.location.origin + window.location.pathname }
function kept() { try { return localStorage.getItem(KEEP) } catch { return null } }
function keep(token: string | null | undefined) { try { if (token) localStorage.setItem(KEEP, token); else localStorage.removeItem(KEEP) } catch { /* storage blocked */ } }

export function setToken(token: string | null) {
  accessToken = token
}

async function send(path: string, method: string, body: unknown, withToken: boolean) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (withToken && accessToken) headers.Authorization = 'Bearer ' + accessToken
  return fetch(server + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: server ? 'omit' : 'same-origin' })
}

async function parse(response: Response) {
  if (response.status === 204) return null
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    const fieldErrors: Errors = {}
    for (const item of data?.fieldErrors ?? []) fieldErrors[item.field] = item.message
    throw new ApiError(response.status, data?.code ?? 'ERROR', data?.message ?? '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', fieldErrors)
  }
  return data
}

/** Calls the server; an expired access token is renewed once through the refresh cookie. */
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response = await send(path, method, body, true)
  if (response.status === 401 && accessToken && !path.startsWith('/api/auth/')) {
    if (await refresh()) response = await send(path, method, body, true)
  }
  return parse(response)
}

type Session = { accessToken: string; user: User; refreshToken?: string }

function start(session: Session) {
  accessToken = session.accessToken
  if (server) keep(session.refreshToken)
  hint(true)
  return session.user
}

// The refresh cookie is single-use (rotated on every refresh). Two refreshes at once (React's double effect in
// development, or two requests renewing an expired token together) would send the same cookie twice, and the
// second would be refused and log the person out. So every caller shares one in-flight refresh.
let refreshing: Promise<User | null> | null = null

// Remembers only that this browser signed in (no token, no name), so a first-time visitor does not send a refresh
// request that can only fail. The session itself still lives in the HttpOnly cookie.
const SIGNED_IN = 'volink.signedIn'
function hint(on: boolean) { try { if (on) localStorage.setItem(SIGNED_IN, '1'); else localStorage.removeItem(SIGNED_IN) } catch { /* storage blocked */ } }
export function mayHaveSession() { if (server) return Boolean(kept()); try { return localStorage.getItem(SIGNED_IN) === '1' } catch { return true } }

export function refresh(): Promise<User | null> {
  refreshing ??= (async () => {
    try {
      const token = server ? kept() : null
      if (server && !token) { accessToken = null; return null }
      const response = await send('/api/auth/refresh', 'POST', server ? { refreshToken: token } : undefined, false)
      if (!response.ok) { accessToken = null; hint(false); if (response.status === 401) keep(null); return null }
      return start(await response.json())
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export async function login(email: string, password: string): Promise<User> {
  return start(await api<Session>('/api/auth/login', 'POST', { email, password }))
}

/** Kakao / Google: after the provider sends the browser back, a one-time code becomes the session. */
export async function finishSocial(code: string): Promise<User> {
  return start(await api<Session>('/api/auth/oauth/finish', 'POST', { code }))
}

/** First Kakao / Google login: the signup form (personal member) and then the session. */
export async function completeSocial(body: { ticket: string; name: string; birthDate: string; interests: string[]; agreedNotice: boolean }): Promise<User> {
  return start(await api<Session>('/api/auth/oauth/complete', 'POST', body))
}

export async function logout() {
  try { await send('/api/auth/logout', 'POST', server ? { refreshToken: kept() } : undefined, false) } finally { accessToken = null; hint(false); keep(null) }
}
