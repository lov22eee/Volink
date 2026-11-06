// Activity detail for a participant, shown by state: 신청 전 / 대기 중 / 확정 후 / 활동 당일 / 완료 후.
// The organizer gets a dashboard instead (ManageScreen): 신청자 / 소식 / 출석, with schedule change and cancel.
import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { categoryTone } from '../categories'
import { api, ApiError } from '../api'
import type { Applicant, LiveActivity, User, ViewerInfo } from '../api'
import { showToast } from '../App'
import { hhmm, phaseOf, useNow } from '../checkin'
import type { Phase } from '../checkin'
import { durationLabel } from '../create'
import { activityRules as r } from '../rules'
import { addToCalendar, difficultyLabel, fieldIcon, isNewcomer, placeKindLabel, seatsLeft } from './cards'
import { DateSheet, DurationSheet, TimeSheet } from './host'
import { NewsEntry, NewsScreen } from './news'
import type { Thread } from './news'
import { RollCall } from './rollcall'
import { statusWord } from './mine'
import { ActionBar, dayWord, dDay, go, Loading, MIcon, PickField, Sheet, TopBar, TextArea, TextInput } from './ui'

const message = (cause: unknown) => cause instanceof ApiError ? (Object.values(cause.fieldErrors)[0] ?? cause.message) : cause instanceof Error ? cause.message : '처리하지 못했어요.'

function Facts({ activity }: { activity: LiveActivity }) {
  const end = new Date(new Date(`${activity.date}T${activity.startTime}:00+09:00`).getTime() + activity.durationMinutes * 60_000)
  return <dl className="m-facts">
    <div><dt><MIcon name="calendar" size={19} /></dt><dd><strong>{dayWord(activity.date)} {activity.startTime} ~ {hhmm(end.getTime())}</strong><small>{durationLabel(activity.durationMinutes)}{(activity.rescheduleCount ?? 0) > 0 ? ' · 일정이 한 번 바뀌었어요' : ''}</small></dd></div>
    <div><dt><MIcon name="pin" size={19} /></dt><dd><strong>{activity.placeName ?? '장소 미정'}</strong>{activity.meetingPoint && <small>만나는 곳 · {activity.meetingPoint}</small>}</dd></div>
    <div><dt><MIcon name="users" size={19} /></dt><dd><strong>확정 {activity.confirmed} / {activity.capacity}명</strong><small>모집자 제외 · 연락처는 공개하지 않아요</small></dd></div>
  </dl>
}

function Labels({ activity }: { activity: LiveActivity }) {
  return <div className="m-labels">
    <span className="m-badge gray"><MIcon name={fieldIcon[activity.category] ?? 'sprout'} size={14} />{activity.category}</span>
    {activity.difficulty && <span className="m-badge gray">{difficultyLabel[activity.difficulty]}</span>}
    {activity.placeKind && <span className="m-badge gray">{placeKindLabel[activity.placeKind]}</span>}
    {isNewcomer(activity) && <span className="m-badge mint">처음 환영</span>}
    {activity.activityType === 'INSTITUTION' && <span className="m-badge blue">{activity.organizationName ?? '기관'} 주관</span>}
  </div>
}

function Supplies({ activity }: { activity: LiveActivity }) {
  const list = activity.supplies ?? []
  if (!list.length) return null
  return <div className="m-supplies">
    {list.filter(s => !s.provided).length > 0 && <p><b>챙겨 올 것</b>{list.filter(s => !s.provided).map(s => <span key={s.name} className="m-badge gray">{s.name}</span>)}</p>}
    {list.filter(s => s.provided).length > 0 && <p><b>모집자가 준비</b>{list.filter(s => s.provided).map(s => <span key={s.name} className="m-badge mint">{s.name}</span>)}</p>}
  </div>
}

function About({ text }: { text: string }) {
  const [open, setOpen] = useState(text.length < 140)
  return <section className="m-section"><h2 className="m-h3">어떤 활동인가요?</h2>
    <p className={'m-about' + (open ? '' : ' clamp')}>{text}</p>
    {!open && <button type="button" className="m-text-btn" onClick={() => setOpen(true)}>더 보기</button>}
  </section>
}

type Stage = 'before' | 'waiting' | 'offer' | 'confirmed' | 'today' | 'checkedin' | 'done' | 'closed'

/**
 * Only the server saying the activity is gone (404/403) counts as gone. A failed request while the phone's network is
 * waking up (coming back from the background) keeps what is on screen; the next load fixes it.
 */
const gone = (cause: unknown) => cause instanceof ApiError && (cause.status === 404 || cause.status === 403)

export function ActivityScreen({ id, user, onChange }: { id: number; user: User; onChange: () => void }) {
  const now = useNow(15_000)
  const [activity, setActivity] = useState<LiveActivity | null>(null)
  const [viewer, setViewer] = useState<ViewerInfo | null>(null)
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState<'cancel' | 'late' | 'scan' | 'safety' | null>(null)
  const load = useCallback(() => {
    api<LiveActivity>('/api/activities/' + id).then(a => {
      if (a.organizerId === user.id) { window.location.replace('#/manage/' + id); return }
      setActivity(a)
    }).catch(cause => setFailed(gone(cause) ? '활동을 찾을 수 없어요. 삭제됐거나 비공개일 수 있어요.' : ''))
    api<ViewerInfo>('/api/activities/' + id + '/my-participation').then(setViewer).catch(() => setViewer(null))
  }, [id, user.id])
  useEffect(() => { load() }, [load])
  useEffect(() => { api<LiveActivity[]>('/api/me/saved').then(list => setSaved(list.some(a => a.id === id))).catch(() => {}) }, [id])

  if (failed) return <div className="m-screen"><TopBar title="활동" back="history" /><div className="m-body"><div className="m-note bad">{failed}</div><a className="m-btn line" href="#/find">다른 활동 찾기</a></div></div>
  if (!activity || !viewer) return <div className="m-screen"><TopBar title="활동" back="history" /><Loading /></div>

  const mine = viewer.participation
  const { phase, opens, closes } = phaseOf(activity.date, activity.startTime, activity.durationMinutes, now)
  const start = new Date(`${activity.date}T${activity.startTime}:00+09:00`).getTime()
  const cancelled = activity.status === 'CANCELLED'
  const stage: Stage = cancelled ? 'closed'
    : !mine || ((mine.status === 'CANCELLED' || mine.status === 'EXPIRED') && (mine.cancelCount ?? 0) < 2) ? 'before'
    : mine.status === 'APPLIED' || mine.status === 'WAITLISTED' ? 'waiting'
    : mine.status === 'OFFERED' ? 'offer'
    : mine.status === 'CONFIRMED' ? (start - now <= 3 * 3_600_000 ? 'today' : 'confirmed')
    : mine.status === 'CHECKED_IN' ? 'checkedin'
    : mine.status === 'COMPLETED' ? 'done' : 'closed'
  const full = seatsLeft(activity) === 0
  const waitClosed = start - now < 2 * 3_600_000
  const recruiting = activity.status === 'RECRUITING' && now < start

  async function act(path: string, body: object | undefined, done: string) {
    setBusy(true)
    try {
      await api(path, 'POST', body)
      showToast(done)
      setSheet(null)
      load()
      onChange()
    } catch (cause) {
      showToast(message(cause))
    } finally {
      setBusy(false)
    }
  }
  async function toggleSave() {
    try {
      await api('/api/me/saved/' + id, saved ? 'DELETE' : 'PUT')
      setSaved(!saved)
      showToast(saved ? '저장을 취소했어요' : '저장했어요', saved ? '' : '마이 > 저장한 봉사에서 볼 수 있어요')
    } catch { showToast('저장하지 못했어요') }
  }

  // Applied (2026-11-06): the same plain top as 모집 관리 — a status badge and D-day instead of the big field icon.
  const applied = Boolean(mine) && stage !== 'before' && !cancelled
  const badge: [string, string] = stage === 'waiting' ? [mine?.status === 'APPLIED' ? '승인 대기' : `대기 ${mine?.waitOrder ?? ''}번`, 'amber']
    : stage === 'offer' ? ['자리 제안', 'hot'] : stage === 'confirmed' ? ['참가 확정', 'mint'] : stage === 'today' ? ['오늘 활동', 'mint']
    : stage === 'checkedin' ? ['출석 완료', 'mint'] : stage === 'done' ? ['활동 완료', 'mint'] : [statusWord[mine?.status ?? '']?.text ?? '마감', 'gray']
  const dday = dDay(activity.date)
  const head = applied ? <section className="mg-head">
    <div className="mg-state"><span className={'m-badge ' + badge[1]}>{badge[0]}</span>
      {dday && !['checkedin', 'done'].includes(stage) && stage !== 'closed' && <small>{dday === 'D-DAY' ? '오늘' : '활동까지 ' + dday.slice(2) + '일'}</small>}</div>
    <h1>{activity.title}</h1>
    <p className="m-by">{activity.activityType === 'INSTITUTION' ? activity.organizationName : activity.organizerName + ' 님'}이 모집해요</p>
  </section> : <section className="m-detail-head">
    <span className={'m-cover f' + categoryTone(activity.category)}><MIcon name={fieldIcon[activity.category] ?? 'sprout'} size={34} /></span>
    <Labels activity={activity} />
    <h1>{activity.title}</h1>
    <p className="m-by">{activity.activityType === 'INSTITUTION' ? activity.organizationName : activity.organizerName + ' 님'}이 모집해요</p>
  </section>

  // One card at the top that says where I am now and what happens next.
  const statusCard = (() => {
    if (cancelled) return <CancelledCard activity={activity} organizer={false} />
    switch (stage) {
      case 'before': return !recruiting ? <div className="m-state gray"><strong>{activity.status === 'FINISHED' ? '끝난 활동이에요' : '신청이 마감됐어요'}</strong></div>
        : <div className="m-state"><strong>{full ? (waitClosed ? '정원이 찼어요' : `정원이 찼어요 · 대기 ${viewer.waiting}명`) : `${seatsLeft(activity)}자리 남았어요`}</strong>
          <span>{full ? (waitClosed ? '시작 2시간 전부터는 대기 신청을 받지 않아요.' : '대기 신청하면 빈자리가 생길 때 순서대로 알려 드려요.') : '신청하면 모집자가 확인한 뒤 알림으로 알려 드려요.'}</span></div>
      case 'waiting': return <div className="m-state amber"><strong>{mine!.status === 'APPLIED' ? '모집자 확인을 기다리고 있어요' : `대기 ${mine!.waitOrder ?? ''}번이에요`}</strong>
        <span>{mine!.status === 'APPLIED' ? '승인되면 알림으로 알려 드려요.' : '빈자리가 생기면 순서대로 자리를 제안해요.'}</span></div>
      case 'offer': return <div className="m-state hot"><strong>빈자리 제안이 왔어요!</strong><span>{mine!.offerExpiresAt ? dayWord(mine!.offerExpiresAt.slice(0, 10)) + ' ' + mine!.offerExpiresAt.slice(11, 16) : ''}까지 수락하면 참가가 확정돼요.</span></div>
      case 'confirmed': return <div className="m-state mint"><span className="m-state-dday">{dDay(activity.date)}</span><strong>참가가 확정됐어요</strong>
        <span>하루 전에 알림을 보내 드려요. 못 가게 되면 미리 알려 주세요.</span></div>
      case 'today': return <div className={'m-state ' + (phase === 'open' || phase === 'late' ? 'hot' : 'mint')}>
        <strong>{phase === 'open' || phase === 'late' ? '지금 체크인할 수 있어요' : `오늘 ${activity.startTime}에 만나요`}</strong>
        <span>{phase === 'open' || phase === 'late' ? `${hhmm(closes)}까지 · 현장에서 모집자의 QR을 찍어 주세요` : `체크인은 ${hhmm(opens)}부터 열려요 · ${activity.meetingPoint ?? activity.placeName ?? ''}`}</span>
        {mine?.lateMinutes ? <em>모집자에게 약 {mine.lateMinutes}분 늦는다고 알렸어요</em> : null}</div>
      case 'checkedin': return <div className="m-state mint"><strong>출석했어요</strong><span>활동이 끝나면 모집자가 완료를 확인하고 기록이 남아요.</span></div>
      case 'done': return <div className="m-state mint"><strong>함께해 주셔서 고마워요!</strong><span>활동 기록이 남았어요. 공식 봉사실적은 아니에요.</span></div>
      default: return <div className="m-state gray"><strong>{statusWord[mine?.status ?? '']?.text ?? '함께하지 못해요'}</strong><span>다른 활동을 찾아보세요.</span></div>
    }
  })()

  const action = (() => {
    if (cancelled) return <a className="m-btn line" href="#/find">다른 활동 찾기</a>
    switch (stage) {
      case 'before': return <button className="m-btn" disabled={!recruiting || busy || (full && waitClosed)} onClick={() => setSheet('safety')}>
        {!recruiting ? '신청 마감' : full ? (waitClosed ? '모집 마감' : '대기 신청하기') : '신청하기'}</button>
      case 'waiting': return <button className="m-btn line" disabled={busy} onClick={() => setSheet('cancel')}>신청 취소</button>
      case 'offer': return <><button className="m-btn line" disabled={busy} onClick={() => act('/api/participations/' + mine!.id + '/decline-offer', undefined, '제안을 거절했어요')}>거절</button>
        <button className="m-btn" disabled={busy} onClick={() => act('/api/participations/' + mine!.id + '/accept-offer', undefined, '참가가 확정됐어요!')}>수락하기</button></>
      case 'confirmed': return <><button className="m-btn line" onClick={() => setSheet('cancel')}>못 가요</button>
        <button className="m-btn" onClick={() => { void addToCalendar(activity).then(way => { if (way === 'file') showToast('캘린더 파일을 받았어요', '열면 휴대폰 캘린더에 추가돼요') }) }}><MIcon name="calendar" size={19} />캘린더에 추가</button></>
      case 'today': return <><button className="m-btn line" onClick={() => setSheet(phase === 'later' || phase === 'soon' ? 'late' : 'late')} disabled={phase === 'ended'}>늦어요</button>
        <button className="m-btn" disabled={!(phase === 'open' || phase === 'late')} onClick={() => setSheet('scan')}><MIcon name="qr" size={19} />{phase === 'open' || phase === 'late' ? 'QR 찍고 체크인' : hhmm(opens) + '부터 체크인'}</button></>
      case 'done': return <><a className="m-btn line" href="#/mine?tab=done">내 기록</a><a className="m-btn" href={'#/write?activity=' + id}><MIcon name="edit" size={19} />후기 쓰기</a></>
      default: return null
    }
  })()

  // Which blocks to show depends on the stage: before applying the full description; once confirmed, what to bring and the news.
  const member = ['confirmed', 'today', 'checkedin', 'done'].includes(stage)
  return <div className={'m-screen m-detail' + (applied ? ' applied' : '')}>
    <TopBar title="" back="history" actions={<button type="button" className="m-icon-btn" aria-label={saved ? '저장 취소' : '저장하기'} aria-pressed={saved} onClick={toggleSave}><MIcon name={saved ? 'bookmarked' : 'bookmark'} /></button>} />
    <div className="m-body">
      {head}
      {statusCard}
      {['confirmed', 'today', 'checkedin', 'done'].includes(stage) && !cancelled && <NewsEntry activityId={id} organizer={false} />}
      {stage === 'today' ? <>
        <dl className="m-facts big"><div><dt><MIcon name="pin" size={20} /></dt><dd><strong>{activity.meetingPoint ?? activity.placeName}</strong><small>{activity.placeName}{activity.placeAddress ? ' · ' + activity.placeAddress : ''}</small></dd></div>
          <div><dt><MIcon name="clock" size={20} /></dt><dd><strong>{activity.startTime} 시작 · {durationLabel(activity.durationMinutes)}</strong><small>체크인 {hhmm(opens)} ~ {hhmm(closes)}</small></dd></div></dl>
        <Supplies activity={activity} />
      </> : <>
        <Facts activity={activity} />
        {member && <Supplies activity={activity} />}
        {!member && <><Supplies activity={activity} /><About text={activity.description} /></>}
        {member && <About text={activity.description} />}
        {stage === 'before' && <div className="m-note"><strong>참여 전 알아두세요</strong>Volink 활동은 공식 봉사실적이 아니며 자원봉사 종합보험이 적용되지 않아요. 위험한 일은 하지 않고, 사고가 나면 먼저 119에 신고해요.</div>}
      </>}
    </div>
    {action && <ActionBar>{action}</ActionBar>}

    {sheet === 'safety' && <Sheet title={full ? '대기 신청할까요?' : '신청할까요?'} onClose={() => setSheet(null)}
      footer={<button className="m-btn" disabled={busy} onClick={() => act('/api/activities/' + id + '/participations', undefined, full ? '대기 신청했어요' : '신청했어요')}>{full ? '대기 신청하기' : '신청하기'}</button>}>
      <div className="m-summary"><strong>{activity.title}</strong><span>{dayWord(activity.date)} {activity.startTime} · {activity.meetingPoint ?? activity.placeName}</span></div>
      <ul className="m-bullets"><li>공식 봉사실적이 아니며 자원봉사 종합보험이 적용되지 않아요.</li><li>연락처는 공개하지 않아요. 궁금한 건 확정 뒤 ‘활동 소식’에서 물어봐요.</li><li>못 가게 되면 꼭 미리 알려 주세요. 다음 사람에게 자리가 넘어가요.</li></ul>
    </Sheet>}
    {sheet === 'cancel' && mine && <CancelSheet confirmed={mine.status === 'CONFIRMED'} busy={busy} onClose={() => setSheet(null)} onSend={reason => act('/api/participations/' + mine.id + '/cancel', reason ? { reason } : {}, mine.status === 'CONFIRMED' ? '모집자에게 못 간다고 알렸어요' : '신청을 취소했어요')} />}
    {sheet === 'late' && mine && <Sheet title="얼마나 늦을까요?" onClose={() => setSheet(null)}>
      <p className="m-help">모집자에게 알림이 가요. 도착하면 QR로 체크인해 주세요 (시작 30분 뒤까지).</p>
      <div className="m-choice">{[10, 20, 30].map(m => <button key={m} type="button" className="m-btn line" disabled={busy} onClick={() => act('/api/participations/' + mine.id + '/late', { minutes: m }, `약 ${m}분 늦는다고 알렸어요`)}>약 {m}분</button>)}</div>
      <button type="button" className="m-text-btn danger" onClick={() => setSheet('cancel')}>아예 못 가요</button>
    </Sheet>}
    {sheet === 'scan' && <ScanSheet codeHref={'#/checkin/' + id} onClose={() => setSheet(null)} />}
  </div>
}

function CancelSheet({ confirmed, busy, onClose, onSend }: { confirmed: boolean; busy: boolean; onClose: () => void; onSend: (reason: string) => void }) {
  const reasons = ['갑자기 일이 생겼어요', '몸이 좋지 않아요', '시간이 맞지 않아요']
  const [reason, setReason] = useState('')
  return <Sheet title={confirmed ? '못 간다고 알릴까요?' : '신청을 취소할까요?'} onClose={onClose}
    footer={<button className="m-btn danger" disabled={busy || (confirmed && reason.trim().length < 2)} onClick={() => onSend(reason.trim())}>{confirmed ? '못 간다고 알리기' : '신청 취소하기'}</button>}>
    <p className="m-help">{confirmed ? '자리는 대기 1번에게 넘어가요 (시작 2시간 전부터는 넘기지 않아요). ' : ''}취소한 활동은 한 번 더 신청할 수 있어요.</p>
    {confirmed && <><span className="m-label">왜 못 가게 됐나요?</span><div className="m-chips wrap">{reasons.map(x => <button key={x} type="button" className={'m-chip' + (reason === x ? ' on' : '')} aria-pressed={reason === x} onClick={() => setReason(x)}>{x}</button>)}</div>
      <label className="m-field"><span className="m-label">취소 사유 <small>필수 · 모집자에게 전해져요</small></span>
        <TextInput className="m-input" maxLength={100} value={reason} placeholder="직접 적기" onChange={event => setReason(event.target.value)} enterKeyHint="done" /></label></>}
  </Sheet>
}

/**
 * Scans the organizer's QR inside the app: camera + the browser's barcode reader, or jsQR on camera frames where
 * the WebView has no barcode reader. Without a camera it says to use the phone camera: the QR is a link to the same check-in.
 */
function ScanSheet({ onClose, codeHref }: { onClose: () => void; codeHref: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'start' | 'on' | 'no'>('start')
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) { setState('no'); return }
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector
    let stream: MediaStream | null = null, timer = 0, stopped = false
    const canvas = document.createElement('canvas')
    const read = async (frame: HTMLVideoElement): Promise<string[]> => {
      if (Detector) return (await new Detector({ formats: ['qr_code'] }).detect(frame)).map(code => code.rawValue)
      const width = frame.videoWidth, height = frame.videoHeight
      if (!width || !height) return []
      const scale = Math.min(1, 640 / Math.max(width, height))
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return []
      context.drawImage(frame, 0, 0, canvas.width, canvas.height)
      const found = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' })
      return found ? [found.data] : []
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(media => {
      if (stopped) { media.getTracks().forEach(t => t.stop()); return }
      stream = media
      if (video.current) { video.current.srcObject = media; video.current.play().catch(() => {}) }
      setState('on')
      const tick = async () => {
        if (stopped || !video.current) return
        try {
          const link = (await read(video.current)).find(value => /#\/checkin\/\d+\?t=/.test(value))
          if (link) { go(link.slice(link.indexOf('#'))); return }
        } catch { /* next frame */ }
        timer = window.setTimeout(tick, 300)
      }
      tick()
    }).catch(() => setState('no'))
    return () => { stopped = true; window.clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()) }
  }, [])
  return <Sheet title="출석 QR 찍기" onClose={onClose} footer={<a className="m-btn line" href={codeHref}>QR이 안 되나요? 출석 코드 4자리 입력</a>}>
    {state === 'no' ? <div className="m-empty"><span className="m-empty-ico"><MIcon name="qr" size={26} /></span><strong>휴대폰 기본 카메라로 찍어 주세요</strong>
      <p>모집자 화면의 QR을 카메라로 찍으면 체크인 화면이 열려요. 위치 확인을 허용해 주세요.</p></div>
      : <div className="m-scan"><video ref={video} playsInline muted aria-label="카메라 화면" /><span className="m-scan-frame" aria-hidden="true" />
        <p>{state === 'start' ? '카메라를 여는 중…' : '모집자 화면의 QR을 네모 안에 맞춰 주세요'}</p></div>}
  </Sheet>
}

// ---------------------------------------------------------------- organizer dashboard

type ManageTab = 'people' | 'attendance' | 'news' | 'ops'
type PeopleFilter = 'ALL' | 'APPLIED' | 'CONFIRMED' | 'WAITING'
const manualReasons = ['위치 권한을 허용하지 않음', 'GPS가 잡히지 않음', 'QR을 찍을 수 없는 휴대폰', '현장에서 얼굴로 확인함']

export function ManageScreen({ id, user, onChange, initial }: { id: number; user: User; onChange: () => void; initial?: string }) {
  const now = useNow(15_000)
  const [activity, setActivity] = useState<LiveActivity | null>(null)
  const [people, setPeople] = useState<{ capacity: number; confirmed: number; waiting: number; pending: number; items: Applicant[] } | null>(null)
  const [thread, setThread] = useState<Thread | null>(null)
  const unanswered = thread?.unanswered ?? 0
  const [tab, setTab] = useState<ManageTab>(initial === 'attendance' || initial === 'news' || initial === 'ops' ? initial : 'people')
  const [filter, setFilter] = useState<PeopleFilter>('ALL')
  const [sheet, setSheet] = useState<'menu' | 'cancel' | 'move' | 'delete' | null>(null)
  const [manual, setManual] = useState<Applicant | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  const load = useCallback(() => {
    api<LiveActivity>('/api/activities/' + id).then(a => { if (a.organizerId !== user.id) { window.location.replace('#/activity/' + id); return } setActivity(a); setFailed('') })
      .catch(cause => setFailed(gone(cause) ? '활동을 찾을 수 없어요.' : ''))
    api<typeof people>('/api/activities/' + id + '/participations').then(setPeople).catch(() => {})
    api<Thread>('/api/activities/' + id + '/posts').then(setThread).catch(() => {})
  }, [id, user.id])
  useEffect(() => { load() }, [load])
  // Every 30 s while the screen is shown, and again when the app comes back to the front.
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) load() }, 30_000)
    const back = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', back)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', back) }
  }, [load])

  if (failed) return <div className="m-screen"><TopBar title="모집 관리" back="#/mine?tab=host" /><div className="m-body"><div className="m-note bad">{failed}</div></div></div>
  if (!activity) return <div className="m-screen"><TopBar title="모집 관리" back="#/mine?tab=host" /><Loading /></div>
  const { phase, opens } = phaseOf(activity.date, activity.startTime, activity.durationMinutes, now)
  const start = new Date(`${activity.date}T${activity.startTime}:00+09:00`).getTime()
  const items = people?.items ?? []
  const count = (s: string) => items.filter(p => p.status === s).length
  const checked = count('CHECKED_IN')
  const open = ['RECRUITING', 'DRAFT'].includes(activity.status) && now < start
  const canMove = activity.status === 'RECRUITING' && (activity.rescheduleCount ?? 0) === 0 && start - now >= 24 * 3_600_000
  const statusText = activity.status === 'DRAFT' ? (activity.reviewNote ? '반려됨' : '관리자 검토 중') : activity.status === 'RECRUITING' ? (phase === 'open' || phase === 'late' ? '체크인 중' : '모집 중') : activity.status === 'IN_PROGRESS' ? '진행 중' : activity.status === 'FINISHED' ? '종료' : '취소됨'

  async function run(path: string, body: object | undefined, done: string, after?: () => void) {
    setBusy(true)
    try {
      await api(path, 'POST', body)
      showToast(done)
      after?.()
      setSheet(null)
      load()
      onChange()
    } catch (cause) {
      showToast(message(cause))
    } finally {
      setBusy(false)
    }
  }

  async function toggleAuto(on: boolean) {
    setBusy(true)
    try {
      const result = await api<{ confirmed: number }>('/api/activities/' + id + '/auto-approve', 'PUT', { on })
      showToast(on ? (result.confirmed ? `자동 승인을 켰어요 · ${result.confirmed}명 확정` : '자동 승인을 켰어요') : '자동 승인을 껐어요 · 신청을 직접 승인해요')
      load()
      onChange()
    } catch (cause) { showToast(message(cause)) } finally { setBusy(false) }
  }

  const waitingCount = count('WAITLISTED') + count('OFFERED')
  const confirmedNow = people?.confirmed ?? activity.confirmed
  const tabs: [ManageTab, string, number][] = [['people', '신청자', count('APPLIED')], ['attendance', '출석', 0], ['news', '소식', unanswered], ['ops', '운영', 0]]
  const filters: [PeopleFilter, string, number][] = [['ALL', '전체', items.length], ['APPLIED', '승인 대기', count('APPLIED')],
    ['CONFIRMED', '확정', items.filter(p => ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(p.status)).length], ['WAITING', '대기자', waitingCount]]
  const shown = items.filter(p => filter === 'ALL' || (filter === 'APPLIED' ? p.status === 'APPLIED' : filter === 'WAITING' ? ['WAITLISTED', 'OFFERED'].includes(p.status) : ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(p.status)))
  // The bottom button only for what the moment needs: check-in time (QR), after the end (complete all), re-recruit.
  const main = (() => {
    if (activity.status === 'CANCELLED' || tab === 'news') return null
    if (phase === 'open' || phase === 'late') return tab === 'attendance' ? null : <button className="m-btn" onClick={() => setTab('attendance')}><MIcon name="qr" size={19} />{phase === 'open' ? '출석부 · QR 띄우기' : '출석부 열기'}</button>
    if (phase === 'ended' && checked > 0) return <button className="m-btn" disabled={busy} onClick={() => run('/api/activities/' + id + '/complete', undefined, `${checked}명 완료를 확인했어요`)}>체크인한 {checked}명 모두 완료</button>
    if (phase === 'ended') return <a className="m-btn line" href={'#/create?from=' + id}><MIcon name="refresh" size={19} />같은 활동 다시 모집</a>
    return null
  })()
  const dday = dDay(activity.date)

  return <div className="m-screen m-manage">
    <TopBar title="모집 관리" back="#/mine?tab=host" actions={<button type="button" className="m-icon-btn" aria-label="활동 메뉴" onClick={() => setSheet('menu')}><MIcon name="more" /></button>} />
    <div className="m-body mg">
      <section className="mg-head">
        <div className="mg-state"><span className={'m-badge ' + (activity.status === 'RECRUITING' ? 'mint' : activity.status === 'DRAFT' ? 'amber' : activity.status === 'CANCELLED' ? 'hot' : 'gray')}>{statusText}</span>
          {dday && activity.status !== 'CANCELLED' && phase !== 'ended' && <small>{dday === 'D-DAY' ? '오늘 활동' : '활동까지 ' + dday.slice(2) + '일'}</small>}</div>
        <h1>{activity.title}</h1>
        <p className="mg-fact"><MIcon name="calendar" size={17} />{dayWord(activity.date)} {activity.startTime} · {durationLabel(activity.durationMinutes)}</p>
        <p className="mg-fact"><MIcon name="pin" size={17} />{[activity.placeName, activity.meetingPoint].filter(Boolean).join(' · ')}</p>
        {activity.status === 'CANCELLED' && (activity.cancellation ? <CancelledCard activity={activity} organizer /> : <div className="m-state bad"><strong>취소된 활동이에요</strong><span>{activity.cancelReason ?? activity.reviewNote}</span></div>)}
        {activity.status === 'DRAFT' && <div className="m-state amber"><strong>{activity.reviewNote ? '관리자가 반려했어요' : '관리자 확인 후 공개돼요'}</strong><span>{activity.reviewNote ?? activity.riskReasons ?? ''}</span></div>}
        <div className="mg-prog" aria-label={`확정 ${confirmedNow}명, 정원 ${activity.capacity}명`}>
          <div><b>확정 {confirmedNow}<small> / {activity.capacity}명</small></b><span>{Math.max(0, activity.capacity - confirmedNow) ? `${Math.max(0, activity.capacity - confirmedNow)}자리 남음` : '정원 마감'} · 대기 {waitingCount}명</span></div>
          <i><em style={{ width: Math.min(100, confirmedNow / Math.max(1, activity.capacity) * 100) + '%' }} /></i>
        </div>
      </section>

      <div className="mg-tabs" role="tablist" aria-label="관리 화면">{tabs.map(([key, label, badge]) =>
        <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{label}{badge > 0 && <i>{badge}</i>}</button>)}</div>

      {tab === 'people' && <section className="mg-panel" aria-label="신청자">
        {activity.status === 'RECRUITING' && phase !== 'ended' && <label className="m-switch m-auto mg-plain">
          <span><strong>자동 승인</strong><small>{activity.autoApprove ? '빈자리가 있으면 신청이 바로 확정돼요' : '켜면 빈자리만큼 신청이 바로 확정돼요'}</small></span>
          <input type="checkbox" role="switch" checked={Boolean(activity.autoApprove)} disabled={busy} onChange={event => toggleAuto(event.target.checked)} /><i /></label>}
        {!people ? <Loading /> : items.length === 0 ? <div className="mg-empty"><MIcon name="users" size={24} /><strong>아직 신청자가 없어요</strong><span>신청이 들어오면 알림으로 알려 드려요.</span></div> : <>
          <div className="mg-filter" role="group" aria-label="신청자 보기">{filters.map(([key, label, n]) =>
            <button key={key} type="button" className={filter === key ? 'on' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label} {n}</button>)}</div>
          {shown.length === 0 ? <p className="mg-none">해당하는 신청자가 없어요.</p> : <ul className="m-people mg-people">{shown.map(p => <li key={p.id}>
            <span className="m-avatar sm"><MIcon name="user" size={18} /></span>
            <span className="m-people-main"><strong>{p.name}{p.lateMinutes ? <em className="m-badge amber">{p.lateMinutes}분 늦음</em> : null}</strong>
              <small>{p.checkInMethod ? (p.checkInMethod === 'QR' ? 'QR·위치 확인' : '수동 확인') + (p.checkedInAt ? ' ' + p.checkedInAt : '') + (p.checkInReason ? ' · ' + p.checkInReason : '') : '신청 ' + p.appliedAt}</small></span>
            <span className="m-people-act">
              {p.status === 'APPLIED' && phase !== 'ended' ? <><button className="m-btn xs line" disabled={busy} onClick={() => run('/api/participations/' + p.id + '/reject', {}, p.name + ' 님 신청을 거절했어요')}>거절</button>
                <button className="m-btn xs" disabled={busy} onClick={() => run('/api/participations/' + p.id + '/approve', {}, p.name + ' 님 참가를 확정했어요')}>승인</button></>
                : p.status === 'CONFIRMED' && (phase === 'open' || phase === 'late') ? <button className="m-btn xs line" onClick={() => setManual(p)}>수동 확인</button>
                : p.status === 'CHECKED_IN' && phase === 'ended' ? <button className="m-btn xs" disabled={busy} onClick={() => run('/api/participations/' + p.id + '/complete', {}, p.name + ' 님 완료를 확인했어요')}>완료 확인</button>
                : <span className={'mg-status ' + (statusWord[p.status]?.tone ?? 'gray')}>{p.status === 'WAITLISTED' ? `대기 ${p.waitOrder}번` : statusWord[p.status]?.text ?? p.status}</span>}
            </span></li>)}</ul>}
        </>}
      </section>}

      {tab === 'attendance' && <section className="mg-panel" aria-label="출석">{people ? <RollCall activity={activity} people={items} phase={phase as Phase} opens={opens} onChanged={load} /> : <Loading />}</section>}

      {tab === 'news' && (activity.status === 'DRAFT' ? <p className="mg-none mg-panel">관리자 확인 뒤 공개되면 소식을 올릴 수 있어요.</p>
        : <div className="mg-panel"><NewsScreen id={id} user={user} embedded onChanged={() => api<Thread>('/api/activities/' + id + '/posts').then(setThread).catch(() => {})} /></div>)}

      {tab === 'ops' && <section className="mg-panel" aria-label="운영"><nav className="mg-ops">
        {open && <a href={'#/edit/' + id}><MIcon name="edit" size={20} /><span>활동 정보 수정<small>{(activity.applicants ?? 0) > 0 ? '신청자가 있어 소개·만나는 곳만 바꿀 수 있어요' : '모든 정보를 바꿀 수 있어요'}</small></span><MIcon name="chevron" size={18} /></a>}
        {open && <button type="button" disabled={!canMove} onClick={() => setSheet('move')}><MIcon name="calendar" size={20} /><span>일정 변경<small>{(activity.rescheduleCount ?? 0) > 0 ? '이미 한 번 바꿨어요' : !canMove ? '시작 24시간 전까지만 바꿀 수 있어요' : '한 번만, 시작 24시간 전까지 · 신청자에게 알려요'}</small></span><MIcon name="chevron" size={18} /></button>}
        {activity.status === 'RECRUITING' && now < start && <a href={'#/write?category=PROMO&activity=' + id}><MIcon name="megaphone" size={20} /><span>커뮤니티에 홍보하기<small>이 모집글을 커뮤니티에 소개해요 · [바로 신청하기] 카드</small></span><MIcon name="chevron" size={18} /></a>}
        <a href={'#/create?from=' + id}><MIcon name="refresh" size={20} /><span>같은 내용으로 다시 모집<small>날짜만 새로 골라요</small></span><MIcon name="chevron" size={18} /></a>
        {open && (activity.applicants ?? 0) === 0 && <button type="button" onClick={() => setSheet('delete')}><MIcon name="trash" size={20} /><span>활동 삭제<small>아직 신청한 사람이 없어 바로 지울 수 있어요</small></span><MIcon name="chevron" size={18} /></button>}
        {open && checked === 0 && (activity.applicants ?? 0) > 0 && <button type="button" className="danger" onClick={() => setSheet('cancel')}><MIcon name="alert" size={20} /><span>활동 취소하기<small>참가자 모두에게 사유와 함께 알려요</small></span><MIcon name="chevron" size={18} /></button>}
      </nav></section>}
    </div>
    {main && <ActionBar>{main}</ActionBar>}

    {sheet === 'menu' && <Sheet title="활동 관리" onClose={() => setSheet(null)}>
      <nav className="m-menu flat">
        {open && <a href={'#/edit/' + id}><MIcon name="edit" size={20} /><span>{(activity.applicants ?? 0) > 0 ? '소개·만나는 곳 고치기' : '활동 고치기'}</span><MIcon name="chevron" size={18} /></a>}
        {open && <button type="button" disabled={!canMove} onClick={() => setSheet('move')}><MIcon name="calendar" size={20} /><span>일정 바꾸기</span><small>{(activity.rescheduleCount ?? 0) > 0 ? '이미 한 번 바꿨어요' : !canMove ? '시작 24시간 전까지만' : '한 번만 가능'}</small><MIcon name="chevron" size={18} /></button>}
        <a href={'#/create?from=' + id}><MIcon name="refresh" size={20} /><span>같은 내용으로 다시 모집</span><MIcon name="chevron" size={18} /></a>
        {open && (activity.applicants ?? 0) === 0 && <button type="button" onClick={() => setSheet('delete')}><MIcon name="trash" size={20} /><span>활동 삭제</span><MIcon name="chevron" size={18} /></button>}
        {open && checked === 0 && (activity.applicants ?? 0) > 0 && <button type="button" className="danger" onClick={() => setSheet('cancel')}><MIcon name="alert" size={20} /><span>활동 취소</span><small>참가자 모두에게 알려요</small><MIcon name="chevron" size={18} /></button>}
      </nav>
    </Sheet>}
    {sheet === 'cancel' && <ActivityCancelSheet activity={activity} counts={{ confirmed: count('CONFIRMED'), waiting: count('WAITLISTED') + count('OFFERED'), applied: count('APPLIED') }} busy={busy}
      onClose={() => setSheet(null)} onSend={async body => {
        setBusy(true)
        try {
          await api('/api/activities/' + id + '/cancel', 'POST', body)
          showToast('활동을 취소했어요', '참가자에게 취소 안내를 보냈어요')
          setSheet(null)
        } catch (cause) {
          // Already cancelled, or the answer was lost on the way: read the activity again instead of sending twice.
          if (cause instanceof ApiError && cause.code !== 'ALREADY_CANCELLED') showToast(message(cause))
          else showToast(cause instanceof ApiError ? '이미 취소된 활동이에요' : '결과를 확인하고 있어요', '활동 상태를 다시 불러왔어요')
          if (!(cause instanceof ApiError) || cause.code === 'ALREADY_CANCELLED') setSheet(null)
        } finally { setBusy(false); load(); onChange() }
      }} />}
    {sheet === 'delete' && <Sheet title="활동을 삭제할까요?" onClose={() => setSheet(null)} footer={<button className="m-btn danger" disabled={busy} onClick={async () => {
      setBusy(true); try { await api('/api/activities/' + id, 'DELETE'); showToast('활동을 삭제했어요'); go('#/host') } catch (cause) { showToast(message(cause)) } finally { setBusy(false) } }}>삭제하기</button>}>
      <p className="m-help">아직 신청한 사람이 없어서 바로 지울 수 있어요. 되돌릴 수 없어요.</p></Sheet>}
    {sheet === 'move' && <RescheduleSheet activity={activity} busy={busy} onClose={() => setSheet(null)} onSend={body => run('/api/activities/' + id + '/reschedule', body, '일정을 바꾸고 신청자에게 알렸어요')} />}
    {manual && <Sheet title={manual.name + ' 님 수동 확인'} onClose={() => setManual(null)}>
      <ManualForm busy={busy} onSend={reason => run('/api/participations/' + manual.id + '/manual-check-in', { reason }, manual.name + ' 님 출석을 확인했어요', () => setManual(null))} />
    </Sheet>}
  </div>
}

function ManualForm({ busy, onSend }: { busy: boolean; onSend: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  return <>
    <p className="m-help">QR·위치로 확인하지 못한 사람을 직접 확인해요. 사유는 기록에 남아요.</p>
    <div className="m-chips wrap">{manualReasons.map(x => <button key={x} type="button" className={'m-chip' + (reason === x ? ' on' : '')} aria-pressed={reason === x} onClick={() => setReason(x)}>{x}</button>)}</div>
    <label className="m-field"><span className="m-label">사유</span><TextInput className="m-input" maxLength={500} value={reason} placeholder="직접 적기" onChange={event => setReason(event.target.value)} enterKeyHint="done" /></label>
    <button className="m-btn" disabled={busy || !reason.trim()} onClick={() => onSend(reason.trim())}>출석 확인</button>
  </>
}

const cancelReasons: [string, string, string][] = [
  ['PERSONAL', '모집자의 개인 사정', '모집자에게 피치 못할 사정이 생겨 활동을 진행할 수 없게 되었어요. 참여에 불편을 드려 죄송합니다.'],
  ['WEATHER', '기상 악화 및 안전 문제', '기상 악화로 안전하게 활동하기 어려워 취소합니다. 참여에 불편을 드려 죄송합니다.'],
  ['PLACE', '장소·시설 이용 불가', '활동 장소를 이용할 수 없게 되어 취소합니다. 참여에 불편을 드려 죄송합니다.'],
  ['STAFF', '운영 인력 부족', '운영 인력이 부족해 활동을 안전하게 진행하기 어려워 취소합니다. 참여에 불편을 드려 죄송합니다.'],
  ['OTHER', '기타 사유', ''],
]

/**
 * Organizer's emergency cancellation: who is affected, a reason (required), a message for participants (suggested,
 * editable, required), what happens, a tick, a preview of the notification, then a final confirmation. Nothing is
 * sent before "활동 취소 확정"; the button cannot be pressed twice.
 */
function ActivityCancelSheet({ activity, counts, busy, onClose, onSend }: { activity: LiveActivity; counts: { confirmed: number; waiting: number; applied: number }; busy: boolean; onClose: () => void; onSend: (body: { reasonCode: string; message: string }) => void }) {
  const [code, setCode] = useState('')
  const [text, setText] = useState('')
  const [touched, setTouched] = useState(false)
  const [agree, setAgree] = useState(false)
  const [step, setStep] = useState<'form' | 'confirm'>('form')
  const label = cancelReasons.find(r => r[0] === code)?.[1] ?? ''
  const message = text.trim()
  const ok = Boolean(code) && message.length >= 5 && message.length <= 300 && agree
  const people = counts.confirmed + counts.waiting + counts.applied
  const pick = (value: string) => {
    const before = cancelReasons.find(r => r[0] === code)?.[2] ?? ''
    setCode(value)
    // Suggest the matching sentence unless the organizer already wrote their own.
    if (!text.trim() || text === before) setText(cancelReasons.find(r => r[0] === value)?.[2] ?? '')
  }
  const when = `${dayWord(activity.date)} ${activity.startTime}`
  if (step === 'confirm') return <Sheet title="정말 취소할까요?" onClose={() => setStep('form')}
    footer={<div className="m-two"><button type="button" className="m-btn line" disabled={busy} onClick={() => setStep('form')}>돌아가기</button>
      <button type="button" className="m-btn danger" disabled={busy} onClick={() => onSend({ reasonCode: code, message })}>{busy ? '취소하는 중…' : '활동 취소 확정'}</button></div>}>
    <div className="m-cancel-warn" role="alert">
      <MIcon name="alert" size={22} />
      <p>{people > 0 ? <>현재 확정 참가자 <b>{counts.confirmed}명</b>, 대기자 <b>{counts.waiting}명</b>{counts.applied ? <>, 승인 대기 <b>{counts.applied}명</b></> : null}이 있어요.<br /></> : <>아직 참가자가 없어요.<br /></>}
        활동을 취소하면 {people > 0 ? '모든 참가자에게 취소 사실이 안내되고 ' : ''}새로운 신청이 중단돼요. 취소된 활동은 기록으로 남고 되돌릴 수 없어요.</p>
    </div>
  </Sheet>
  return <Sheet title="활동을 취소하시겠어요?" onClose={onClose}
    footer={<button type="button" className="m-btn danger" disabled={!ok} onClick={() => setStep('confirm')}>{!code ? '취소 사유를 골라 주세요' : message.length < 5 ? '안내를 적어 주세요' : !agree ? '확인에 체크해 주세요' : '다음'}</button>}>
    <div className="m-cancel-sum"><strong>{activity.title}</strong><span>{when}</span>
      <small><MIcon name="users" size={15} />확정 {counts.confirmed}명 · 대기 {counts.waiting}명{counts.applied ? ` · 승인 대기 ${counts.applied}명` : ''}</small></div>
    <fieldset className="m-fsec"><legend className="m-label">취소 사유 <small>필수</small></legend>
      <div className="m-radios" role="radiogroup">{cancelReasons.map(([value, text]) => <label key={value} className={code === value ? 'on' : ''}>
        <input type="radio" name="cancel-reason" checked={code === value} onChange={() => pick(value)} /><i aria-hidden="true" />{text}</label>)}</div></fieldset>
    <label className="m-field"><span className="m-label">참가자에게 전달할 안내 <small>필수 · 5~300자</small></span>
      <TextArea className="m-input" rows={4} maxLength={300} value={text} placeholder="참가자에게 취소 사유를 안내해 주세요." onChange={event => setText(event.target.value)} onBlur={() => setTouched(true)} />
      <span className="m-help">개인정보나 자세한 개인 사정은 적지 않아도 돼요. 연락처는 적을 수 없어요.</span>
      {touched && message.length < 5 && <span className="m-err">안내를 5자 이상 적어 주세요.</span>}</label>
    <div className="m-note"><strong>취소하면 이렇게 처리돼요</strong>
      <ul className="m-dots"><li>확정·대기·승인 대기 중인 참가자에게 취소 알림이 가요.</li><li>새로운 참가 신청과 대기자 자리 제안이 멈춰요.</li><li>모집글과 신청·취소 기록은 지우지 않고 남겨요.</li></ul></div>
    {code && message.length >= 5 && <div className="m-cancel-preview" aria-label="취소 안내 미리보기"><small>참가자가 받는 알림</small>
      <strong>봉사활동이 취소되었어요</strong><span>{activity.title} 활동이 {label}(으)로 취소되었습니다. 자세한 내용을 확인해 주세요.</span>
      <small>활동 화면 안내</small><span>“{message}”</span></div>}
    <label className="m-check box"><input type="checkbox" checked={agree} onChange={event => setAgree(event.target.checked)} /><span className="m-box" /><span>취소로 인해 참가자에게 영향이 생긴다는 점을 확인했어요.</span></label>
  </Sheet>
}

/** A cancelled activity: what the organizer said, when, and (for the organizer) who it affected. */
function CancelledCard({ activity, organizer }: { activity: LiveActivity; organizer: boolean }) {
  const c = activity.cancellation
  return <div className="m-cancelled" role="status">
    <span className="m-badge red">{organizer ? '취소됨' : '모집자에 의해 취소됨'}</span>
    <strong><MIcon name="alert" size={18} />활동 취소 안내</strong>
    <p>{c ? `${c.reasonLabel}(으)로 활동이 취소되었습니다.` : '모집자가 활동을 취소했어요.'}</p>
    {(c?.message ?? activity.cancelReason) && <p className="m-cancelled-msg">“{c?.message ?? activity.cancelReason}”</p>}
    <small>원래 일정 {dayWord(activity.date)} {activity.startTime}{c ? ` · 취소 ${c.cancelledAt.slice(5).replace('-', '/')}` : ''}</small>
    {organizer && c && c.confirmedCount != null && <small>취소 당시 확정 {c.confirmedCount}명 · 대기 {c.waitingCount}명 · 승인 대기 {c.appliedCount}명</small>}
    {!organizer && <a className="m-btn line sm" href="#/find">다른 봉사활동 찾아보기</a>}
  </div>
}

function RescheduleSheet({ activity, busy, onClose, onSend }: { activity: LiveActivity; busy: boolean; onClose: () => void; onSend: (body: object) => void }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  const shift = (n: number) => { const d = new Date(today + 'T12:00:00+09:00'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
  const [date, setDate] = useState(activity.date)
  const [time, setTime] = useState(activity.startTime)
  const [duration, setDuration] = useState(activity.durationMinutes)
  const [reason, setReason] = useState('')
  const [pick, setPick] = useState<'date' | 'time' | 'duration' | null>(null)
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const lengths: number[] = []
  for (let v = r.durationMin; v <= Math.min(r.durationMax, toMin(r.latestEnd) - toMin(time)); v += 10) lengths.push(v)
  const same = date === activity.date && time === activity.startTime && duration === activity.durationMinutes
  return <Sheet title="일정 바꾸기" onClose={onClose} footer={<button className="m-btn" disabled={busy || same || reason.trim().length < 2} onClick={() => onSend({ date, time, durationMinutes: duration, reason: reason.trim() })}>바꾸고 알리기</button>}>
    <div className="m-note warm"><strong>한 번만 바꿀 수 있어요</strong>확정된 사람은 그대로 참가로 남고, 모두에게 알림이 가요. 시간이 안 맞는 사람은 취소할 수 있어요.</div>
    <p className="m-help">지금: {dayWord(activity.date)} {activity.startTime} · {durationLabel(activity.durationMinutes)}</p>
    <PickField label="새 날짜" icon="calendar" value={dayWord(date)} onOpen={() => setPick('date')} />
    <div className="m-two"><PickField label="시작" icon="clock" value={time} onOpen={() => setPick('time')} /><PickField label="활동 시간" icon="timer" value={durationLabel(duration)} onOpen={() => setPick('duration')} /></div>
    <label className="m-field"><span className="m-label">바꾸는 이유 <small>참가자에게 보여요</small></span>
      <TextInput className="m-input" maxLength={200} value={reason} placeholder="예: 장소 사정으로 오후로 옮겨요" onChange={event => setReason(event.target.value)} enterKeyHint="done" /></label>
    {pick === 'date' && <DateSheet value={date} first={shift(1)} last={shift(r.maxDaysAhead)} onClose={() => setPick(null)} onPick={value => { setDate(value); setPick(null) }} />}
    {pick === 'time' && <TimeSheet value={time} onClose={() => setPick(null)} onPick={value => { setTime(value); setPick(null) }} />}
    {pick === 'duration' && <DurationSheet value={duration} start={time} options={lengths} onClose={() => setPick(null)} onPick={value => { setDuration(value); setPick(null) }} />}
  </Sheet>
}
