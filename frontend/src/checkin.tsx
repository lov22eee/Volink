// Week 6 on the 2.0 screens. Nobody presses "start": the server opens check-in 30 minutes before the start, starts the
// activity at its time and finishes it at its end. On site the organizer shows a QR that changes every 30 seconds; each
// participant scans it with their own phone camera, which opens the check-in page here and sends the QR value with one
// position reading (never stored). If that fails, the organizer checks the person in by hand with a reason.
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { api, checkInLink } from './api'
import type { LiveActivity, User } from './api'
import { dateLabel, Icon, LoginRequired, Notice, showToast } from './App'
import { Glyph } from './icons'

export type QrInfo = { opened?: boolean; canStart?: boolean; openedAt?: string | null; open: boolean; token: string | null; code?: string | null; codeSecondsLeft?: number; opensAt: string; closesAt: string; validSeconds: number; rotateSeconds: number; expected: number; checkedIn: number; toComplete: number; status: string }
/** wait = the organizer can open attendance now but has not yet (2026-11-08: [출석 시작]); open = QR / code check-in works. */
export type Phase = 'later' | 'soon' | 'wait' | 'open' | 'late' | 'ended'

const WINDOW_MS = 30 * 60_000
/**
 * Where the activity is in its day, from its own date and time (Korean time) — the same rule the server applies.
 * Attendance can be opened by the organizer from 30 minutes before the start to 30 minutes before the end (closes);
 * `opened` = the organizer pressed [출석 시작] (LiveActivity.checkinOpenedAt / Participation checkinOpen).
 */
export function phaseOf(date: string, startTime: string, durationMinutes: number, now = Date.now(), opened = false): { phase: Phase; opens: number; closes: number; start: number; end: number } {
  const start = new Date(`${date}T${startTime}:00+09:00`).getTime()
  const end = start + durationMinutes * 60_000
  const opens = start - WINDOW_MS, closes = end - WINDOW_MS
  const phase: Phase = now >= end ? 'ended' : now > closes ? 'late' : now >= opens ? (opened ? 'open' : 'wait') : opens - now <= 12 * 3_600_000 ? 'soon' : 'later'
  return { phase, opens, closes, start, end }
}

/** Server times are Korean local "yyyy-MM-ddTHH:mm[:ss]". */
const kst = (value: string) => new Date(value.slice(0, 16) + ':00+09:00').getTime()

export const hhmm = (ms: number) => new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(ms))

/** Re-render every `ms` so time-based states (window open, ended) change without a reload. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(timer) }, [ms])
  return now
}

/** Organizer, on the detail page from the day of the activity: rotating QR, live attendance, and completion after the end. */
export function AttendancePanel({ activity, phase, onChanged }: { activity: LiveActivity; phase: Phase; onChanged: () => void }) {
  const [info, setInfo] = useState<QrInfo | null>(null)
  const [image, setImage] = useState('')
  const [left, setLeft] = useState(0)
  const [big, setBig] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => api<QrInfo>('/api/activities/' + activity.id + '/qr').then(next => { setInfo(next); setLeft(next.rotateSeconds) }).catch(() => setInfo(null)), [activity.id])
  useEffect(() => { load() }, [load, phase])
  // While check-in is open: a new QR (and the attendance count) every rotateSeconds; the applicant list follows along.
  const open = info?.open ?? false
  const rotate = info?.rotateSeconds ?? 30
  useEffect(() => {
    if (!open) return
    const refresh = window.setInterval(() => { load(); onChanged() }, rotate * 1000)
    const tick = window.setInterval(() => setLeft(value => Math.max(0, value - 1)), 1000)
    return () => { window.clearInterval(refresh); window.clearInterval(tick) }
  }, [open, rotate, load, onChanged])
  const url = info?.token ? checkInLink(activity.id, info.token) : ''
  useEffect(() => { if (url) QRCode.toDataURL(url, { width: 560, margin: 1 }).then(setImage).catch(() => setImage('')); else setImage('') }, [url])
  useEffect(() => {
    if (!big) return
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setBig(false) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [big])
  if (!info) return null

  async function startNow() {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ notified: number }>('/api/activities/' + activity.id + '/checkin/start', 'POST', {})
      showToast('출석을 시작했어요', `참가자 ${result.notified}명에게 알렸어요`)
      load()
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '처리하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function completeAll() {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ completed: number }>('/api/activities/' + activity.id + '/complete', 'POST', {})
      showToast(result.completed + '명의 활동 완료를 확인했어요', '참가자에게 활동 기록이 만들어졌어요')
      load()
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '처리하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const count = <p className="attend-count" aria-live="polite"><b>{info.checkedIn}</b> / {info.expected}명 출석</p>
  const opens = kst(info.opensAt), closes = kst(info.closesAt)
  return <section className={'attendance-panel ' + phase} aria-label="출석 체크">
    <div className="attend-head"><span className="attend-eyebrow"><Glyph name="check" size={17} />출석 체크</span>{count}</div>
    {open && image ? <div className="attend-live">
      <button className="qr-frame" onClick={() => setBig(true)} aria-label="QR 크게 보기">
        <img src={image} alt="체크인 QR" data-url={url} width={200} height={200} />
      </button>
      <div className="attend-copy">
        <strong>참가자에게 이 QR을 보여 주세요</strong>
        {info.code && <span className="attend-code" aria-label={'출석 코드 ' + info.code}>출석 코드 <b>{info.code}</b></span>}
        <ol><li>참가자가 휴대폰 카메라로 QR을 찍어요</li><li>열린 화면에서 ‘위치 확인하고 체크인’을 눌러요</li><li>서버가 시간·QR·위치(200m)를 확인해요</li></ol>
        <span className="qr-timer" aria-hidden="true"><i style={{ width: (left / rotate) * 100 + '%' }} /></span>
        <small>{left}초 뒤 새 QR로 바뀌어요 · 캡처한 QR은 1분 뒤 쓸 수 없어요</small>
        <button className="pill-button dark small" onClick={() => setBig(true)}>QR 크게 보기</button>
      </div>
    </div>
      : info.canStart ? <div className="attend-end">
        <p><b>아직 출석을 시작하지 않았어요.</b> 현장에 도착하면 출석을 시작해 주세요. 시작하면 QR이 나타나고 참가자에게 알림이 가요. ({hhmm(closes)}까지 시작할 수 있어요)</p>
        <button className="pill-button green" disabled={busy} onClick={startNow}>{busy ? '처리 중…' : '출석 시작'}</button>
      </div>
      : phase === 'ended' ? <div className="attend-end">
        <p>활동이 끝났어요. 체크인한 참가자의 완료를 확인하면 활동 기록이 만들어져요.{info.expected - info.checkedIn > 0 ? (info.opened ? ` 체크인하지 않은 ${info.expected - info.checkedIn}명은 불참으로 처리돼요.` : ` 출석을 열지 않아 ${info.expected - info.checkedIn}명은 출석 미확인으로 남아요.`) : ''}</p>
        {info.toComplete > 0 ? <button className="pill-button green" disabled={busy} onClick={completeAll}>{busy ? '처리 중…' : `체크인한 ${info.toComplete}명 모두 완료`}</button>
          : <span className="status-chip ok">완료 확인을 마쳤어요</span>}
      </div>
        : Date.now() > closes ? <p className="attend-note">QR 체크인 시간이 지났어요 ({hhmm(closes)}까지). 늦게 온 참가자는 아래 신청자 목록에서 ‘수동 확인’을 눌러 주세요.</p>
          : <p className="attend-note">출석은 <b>{hhmm(opens)} ~ {hhmm(closes)}</b>에 현장에서 [출석 시작]을 눌러 열어요. 그때 이 자리에 QR이 나타나요. 위치를 쓸 수 없는 참가자는 수동으로 확인할 수 있어요.</p>}
    {error && <Notice text={error} tone="error" />}
    {big && image && createPortal(<div className="qr-fullscreen" role="dialog" aria-modal="true" aria-label="출석 QR 크게 보기" onClick={() => setBig(false)}>
      <div className="qr-big" onClick={event => event.stopPropagation()}>
        <strong>{activity.title}</strong>
        <img src={image} alt="체크인 QR (크게)" />
        {info.code && <span className="attend-code big">QR이 안 찍히면 <b>{info.code}</b></span>}
        {count}
        <span className="qr-timer" aria-hidden="true"><i style={{ width: (left / rotate) * 100 + '%' }} /></span>
        <small>{left}초 뒤 새 QR로 바뀌어요</small>
        <button className="pill-button line" onClick={() => setBig(false)}>닫기</button>
      </div>
    </div>, document.body)}
  </section>
}

/** Participant, confirmed: what to do about check-in right now. */
export function CheckInHint({ phase, opens, closes }: { phase: Phase; opens: number; closes: number }) {
  if (phase === 'open') return <div className="checkin-hint open" role="note">
    <strong><Glyph name="check" size={17} />체크인이 열렸어요 · {hhmm(closes)}까지</strong>
    <ol><li>현장에서 모집자 화면의 QR을 휴대폰 카메라로 찍어요</li><li>열린 화면에서 위치를 허용하고 체크인해요</li></ol>
    <small>위치는 이번 확인에만 쓰고 저장하지 않아요. 안 되면 모집자에게 수동 확인을 요청하세요.</small>
  </div>
  if (phase === 'wait') return <div className="checkin-hint" role="note"><strong><Glyph name="clock" size={17} />모집자가 출석을 시작하면 알려 드려요</strong><small>현장에서 모집자가 [출석 시작]을 누르면 QR을 찍을 수 있어요.</small></div>
  if (phase === 'soon') return <div className="checkin-hint" role="note"><strong><Glyph name="clock" size={17} />출석은 {hhmm(opens)}부터 시작돼요</strong><small>현장에서 모집자가 출석을 시작하면 보여 주는 QR을 휴대폰 카메라로 찍으면 돼요.</small></div>
  if (phase === 'late') return <div className="checkin-hint" role="note"><strong>QR 체크인 시간이 지났어요</strong><small>현장에 있다면 모집자에게 수동 확인을 요청하세요.</small></div>
  return null
}

/** Participant: opened by scanning the organizer's QR. One position reading goes to the server and is not stored. */
export function CheckInPage({ id, token, user, ready }: { id: number; token?: string; user: User | null; ready: boolean }) {
  const [activity, setActivity] = useState<LiveActivity | null>(null)
  const [state, setState] = useState<'idle' | 'locating' | 'sending' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [at, setAt] = useState('')
  // No camera / QR will not scan: the 4-digit code on the organizer's screen does the same (location still checked).
  const [code, setCode] = useState('')
  const [byCode, setByCode] = useState(!token)
  useEffect(() => { if (ready) api<LiveActivity>('/api/activities/' + id).then(setActivity).catch(() => setActivity(null)) }, [id, ready])
  // Not signed in yet: come back to this exact page (with the QR value) after logging in.
  useEffect(() => {
    if (!ready || user) return
    try { sessionStorage.setItem('volink.next', window.location.hash) } catch { /* private mode: scan the QR again after login */ }
  }, [ready, user])
  if (!user) return <div className="checkin-page"><LoginRequired ready={ready} text="체크인하려면 로그인해 주세요. 로그인하면 이 화면으로 돌아와요." /></div>

  async function send(lat: number | null, lng: number | null, acc: number | null) {
    setState('sending')
    try {
      const result = await api<{ checkedInAt: string }>('/api/activities/' + id + '/check-ins', 'POST', byCode ? { code, lat, lng, accuracy: acc } : { qrToken: token, lat, lng, accuracy: acc })
      setAt(result.checkedInAt?.slice(11, 16) ?? '')
      setState('done')
    } catch (cause) {
      setState('error')
      setMessage(cause instanceof Error ? cause.message : '체크인하지 못했습니다.')
    }
  }
  function start() {
    setState('locating')
    setMessage('')
    if (!navigator.geolocation) { send(null, null, null); return }
    navigator.geolocation.getCurrentPosition(
      position => { setAccuracy(Math.round(position.coords.accuracy)); send(position.coords.latitude, position.coords.longitude, position.coords.accuracy) },
      () => send(null, null, null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  }
  const facts = activity && <p className="checkin-facts"><Glyph name="calendar" size={16} />{dateLabel(activity.date)} · {activity.startTime}<span aria-hidden="true">·</span><Glyph name="pin" size={16} />{activity.placeName ?? '장소 미정'}</p>
  if (state === 'done') return <section className="checkin-page create-done" role="status">
    <span className="done-mark ok" aria-hidden="true"><Icon name="check" size={42} /></span>
    <h1>체크인했어요{at ? ' · ' + at : ''}</h1>
    <p>{activity?.title ?? '활동'} 즐겁게 함께해요! 활동이 끝나면 모집자가 완료를 확인하고, 활동 기록이 만들어져요.</p>
    <div className="button-row"><a className="pill-button green" href={'#/activity/' + id}>활동 보기</a></div>
  </section>
  return <section className="checkin-page">
    <span className="done-mark ok" aria-hidden="true"><Icon name="pin" size={40} /></span>
    <h1>{activity?.title ?? '체크인'}</h1>
    {facts}
    <p className="checkin-lede">시간 · QR · 위치(활동 장소 200m 안)를 함께 확인해요. 위치는 이번 확인에만 쓰고 저장하지 않아요.</p>
    {byCode && <div className="code-entry">
      <label htmlFor="checkin-code">모집자 화면의 <b>출석 코드</b> 4자리</label>
      <input id="checkin-code" className="code-input" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={4} placeholder="0000" aria-label="출석 코드"
        value={code} onChange={event => { setCode(event.target.value.replace(/\D/g, '').slice(0, 4)); if (state === 'error') setState('idle') }} />
    </div>}
    <button className="pill-button dark checkin-go" disabled={state === 'locating' || state === 'sending' || (byCode && code.length !== 4)} onClick={start}>
      {state === 'locating' ? '위치 확인 중…' : state === 'sending' ? '확인 중…' : state === 'error' ? '다시 시도하기' : byCode ? '코드로 체크인' : '위치 확인하고 체크인'}</button>
    {token && <button type="button" className="text-button code-switch" onClick={() => { setByCode(!byCode); setState('idle'); setMessage('') }}>{byCode ? 'QR로 체크인하기' : 'QR이 안 되나요? 출석 코드 입력'}</button>}
    {state === 'error' && <div className="checkin-error" role="alert"><strong>체크인하지 못했어요</strong><span>{message}</span>
      {accuracy != null && accuracy > 100 && <small>지금 위치 정확도가 약 {accuracy}m로 낮아요. 건물 밖이나 트인 곳에서 다시 시도해 보세요.</small>}
      {/만료/.test(message) && <small>QR은 30초마다 바뀌어요. 모집자 화면의 새 QR을 다시 찍어 주세요.</small>}</div>}
    <p className="small-print">QR·위치 확인은 부정 참여 가능성을 줄이는 방법이며 완벽한 증명은 아니에요. 안 되면 모집자에게 수동 확인을 요청하세요.</p>
  </section>
}

/** After logging in: go back where the person was headed (a scanned check-in link), else home. */
export function takeNext() {
  try {
    const next = sessionStorage.getItem('volink.next')
    sessionStorage.removeItem('volink.next')
    return next
  } catch { return null }
}
