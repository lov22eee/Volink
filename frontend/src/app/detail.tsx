// Activity detail for a participant, shown by state: 신청 전 / 대기 중 / 확정 후 / 활동 당일 / 완료 후.
// The organizer gets a dashboard instead (ManageScreen): 신청자 / 소식 / 출석, with schedule change and cancel.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import type { Applicant, LiveActivity, User, ViewerInfo } from '../api'
import { showToast } from '../App'
import { AttendancePanel, hhmm, phaseOf, useNow } from '../checkin'
import type { Phase } from '../checkin'
import { durationLabel } from '../create'
import { ActivityNews } from '../news'
import { activityRules as r } from '../rules'
import { addToCalendar, difficultyLabel, fieldIcon, isNewcomer, placeKindLabel, seatsLeft } from './cards'
import { DateSheet, DurationSheet, TimeSheet } from './host'
import { statusWord } from './mine'
import { ActionBar, dayWord, dDay, go, Loading, MIcon, PickField, Sheet, TopBar } from './ui'

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
    }).catch(() => setFailed('활동을 찾을 수 없어요. 삭제됐거나 비공개일 수 있어요.'))
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

  const head = <section className="m-detail-head">
    <span className={'m-cover f' + (['환경 정화', '생활 지원', '지역 돌봄'].indexOf(activity.category) + 1)}><MIcon name={fieldIcon[activity.category] ?? 'sprout'} size={34} /></span>
    <Labels activity={activity} />
    <h1>{activity.title}</h1>
    <p className="m-by">{activity.activityType === 'INSTITUTION' ? activity.organizationName : activity.organizerName + ' 님'}이 모집해요</p>
  </section>

  // One card at the top that says where I am now and what happens next.
  const statusCard = (() => {
    if (cancelled) return <div className="m-state bad"><strong>모집자가 활동을 취소했어요</strong><span>{activity.cancelReason ?? '취소 이유가 없어요.'}</span></div>
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
        <button className="m-btn" onClick={() => { addToCalendar(activity); showToast('캘린더 파일을 받았어요', '열면 휴대폰 캘린더에 추가돼요') }}><MIcon name="calendar" size={19} />캘린더에 추가</button></>
      case 'today': return <><button className="m-btn line" onClick={() => setSheet(phase === 'later' || phase === 'soon' ? 'late' : 'late')} disabled={phase === 'ended'}>늦어요</button>
        <button className="m-btn" disabled={!(phase === 'open' || phase === 'late')} onClick={() => setSheet('scan')}><MIcon name="qr" size={19} />{phase === 'open' || phase === 'late' ? 'QR 찍고 체크인' : hhmm(opens) + '부터 체크인'}</button></>
      case 'done': return <><a className="m-btn line" href="#/mine?tab=done">내 기록</a><a className="m-btn" href={'#/write?activity=' + id}><MIcon name="edit" size={19} />후기 쓰기</a></>
      default: return null
    }
  })()

  // Which blocks to show depends on the stage: before applying the full description; once confirmed, what to bring and the news.
  const member = ['confirmed', 'today', 'checkedin', 'done'].includes(stage)
  return <div className="m-screen m-detail">
    <TopBar title="" back="history" actions={<button type="button" className="m-icon-btn" aria-label={saved ? '저장 취소' : '저장하기'} aria-pressed={saved} onClick={toggleSave}><MIcon name={saved ? 'bookmarked' : 'bookmark'} /></button>} />
    <div className="m-body">
      {head}
      {statusCard}
      {stage === 'today' ? <>
        <dl className="m-facts big"><div><dt><MIcon name="pin" size={20} /></dt><dd><strong>{activity.meetingPoint ?? activity.placeName}</strong><small>{activity.placeName}{activity.placeAddress ? ' · ' + activity.placeAddress : ''}</small></dd></div>
          <div><dt><MIcon name="clock" size={20} /></dt><dd><strong>{activity.startTime} 시작 · {durationLabel(activity.durationMinutes)}</strong><small>체크인 {hhmm(opens)} ~ {hhmm(closes)}</small></dd></div></dl>
        <Supplies activity={activity} />
        <div className="m-legacy"><ActivityNews activityId={id} organizer={false} /></div>
      </> : <>
        <Facts activity={activity} />
        {member && <Supplies activity={activity} />}
        {member && <div className="m-legacy"><ActivityNews activityId={id} organizer={false} /></div>}
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
    {sheet === 'scan' && <ScanSheet onClose={() => setSheet(null)} />}
  </div>
}

function CancelSheet({ confirmed, busy, onClose, onSend }: { confirmed: boolean; busy: boolean; onClose: () => void; onSend: (reason: string) => void }) {
  const reasons = ['갑자기 일이 생겼어요', '몸이 좋지 않아요', '시간이 맞지 않아요']
  const [reason, setReason] = useState('')
  return <Sheet title={confirmed ? '못 간다고 알릴까요?' : '신청을 취소할까요?'} onClose={onClose}
    footer={<button className="m-btn danger" disabled={busy} onClick={() => onSend(reason.trim())}>{confirmed ? '못 간다고 알리기' : '신청 취소하기'}</button>}>
    <p className="m-help">{confirmed ? '자리는 대기 1번에게 넘어가요 (시작 2시간 전부터는 넘기지 않아요). ' : ''}취소한 활동은 한 번 더 신청할 수 있어요.</p>
    {confirmed && <><div className="m-chips wrap">{reasons.map(x => <button key={x} type="button" className={'m-chip' + (reason === x ? ' on' : '')} aria-pressed={reason === x} onClick={() => setReason(x)}>{x}</button>)}</div>
      <label className="m-field"><span className="m-label">모집자에게 한마디 <small>선택 · 100자</small></span>
        <input className="m-input" maxLength={100} value={reason} placeholder="직접 적기" onChange={event => setReason(event.target.value)} enterKeyHint="done" /></label></>}
  </Sheet>
}

/**
 * Scans the organizer's QR inside the app (camera + the browser's barcode reader). When the phone cannot do that,
 * it says to use the phone camera instead: the QR is a link that opens the same check-in.
 */
function ScanSheet({ onClose }: { onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'start' | 'on' | 'no'>('start')
  useEffect(() => {
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector
    if (!Detector || !navigator.mediaDevices?.getUserMedia) { setState('no'); return }
    let stream: MediaStream | null = null, timer = 0, stopped = false
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(media => {
      if (stopped) { media.getTracks().forEach(t => t.stop()); return }
      stream = media
      if (video.current) { video.current.srcObject = media; video.current.play().catch(() => {}) }
      setState('on')
      const detector = new Detector({ formats: ['qr_code'] })
      const tick = async () => {
        if (stopped || !video.current) return
        try {
          const found = await detector.detect(video.current)
          const link = found.map(code => code.rawValue).find(value => /#\/checkin\/\d+\?t=/.test(value))
          if (link) { go(link.slice(link.indexOf('#'))); return }
        } catch { /* next frame */ }
        timer = window.setTimeout(tick, 300)
      }
      tick()
    }).catch(() => setState('no'))
    return () => { stopped = true; window.clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()) }
  }, [])
  return <Sheet title="출석 QR 찍기" onClose={onClose}>
    {state === 'no' ? <div className="m-empty"><span className="m-empty-ico"><MIcon name="qr" size={26} /></span><strong>휴대폰 기본 카메라로 찍어 주세요</strong>
      <p>모집자 화면의 QR을 카메라로 찍으면 체크인 화면이 열려요. 위치 확인을 허용해 주세요.</p></div>
      : <div className="m-scan"><video ref={video} playsInline muted aria-label="카메라 화면" /><span className="m-scan-frame" aria-hidden="true" />
        <p>{state === 'start' ? '카메라를 여는 중…' : '모집자 화면의 QR을 네모 안에 맞춰 주세요'}</p></div>}
  </Sheet>
}

// ---------------------------------------------------------------- organizer dashboard

type ManageTab = 'people' | 'news' | 'attendance'
const manualReasons = ['위치 권한을 허용하지 않음', 'GPS가 잡히지 않음', 'QR을 찍을 수 없는 휴대폰', '현장에서 얼굴로 확인함']

export function ManageScreen({ id, user, onChange, initial }: { id: number; user: User; onChange: () => void; initial?: string }) {
  const now = useNow(15_000)
  const [activity, setActivity] = useState<LiveActivity | null>(null)
  const [people, setPeople] = useState<{ capacity: number; confirmed: number; waiting: number; pending: number; items: Applicant[] } | null>(null)
  const [unanswered, setUnanswered] = useState(0)
  const [tab, setTab] = useState<ManageTab>(initial === 'news' || initial === 'attendance' ? initial : 'people')
  const [sheet, setSheet] = useState<'menu' | 'cancel' | 'move' | 'delete' | null>(null)
  const [manual, setManual] = useState<Applicant | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  const load = useCallback(() => {
    api<LiveActivity>('/api/activities/' + id).then(a => { if (a.organizerId !== user.id) { window.location.replace('#/activity/' + id); return } setActivity(a) }).catch(() => setFailed('활동을 찾을 수 없어요.'))
    api<typeof people>('/api/activities/' + id + '/participations').then(setPeople).catch(() => setPeople(null))
    api<{ unanswered: number }>('/api/activities/' + id + '/posts').then(data => setUnanswered(data.unanswered)).catch(() => {})
  }, [id, user.id])
  useEffect(() => { load() }, [load])
  useEffect(() => { const t = window.setInterval(load, 30_000); return () => window.clearInterval(t) }, [load])

  if (failed) return <div className="m-screen"><TopBar title="모집 관리" back="#/mine?tab=host" /><div className="m-body"><div className="m-note bad">{failed}</div></div></div>
  if (!activity) return <div className="m-screen"><TopBar title="모집 관리" back="#/mine?tab=host" /><Loading /></div>
  const { phase } = phaseOf(activity.date, activity.startTime, activity.durationMinutes, now)
  const start = new Date(`${activity.date}T${activity.startTime}:00+09:00`).getTime()
  const items = people?.items ?? []
  const count = (s: string) => items.filter(p => p.status === s).length
  const checked = count('CHECKED_IN'), completed = count('COMPLETED')
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

  const tabs: [ManageTab, string, number][] = [['people', '신청자', count('APPLIED')], ['news', '소식', unanswered], ['attendance', '출석', 0]]
  const main = (() => {
    if (activity.status === 'CANCELLED') return null
    if (phase === 'open' || phase === 'late') return tab === 'attendance' ? null : <button className="m-btn" onClick={() => setTab('attendance')}><MIcon name="qr" size={19} />출석 QR 띄우기</button>
    if (phase === 'ended' && checked > 0) return <button className="m-btn" disabled={busy} onClick={() => run('/api/activities/' + id + '/complete', undefined, `${checked}명 완료를 확인했어요`)}>체크인한 {checked}명 모두 완료</button>
    if (phase === 'ended') return <a className="m-btn line" href={'#/create?from=' + id}><MIcon name="refresh" size={19} />같은 활동 다시 모집</a>
    if (tab !== 'news') return <button className="m-btn line" onClick={() => setTab('news')}><MIcon name="megaphone" size={19} />공지 올리기</button>
    return null
  })()

  return <div className="m-screen m-manage">
    <TopBar title="모집 관리" back="#/mine?tab=host" actions={<button type="button" className="m-icon-btn" aria-label="활동 메뉴" onClick={() => setSheet('menu')}><MIcon name="more" /></button>} />
    <div className="m-body">
      <section className="m-dash-head">
        <div className="m-labels"><span className={'m-badge ' + (activity.status === 'RECRUITING' ? 'mint' : activity.status === 'DRAFT' ? 'amber' : 'gray')}>{statusText}</span>{dDay(activity.date) && <span className="m-badge gray">{dDay(activity.date)}</span>}</div>
        <h1>{activity.title}</h1>
        <p>{dayWord(activity.date)} {activity.startTime} · {durationLabel(activity.durationMinutes)} · {activity.meetingPoint ?? activity.placeName}</p>
        {activity.status === 'CANCELLED' && <div className="m-state bad"><strong>취소한 활동이에요</strong><span>{activity.cancelReason ?? activity.reviewNote}</span></div>}
        {activity.status === 'DRAFT' && <div className="m-state amber"><strong>{activity.reviewNote ? '관리자가 반려했어요' : '관리자 확인 후 공개돼요'}</strong><span>{activity.reviewNote ?? activity.riskReasons ?? ''}</span></div>}
        <div className="m-kpis">
          <div><b>{people?.confirmed ?? activity.confirmed}<small>/{activity.capacity}</small></b><span>확정</span></div>
          <div className={count('APPLIED') ? 'hot' : ''}><b>{count('APPLIED')}</b><span>승인 대기</span></div>
          <div><b>{count('WAITLISTED') + count('OFFERED')}</b><span>대기</span></div>
          <div className={unanswered ? 'hot' : ''}><b>{unanswered}</b><span>새 질문</span></div>
        </div>
      </section>
      <div className="m-seg-tabs inset" role="tablist" aria-label="관리 화면">{tabs.map(([key, label, badge]) =>
        <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{label}{badge > 0 && <i>{badge}</i>}</button>)}</div>

      {tab === 'people' && (!people ? <Loading /> : items.length === 0 ? <div className="m-empty"><span className="m-empty-ico"><MIcon name="users" size={26} /></span><strong>아직 신청자가 없어요</strong><p>신청이 들어오면 알림으로 알려 드려요.</p></div>
        : <ul className="m-people">{items.map(p => <li key={p.id}>
          <span className="m-avatar sm"><MIcon name="user" size={18} /></span>
          <span className="m-people-main"><strong>{p.name}{p.lateMinutes ? <em className="m-badge amber">{p.lateMinutes}분 늦음</em> : null}</strong>
            <small>{p.checkInMethod ? (p.checkInMethod === 'QR' ? 'QR·위치 확인' : '수동 확인') + (p.checkedInAt ? ' ' + p.checkedInAt : '') + (p.checkInReason ? ' · ' + p.checkInReason : '') : '신청 ' + p.appliedAt}</small></span>
          <span className="m-people-act">
            {p.status === 'APPLIED' && phase !== 'ended' ? <><button className="m-btn xs line" disabled={busy} onClick={() => run('/api/participations/' + p.id + '/reject', {}, p.name + ' 님 신청을 거절했어요')}>거절</button>
              <button className="m-btn xs" disabled={busy} onClick={() => run('/api/participations/' + p.id + '/approve', {}, p.name + ' 님 참가를 확정했어요')}>승인</button></>
              : p.status === 'CONFIRMED' && (phase === 'open' || phase === 'late') ? <button className="m-btn xs line" onClick={() => setManual(p)}>수동 확인</button>
              : p.status === 'CHECKED_IN' && phase === 'ended' ? <button className="m-btn xs" disabled={busy} onClick={() => run('/api/participations/' + p.id + '/complete', {}, p.name + ' 님 완료를 확인했어요')}>완료 확인</button>
              : <span className={'m-badge ' + (statusWord[p.status]?.tone ?? 'gray')}>{p.status === 'WAITLISTED' ? `대기 ${p.waitOrder}번` : statusWord[p.status]?.text ?? p.status}</span>}
          </span></li>)}</ul>)}
      {tab === 'people' && <p className="m-help">이름 일부만 보이고 연락처는 공개하지 않아요. 확정자가 취소하면 대기 1번에게 자동으로 자리를 제안해요.</p>}
      {tab === 'news' && <div className="m-legacy"><ActivityNews activityId={id} organizer /></div>}
      {tab === 'attendance' && <>
        {(phase === 'later' || phase === 'soon') && <div className="m-empty"><span className="m-empty-ico"><MIcon name="qr" size={26} /></span><strong>체크인은 시작 30분 전부터 열려요</strong><p>그때 이 화면에서 QR을 띄워 참가자에게 보여 주세요. QR은 30초마다 바뀌어요.</p></div>}
        {phase !== 'later' && phase !== 'soon' && <div className="m-legacy"><AttendancePanel activity={activity} phase={phase as Phase} onChanged={load} /></div>}
        {(phase === 'ended' || checked + completed > 0) && <p className="m-help">출석 {checked + completed}명 · 완료 확인 {completed}명. 완료를 확인하면 참가자에게 활동 기록이 남아요.</p>}
      </>}
    </div>
    {main && <ActionBar>{main}</ActionBar>}

    {sheet === 'menu' && <Sheet title="활동 관리" onClose={() => setSheet(null)}>
      <nav className="m-menu flat">
        {open && <a href={'#/edit/' + id}><MIcon name="edit" size={20} /><span>{(activity.applicants ?? 0) > 0 ? '소개·만나는 곳 고치기' : '활동 고치기'}</span><MIcon name="chevron" size={18} /></a>}
        {open && <button type="button" disabled={!canMove} onClick={() => setSheet('move')}><MIcon name="calendar" size={20} /><span>일정 바꾸기</span><small>{(activity.rescheduleCount ?? 0) > 0 ? '이미 한 번 바꿨어요' : !canMove ? '시작 24시간 전까지만' : '한 번만 가능'}</small><MIcon name="chevron" size={18} /></button>}
        <a href={'#/create?from=' + id}><MIcon name="refresh" size={20} /><span>같은 내용으로 다시 모집</span><MIcon name="chevron" size={18} /></a>
        {open && (activity.applicants ?? 0) === 0 && <button type="button" onClick={() => setSheet('delete')}><MIcon name="trash" size={20} /><span>활동 삭제</span><MIcon name="chevron" size={18} /></button>}
        {open && (activity.applicants ?? 0) > 0 && <button type="button" className="danger" onClick={() => setSheet('cancel')}><MIcon name="close" size={20} /><span>활동 취소</span><small>신청자 모두에게 알려요</small><MIcon name="chevron" size={18} /></button>}
      </nav>
    </Sheet>}
    {sheet === 'cancel' && <ActivityCancelSheet busy={busy} onClose={() => setSheet(null)} onSend={reason => run('/api/activities/' + id + '/cancel', { reason }, '활동을 취소하고 신청자에게 알렸어요')} />}
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
    <label className="m-field"><span className="m-label">사유</span><input className="m-input" maxLength={500} value={reason} placeholder="직접 적기" onChange={event => setReason(event.target.value)} enterKeyHint="done" /></label>
    <button className="m-btn" disabled={busy || !reason.trim()} onClick={() => onSend(reason.trim())}>출석 확인</button>
  </>
}

function ActivityCancelSheet({ busy, onClose, onSend }: { busy: boolean; onClose: () => void; onSend: (reason: string) => void }) {
  const quick = ['비 예보가 있어요', '장소를 쓸 수 없게 됐어요', '모집자 사정이 생겼어요']
  const [reason, setReason] = useState('')
  return <Sheet title="활동을 취소할까요?" onClose={onClose} footer={<button className="m-btn danger" disabled={busy || reason.trim().length < 2} onClick={() => onSend(reason.trim())}>활동 취소하기</button>}>
    <p className="m-help">신청·대기한 사람 모두에게 이유와 함께 알림이 가요. 되돌릴 수 없어요.</p>
    <div className="m-chips wrap">{quick.map(x => <button key={x} type="button" className={'m-chip' + (reason === x ? ' on' : '')} aria-pressed={reason === x} onClick={() => setReason(x)}>{x}</button>)}</div>
    <label className="m-field"><span className="m-label">취소 이유 <small>2~200자</small></span>
      <textarea className="m-input" rows={3} maxLength={200} value={reason} placeholder="참가자에게 보여요" onChange={event => setReason(event.target.value)} /></label>
  </Sheet>
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
      <input className="m-input" maxLength={200} value={reason} placeholder="예: 장소 사정으로 오후로 옮겨요" onChange={event => setReason(event.target.value)} enterKeyHint="done" /></label>
    {pick === 'date' && <DateSheet value={date} first={shift(1)} last={shift(r.maxDaysAhead)} onClose={() => setPick(null)} onPick={value => { setDate(value); setPick(null) }} />}
    {pick === 'time' && <TimeSheet value={time} onClose={() => setPick(null)} onPick={value => { setTime(value); setPick(null) }} />}
    {pick === 'duration' && <DurationSheet value={duration} start={time} options={lengths} onClose={() => setPick(null)} onPick={value => { setDuration(value); setPick(null) }} />}
  </Sheet>
}
