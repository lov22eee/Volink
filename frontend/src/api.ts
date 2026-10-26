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
}
export type ParticipationStatus = 'APPLIED' | 'CONFIRMED' | 'REJECTED' | 'WAITLISTED' | 'OFFERED' | 'EXPIRED' | 'CANCELLED' | 'CHECKED_IN' | 'COMPLETED' | 'NO_SHOW' | 'HELD' | 'INVALIDATED'
export type Participation = { id: number; status: ParticipationStatus; waitOrder: number | null; offerExpiresAt: string | null; cancelCount?: number }
export type Seats = { confirmed: number; offered: number; waiting: number; pending: number }
export type ViewerInfo = Seats & { participation: Participation | null }
export type Applicant = Participation & { name: string; appliedAt: string }
export type MyParticipation = Participation & { activityId: number; title: string; placeName: string | null; date: string; startTime: string }
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

export function setToken(token: string | null) {
  accessToken = token
}

async function send(path: string, method: string, body: unknown, withToken: boolean) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (withToken && accessToken) headers.Authorization = 'Bearer ' + accessToken
  return fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' })
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

type Session = { accessToken: string; user: User }

// The refresh cookie is single-use (rotated on every refresh). Two refreshes at once (React's double effect in
// development, or two requests renewing an expired token together) would send the same cookie twice, and the
// second would be refused and log the person out. So every caller shares one in-flight refresh.
let refreshing: Promise<User | null> | null = null

export function refresh(): Promise<User | null> {
  refreshing ??= (async () => {
    try {
      const response = await send('/api/auth/refresh', 'POST', undefined, false)
      if (!response.ok) { accessToken = null; return null }
      const session: Session = await response.json()
      accessToken = session.accessToken
      return session.user
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export async function login(email: string, password: string): Promise<User> {
  const session = await api<Session>('/api/auth/login', 'POST', { email, password })
  accessToken = session.accessToken
  return session.user
}

export async function logout() {
  try { await send('/api/auth/logout', 'POST', undefined, false) } finally { accessToken = null }
}
