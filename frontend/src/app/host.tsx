// 모집: start a new activity, recruit again from a past one, and see what I am recruiting now.
// The create form has three steps: 기본 정보 → 참여 안내 → 운영 설정. The server checks every rule again.
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { NicknameGate } from './community'
import { api, ApiError } from '../api'
import type { LiveActivity, User } from '../api'
import { categories, showToast } from '../App'
import { categoryHint, categoryTone } from '../categories'
import { durationLabel } from '../create'
import { PlaceField } from '../placePicker'
import type { PlaceResult } from '../placePicker'
import { activityRules as r } from '../rules'
import type { Errors } from '../rules'
import { addToCalendar, difficultyLabel, fieldIcon, placeKindLabel } from './cards'
import { useStatus } from './status'
import { ActionBar, dayWord, Empty, go, goUp, Loading, MIcon, PickField, Sheet, TopBar, WheelColumn, Wheels, TextInput, TextArea } from './ui'

export function HostScreen({ user, actions }: { user: User; actions: ReactNode }) {
  const [mine, setMine] = useState<LiveActivity[] | null>(null)
  useEffect(() => { api<LiveActivity[]>('/api/me/activities').then(setMine).catch(() => setMine([])) }, [user.id])
  const now = Date.now()
  const live = (mine ?? []).filter(a => ['RECRUITING', 'IN_PROGRESS', 'DRAFT'].includes(a.status) && new Date(`${a.date}T${a.startTime}:00+09:00`).getTime() + a.durationMinutes * 60_000 > now)
  const past = (mine ?? []).filter(a => !live.includes(a)).slice(0, 5)
  return <div className="m-screen">
    <TopBar title="봉사 만들기" back="history" actions={actions} />
    {user.memberType !== 'INSTITUTION' && <NicknameGate />}
    <div className="m-body">
      <section className="m-hero">
        <span className="m-hero-ico"><MIcon name="plus" size={26} /></span>
        <h2>새로운 봉사 모집하기</h2>
        <p>기본 정보 → 참여 안내 → 운영 설정</p>
        <a className="m-btn" href="#/create">새 활동 만들기</a>
      </section>
      {!mine ? <Loading /> : <>
        {live.length > 0 && <section className="m-section"><div className="m-section-head"><h2>모집 중인 활동</h2></div>
          <div className="m-list">{live.map(a => <a key={a.id} className="m-row" href={'#/manage/' + a.id}>
            <span className={'m-row-ico f' + categoryTone(a.category)}><MIcon name={fieldIcon[a.category] ?? 'sprout'} size={22} /></span>
            <span className="m-row-main"><strong>{a.title}</strong><small>{dayWord(a.date)} {a.startTime} · 확정 {a.confirmed}/{a.capacity}명</small>
              {((a.pending ?? 0) > 0 || (a.unanswered ?? 0) > 0) && <em className="hot">{[a.pending ? `승인 대기 ${a.pending}` : '', a.unanswered ? `질문 ${a.unanswered}` : ''].filter(Boolean).join(' · ')}</em>}</span>
            <span className={'m-badge ' + (a.status === 'DRAFT' ? 'amber' : 'mint')}>{a.status === 'DRAFT' ? '검토 중' : '관리'}</span></a>)}</div></section>}
        <section className="m-section"><div className="m-section-head"><h2>지난 활동 다시 모집</h2></div>
          {past.length ? <div className="m-list">{past.map(a => <a key={a.id} className="m-row" href={'#/create?from=' + a.id}>
            <span className="m-row-ico"><MIcon name="refresh" size={21} /></span>
            <span className="m-row-main"><strong>{a.title}</strong><small>지난 활동 정보 복사해서 시작</small></span><MIcon name="chevron" size={18} /></a>)}</div>
            : <Empty icon="refresh" title="아직 지난 활동이 없어요" text="활동을 한 번 열고 나면, 같은 내용으로 쉽게 다시 모집할 수 있어요." />}
        </section>
      </>}
    </div>
  </div>
}

const sunset = ['17:40', '18:10', '18:40', '19:05', '19:30', '19:50', '19:50', '19:25', '18:45', '18:00', '17:25', '17:15']
const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const clock = (n: number) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0')
const seoulToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
const addDays = (date: string, days: number) => { const d = new Date(date + 'T12:00:00+09:00'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }
const presetSupplies = ['장갑', '집게', '봉투', '물', '모자', '편한 신발']
type Supply = { name: string; provided: boolean }
type Saved = { kind: 'published' | 'review'; activity: LiveActivity }

/** 빠른 모집 (2026-11-26): one tap fills the post; the organizer then picks place, date, time, supplies and people on one page. */
type Template = { key: string; label: string; title: string; category: string; difficulty: 'EASY' | 'NORMAL' | 'HARD'; placeKind: 'OUTDOOR' | 'INDOOR' | 'MIXED'; duration: number; supplies: string[]; description: string }
const templates: Template[] = [
  { key: 'plogging', label: '공원 플로깅', title: '공원 산책로 플로깅 함께해요', category: '환경', difficulty: 'EASY', placeKind: 'OUTDOOR', duration: 120, supplies: ['장갑', '집게', '봉투'],
    description: '공원 산책로를 천천히 걸으며 쓰레기를 함께 주워요. 집게와 봉투는 나눠 드려요. 처음 오셔도 괜찮아요.' },
  { key: 'garden', label: '화단 가꾸기', title: '동네 화단 함께 가꿔요', category: '환경', difficulty: 'EASY', placeKind: 'OUTDOOR', duration: 120, supplies: ['장갑', '모자', '물'],
    description: '동네 화단의 잡초를 뽑고 꽃에 물을 줘요. 장갑은 나눠 드려요. 편한 옷차림으로 오세요.' },
  { key: 'talk', label: '이웃 말벗', title: '이웃 어르신과 말벗 나눠요', category: '복지', difficulty: 'EASY', placeKind: 'INDOOR', duration: 90, supplies: ['편한 신발'],
    description: '이웃 어르신들과 이야기를 나누고 간단한 놀이를 함께해요. 밝은 인사만 준비해 주세요.' },
  { key: 'dog', label: '유기견 산책', title: '보호소 강아지 산책 함께해요', category: '동물', difficulty: 'NORMAL', placeKind: 'OUTDOOR', duration: 120, supplies: ['편한 신발', '물'],
    description: '보호소 강아지들과 산책을 해요. 처음 오시면 담당자가 줄 잡는 법부터 알려 드려요.' },
]

// Which step shows each server field error.
/** 2026-11-26: risk words checked while typing (the server's table, the same check as posting). */
type WordHit = { keyword: string; level: 'BLOCKED' | 'REVIEW'; reason: string }
type Risk = { level: 'BLOCKED' | 'REVIEW'; reasons: { head: string; why: string }[] } | null
/** What each reason group of the server's risk table (V3/V44) is called in one plain sentence (2026-11-26 user wording). */
const riskNoun: Record<string, string> = {
  '금전 모금': '모금 활동', '높은 곳 작업': '높은 곳 작업', '물속 작업': '물속 활동', '안전·운영 원칙': '음주가 있는 활동',
  '위험 장비': '위험 장비를 쓰는 활동', '의료행위': '의료 행위', '전기·가스 작업': '전기·가스 작업', '화학물질': '약품을 쓰는 활동',
  '가스 관련 활동': '가스를 다루는 활동', '공사 구역': '공사 구역 활동', '교통 위험': '차도 주변 활동', '날붙이 도구': '칼·낫을 쓰는 활동',
  '부상 위험': '무거운 짐을 드는 활동', '비공개 장소': '가정 방문 활동', '산행 위험': '등산 활동', '시설 내부 활동': '시설 안 활동',
  '어두울 때 하는 활동': '일몰 후 활동', '전기 관련 활동': '전기를 다루는 활동', '차량 이동': '차량 이동이 있는 활동',
  '취약 대상': '아이와 함께하는 활동', '화기·위생': '조리 활동',
}
/** 은 after a final consonant, otherwise 는. */
const topic = (word: string) => { const code = word.charCodeAt(word.length - 1) - 0xac00; return word + (code >= 0 && code <= 11171 && code % 28 ? '은' : '는') }
function riskOf(hits: WordHit[] | undefined): Risk {
  if (!hits?.length) return null
  const blocked = hits.filter(hit => hit.level === 'BLOCKED')
  const shown = blocked.length ? blocked : hits
  return { level: blocked.length ? 'BLOCKED' : 'REVIEW', reasons: shown.map(hit => ({ head: `‘${hit.keyword}’`,
    why: topic(riskNoun[hit.reason] ?? hit.reason) + (hit.level === 'BLOCKED' ? ' 등록할 수 없어요.' : ' 검토 후 승인이 필요해요.') })) }
}

/** The (!) in a field: red = cannot be posted, amber = an admin checks first. Tapping it opens a white bubble with why. */
function RiskMark({ risk, name }: { risk: Risk; name: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.setTimeout(() => document.addEventListener('click', close, { once: true }), 0)
    return () => document.removeEventListener('click', close)
  }, [open])
  if (!risk) return null
  const blocked = risk.level === 'BLOCKED'
  return <span className="m-risk">
    <button type="button" className={'m-risk-ico' + (blocked ? ' r' : ' o')} aria-label={(blocked ? '등록할 수 없는 이유' : '검토하는 이유') + ' · ' + name} aria-expanded={open}
      onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(!open) }}>!</button>
    {open && <span className="m-risk-bubble" role="tooltip">{risk.reasons.map(reason => <span key={reason.head}><strong>{reason.head}</strong>{reason.why}</span>)}</span>}
  </span>
}
const riskLine = (risk: Risk) => risk && <span className={'m-risk-line' + (risk.level === 'BLOCKED' ? ' r' : ' o')}>{risk.level === 'BLOCKED' ? '이 내용으로는 등록할 수 없어요' : '관리자 검토 후 승인돼요'}</span>
const riskClass = (risk: Risk) => risk ? (risk.level === 'BLOCKED' ? ' risk-r' : ' risk-o') : ''

const quickFields = ['place', 'date', 'time', 'duration', 'supplies', 'description', 'capacity', 'safety', 'risk']
const stepOf: Record<string, number> = { title: 1, category: 1, difficulty: 1, placeKind: 1, activityType: 1, place: 2, meetingPoint: 2, date: 2, time: 2, duration: 2, supplies: 2, description: 2, capacity: 3, safety: 3 }

/**
 * 신고 3회부터(7·14·30일·정지) 새 모집글도 못 만들어요 (2026-11-12, user decision; the server checks too): the limit is
 * said before the three steps, not after them. Editing an activity already open is not blocked.
 */
export function CreateWizard(props: { user: User; from?: number; editId?: number }) {
  const status = useStatus()
  if (!props.editId && status?.host) return <div className="m-screen"><TopBar title="모집 만들기" back="#/host" />
    <div className="m-body"><Empty bare icon="alert" title={`${status.host.until ? md(status.host.until) + '까지 ' : ''}모집글을 만들 수 없어요`} text={status.host.reason}
      action={<a className="m-btn sm" href="#/my?view=status">내 이용 상태</a>} /></div></div>
  return <CreateForm {...props} />
}
const md = (iso: string) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`

function CreateForm({ user, from, editId }: { user: User; from?: number; editId?: number }) {
  const today = seoulToday()
  const [step, setStep] = useState(1)
  const [kind, setKind] = useState<'GENERAL' | 'INSTITUTION'>('GENERAL')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState(categories[0])
  const [difficulty, setDifficulty] = useState<'EASY' | 'NORMAL' | 'HARD'>('EASY')
  const [placeKind, setPlaceKind] = useState<'OUTDOOR' | 'INDOOR' | 'MIXED'>('OUTDOOR')
  const [newcomer, setNewcomer] = useState(true)
  const [autoApprove, setAutoApprove] = useState(false)
  const [place, setPlace] = useState<PlaceResult | null>(null)
  const [meeting, setMeeting] = useState('')
  const [date, setDate] = useState(addDays(today, 2))
  const [start, setStart] = useState('10:00')
  const [duration, setDuration] = useState(90)
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [custom, setCustom] = useState('')
  const [description, setDescription] = useState('')
  const [capacity, setCapacity] = useState(4)
  const [safety, setSafety] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<Saved | null>(null)
  // After a new recruitment: once, ask whether to put it in the phone calendar (2026-11-06).
  const [calendarAsk, setCalendarAsk] = useState(true)
  const [sheet, setSheet] = useState<'date' | 'time' | null>(null)
  const [locked, setLocked] = useState(false)
  const [loading, setLoading] = useState(Boolean(from || editId))
  // 2026-11-26: a new post starts from 빠른 모집 (pick) or 직접 만들기 (full); 다시 모집 opens the one-page form.
  const [mode, setMode] = useState<'pick' | 'quick' | 'full'>(editId ? 'full' : from ? 'quick' : 'pick')
  const [template, setTemplate] = useState<Template | null>(null)
  const [past, setPast] = useState<LiveActivity[]>([])
  useEffect(() => {
    if (mode !== 'pick') return
    api<LiveActivity[]>('/api/me/activities').then(list => {
      const seen = new Set<string>()
      setPast(list.filter(a => a.status !== 'DELETED' && !seen.has(a.title) && seen.add(a.title)).slice(0, 3))
    }).catch(() => setPast([]))
  }, [mode])
  function applyTemplate(t: Template) {
    setTemplate(t); setTitle(t.title); setCategory(t.category); setDifficulty(t.difficulty); setPlaceKind(t.placeKind); setDuration(t.duration)
    setSupplies(t.supplies.map(name => ({ name, provided: false }))); setDescription(t.description); setNewcomer(true); setAutoApprove(true); setErrors({})
    setMode('quick'); window.scrollTo(0, 0)
  }
  const canHost = user.organization?.status === 'APPROVED'

  // 다시 모집 (from) copies everything but the date; 수정 (editId) loads it all. With applicants only notes change.
  useEffect(() => {
    const id = editId ?? from
    if (!id) return
    api<LiveActivity>('/api/activities/' + id).then(a => {
      setKind(a.activityType); setTitle(a.title); setCategory(a.category); setDifficulty(a.difficulty ?? 'EASY'); setPlaceKind(a.placeKind ?? 'OUTDOOR')
      setNewcomer(a.newcomerOk === undefined || Boolean(a.newcomerOk)); setAutoApprove(Boolean(a.autoApprove)); setMeeting(a.meetingPoint ?? '')
      // Keep the start on the form's 10-minute grid inside 06:00 ~ 21:30.
      setStart(clock(Math.min(minutes(r.latestEnd) - r.durationMin, Math.max(minutes(r.earliestStart), Math.round(minutes(a.startTime) / 10) * 10)))); setDuration(a.durationMinutes)
      setCapacity(a.capacity); setDescription(a.description); setSupplies((a.supplies ?? []).map((s: Supply) => ({ ...s, provided: false })))
      setPlace({ placeId: a.placeId ?? undefined, name: a.placeName ?? '', address: a.placeAddress ?? '', categoryName: '', latitude: a.latitude ?? null, longitude: a.longitude ?? null, distanceMeters: null, placeClass: 'OPEN', classLabel: '지난 장소' })
      if (editId) { setDate(a.date); setSafety(true); setLocked((a.applicants ?? 0) > 0) }
    }).catch(() => setMessage('활동 정보를 불러오지 못했어요.')).finally(() => setLoading(false))
  }, [from, editId])

  const [words, setWords] = useState<{ title: WordHit[]; description: WordHit[]; supplies: WordHit[] }>({ title: [], description: [], supplies: [] })
  const supplyNames = supplies.map(item => item.name).join('|')
  useEffect(() => {
    let live = true
    const timer = window.setTimeout(() => {
      api<typeof words>('/api/activities/check', 'POST', { title, description, supplies: supplyNames ? supplyNames.split('|') : [] })
        .then(found => { if (live) setWords(found) }).catch(() => undefined)
    }, 400)
    return () => { live = false; window.clearTimeout(timer) }
  }, [title, description, supplyNames])
  const risk = { title: riskOf(words.title), description: riskOf(words.description), supplies: riskOf(words.supplies),
    place: place?.placeClass === 'REVIEW' && !place.recent ? { level: 'REVIEW', reasons: [{ head: place.name, why: '등록되지 않은 장소라 승인이 필요해요.' }] } as Risk : null }
  const blockedFields = Object.entries(risk).filter(([, value]) => value?.level === 'BLOCKED').map(([key]) => key)
  const blockedHere = blockedFields.filter(key => (stepOf[key] ?? 3) === step)
  const late = minutes(start) > minutes(sunsetOf(date))
  const needsReview = !blockedFields.length && (late || Object.values(risk).some(value => value?.level === 'REVIEW'))
  const supplyHit = (name: string) => words.supplies.find(hit => name.replace(/\s/g, '').includes(hit.keyword.replace(/\s/g, '')))
  const end = clock(minutes(start) + duration)
  const lengths = useMemo(() => { const out: number[] = []; for (let v = r.durationMin; v <= Math.min(r.durationMax, minutes(r.latestEnd) - minutes(start)); v += 10) out.push(v); return out }, [start])
  useEffect(() => { if (lengths.length && !lengths.includes(duration)) setDuration(lengths[lengths.length - 1]) }, [lengths, duration])

  /** 2026-11-26: the calendar says from when exactly a post may start (24 hours from now). */
  function leadNote() {
    const at = new Date(Date.now() + r.minLeadHours * 3_600_000)
    const text = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(at)
    return `지금부터 ${r.minLeadHours}시간 뒤인 ${text} 이후로 잡을 수 있어요`
  }

  function check(upTo: number): Errors {
    const found: Errors = {}
    if (upTo >= 1 && !locked) {
      if (title.trim().length < r.titleMin || title.trim().length > r.titleMax) found.title = `활동 이름은 ${r.titleMin}~${r.titleMax}자로 적어 주세요.`
    }
    if (upTo >= 2) {
      if (!place && !locked) found.place = '장소를 골라 주세요.'
      if (!locked && (new Date(`${date}T${start}:00+09:00`).getTime() - Date.now()) / 3_600_000 < r.minLeadHours) found.date = `지금부터 ${r.minLeadHours}시간 이후로 정해 주세요.`
      const text = description.trim().length
      if (text < r.descriptionMin || text > r.descriptionMax) found.description = `활동 소개는 ${r.descriptionMin}~${r.descriptionMax}자로 적어 주세요. (지금 ${text}자)`
    }
    if (upTo >= 3 && !safety && !locked) found.safety = '안전 안내를 확인해 주세요.'
    return found
  }
  function next() {
    // 2026-11-26 (기기 확인): a red field on this step stops 다음 too, not only the last button.
    if (step < 3 && blockedHere.length) { goFix(); return }
    const found = check(step)
    setErrors(found)
    if (Object.keys(found).length) { focusError(found); return }
    if (step < 3) { setStep(step + 1); window.scrollTo(0, 0) } else submit()
  }
  function focusError(found: Errors) {
    const first = Object.keys(found)[0]
    window.setTimeout(() => document.querySelector<HTMLElement>(`[name="${first}"]`)?.focus(), 30)
  }

  async function submit() {
    setBusy(true)
    setMessage('')
    try {
      if (locked && editId) {
        await api('/api/activities/' + editId + '/notes', 'PATCH', { description, meetingPoint: meeting })
        showToast('소개와 만나는 곳을 고쳤어요')
        go('#/manage/' + editId)
        return
      }
      const chosen = place?.placeId ? { placeId: place.placeId } : place ? { place: { kakaoId: place.kakaoId, name: place.name, address: place.address, categoryName: place.categoryName, latitude: place.latitude, longitude: place.longitude, placeClass: place.placeClass, classLabel: place.classLabel, token: place.token } } : {}
      const body = { activityType: kind, title: title.trim(), category, ...chosen, meetingPoint: meeting, date, time: start, capacity, durationMinutes: duration,
        description: description.trim(), safetyConfirmed: safety, supplies, difficulty, placeKind, newcomerOk: newcomer, autoApprove }
      const activity = await api<LiveActivity>(editId ? '/api/activities/' + editId : '/api/activities', editId ? 'PUT' : 'POST', body)
      setSaved({ kind: activity.status === 'RECRUITING' ? 'published' : 'review', activity })
    } catch (cause) {
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length) {
        const found = cause.fieldErrors
        setErrors(found)
        if (found.risk) setMessage(cause.message)
        const back = Math.min(...Object.keys(found).map(key => stepOf[key] ?? 3))
        if (mode === 'quick' && Object.keys(found).every(key => quickFields.includes(key))) { focusError(found); return }
        setMode('full')
        setStep(back)
        focusError(found)
      } else setMessage(cause instanceof Error ? cause.message : '저장하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  if (saved) return <div className="m-screen"><TopBar title="모집 등록" back="#/host" />
    <div className="m-body m-done">
      <span className={'m-done-ico' + (saved.kind === 'review' ? ' amber' : '')}><MIcon name={saved.kind === 'review' ? 'clock' : 'check'} size={34} /></span>
      <h2>{saved.kind === 'published' ? (editId ? '활동을 고쳤어요' : '모집을 시작했어요!') : '관리자 확인 후 공개돼요'}</h2>
      <p>{saved.kind === 'published' ? '신청이 오면 알림으로 알려 드릴게요.' : '확인이 끝나면 알림으로 알려 드릴게요. 보통 하루 안에 확인해요.'}</p>
      <div className="m-summary"><strong>{saved.activity.title}</strong><span>{dayWord(saved.activity.date)} {saved.activity.startTime} · {durationLabel(saved.activity.durationMinutes)} · 나 빼고 {saved.activity.capacity}명</span></div>
      {saved.kind === 'published' && !editId && <a className="m-promo-cta" href={'#/write?category=PROMO&activity=' + saved.activity.id}>
        <MIcon name="megaphone" size={22} /><span><strong>커뮤니티에 홍보하기</strong><small>이웃들이 [바로 신청하기]로 신청할 수 있어요</small></span><MIcon name="chevron" size={18} /></a>}
      <ActionBar><a className="m-btn" href={'#/manage/' + saved.activity.id}>모집 관리로 가기</a></ActionBar>
    </div>
    {!editId && calendarAsk && <Sheet title="내 캘린더에도 넣어 둘까요?" onClose={() => setCalendarAsk(false)}
      footer={<><button type="button" className="m-btn" onClick={() => { setCalendarAsk(false); void addToCalendar(saved.activity).then(way => { if (way === 'file') showToast('캘린더 파일을 받았어요', '열면 휴대폰 캘린더에 추가돼요') }) }}><MIcon name="calendar" size={19} />캘린더에 추가</button>
        <button type="button" className="m-btn line" onClick={() => setCalendarAsk(false)}>괜찮아요</button></>}>
      <div className="m-summary"><strong>{saved.activity.title}</strong><span>{dayWord(saved.activity.date)} {saved.activity.startTime} · {[saved.activity.placeName, saved.activity.meetingPoint].filter(Boolean).join(' · ')}</span></div>
      <p className="m-help">휴대폰 캘린더의 일정 추가 화면이 바로 열려요. 저장만 누르면 돼요. 일정을 바꾸면 캘린더는 직접 고쳐 주세요.</p>
    </Sheet>}
  </div>

  const stepTitle = ['기본 정보', '참여 안내', '운영 설정'][step - 1]
  const err = (key: string) => errors[key] && <span className="m-err" role="alert">{errors[key]}</span>
  const sheets = <>
    {sheet === 'date' && <DateSheet value={date} first={addDays(today, 1)} last={addDays(today, r.maxDaysAhead)} note={leadNote()} onClose={() => setSheet(null)} onPick={value => { setDate(value); setSheet(null); setErrors(e => ({ ...e, date: '' })) }} />}
    {sheet === 'time' && <ScheduleSheet date={date} start={start} duration={duration} onClose={() => setSheet(null)} onPick={(value, length) => { setStart(value); setDuration(length); setSheet(null); setErrors(e => ({ ...e, date: '', time: '' })) }} />}
  </>
  const supplyChips = <div className="m-chips wrap">{presetSupplies.concat(supplies.filter(s => !presetSupplies.includes(s.name)).map(s => s.name)).map(name => {
    const item = supplies.find(s => s.name === name)
    const hit = item && supplyHit(name)
    return <button type="button" key={name} className={'m-chip' + (item ? ' on' : '') + (hit ? (hit.level === 'BLOCKED' ? ' risk-r' : ' risk-o') : '')} aria-pressed={Boolean(item)}
      onClick={() => setSupplies(item ? supplies.filter(s => s.name !== name) : supplies.length < 6 ? [...supplies, { name, provided: false }] : supplies)}>{name}{hit && ' !'}</button>
  })}</div>

  function goFix() { const first = (blockedHere[0] ?? blockedFields[0]); document.querySelector<HTMLElement>(`[name="${first}"]`)?.scrollIntoView({ block: 'center' }) }
  const postButton = (label: string) => <>
    {blockedFields.length > 0 && <button type="button" className="m-fix" onClick={goFix}>고칠 곳이 {blockedFields.length}개 있어요 · 눌러서 이동</button>}
    {needsReview && <p className="m-fix o">관리자 확인 뒤 공개돼요</p>}
    <button className={'m-btn' + (needsReview ? ' amber' : '')} disabled={busy || blockedFields.length > 0}>{busy ? '올리는 중…' : needsReview ? '검토 요청하고 올리기' : label}</button></>

  if (mode === 'pick') return <div className="m-screen m-create">
    <TopBar title="새 활동 만들기" back={() => goUp('#/host')} />
    <div className="m-body">
      <h2 className="m-h2">어떤 봉사를 열까요?</h2>
      <p className="m-help">고르면 내용이 채워져요. 장소와 날짜만 정하면 돼요.</p>
      <div className="m-tpl-grid">{templates.map(t => <button type="button" key={t.key} className="m-tpl" onClick={() => applyTemplate(t)}>
        <span className={'m-row-ico f' + categoryTone(t.category)}><MIcon name={fieldIcon[t.category] ?? 'sprout'} size={20} /></span>
        <strong>{t.label}</strong><small>{t.category} · {durationLabel(t.duration)}</small></button>)}</div>
      <hr className="m-divider" />
      <button type="button" className="m-start-row" onClick={() => { setMode('full'); setStep(1) }}>
        <span className="m-row-ico"><MIcon name="edit" size={20} /></span><span><strong>직접 만들기</strong><small>처음부터 하나씩 적어요</small></span><MIcon name="chevron" size={18} /></button>
      {past.length > 0 && <>
        <p className="m-sec-label">지난 활동 다시 모집</p>
        {past.map(a => <a key={a.id} className="m-start-row" href={'#/create?from=' + a.id}>
          <span className={'m-row-ico f' + categoryTone(a.category)}><MIcon name={fieldIcon[a.category] ?? 'sprout'} size={20} /></span>
          <span><strong>{a.title}</strong><small>{dayWord(a.date)} · {a.placeName ?? '장소 미정'}</small></span><MIcon name="chevron" size={18} /></a>)}
      </>}
    </div>
  </div>

  if (mode === 'quick') return <div className="m-screen m-create">
    <TopBar title={from ? '다시 모집하기' : template?.label ?? '빠른 모집'} back={() => from ? goUp('#/host') : setMode('pick')} />
    {loading ? <Loading /> : <form className="m-body m-form" noValidate onSubmit={event => {
      event.preventDefault()
      const found = check(3)
      setErrors(found)
      if (Object.keys(found).length) {
        if (Object.keys(found).every(key => quickFields.includes(key))) focusError(found)
        else { setMode('full'); setStep(Math.min(...Object.keys(found).map(key => stepOf[key] ?? 3))) }
        return
      }
      submit()
    }}>
      <div className="m-quick-head">
        <span className={'m-row-ico f' + categoryTone(category)}><MIcon name={fieldIcon[category] ?? 'sprout'} size={22} /></span>
        <span><strong>{title}</strong><small>{category} · {difficultyLabel[difficulty]} · {placeKindLabel[placeKind]}</small>{riskLine(risk.title)}</span>
        <RiskMark risk={risk.title} name="활동 이름" />
        <button type="button" className="m-link" onClick={() => { setMode('full'); setStep(1) }}>바꾸기</button>
      </div>
      <div className="m-risk-box"><PlaceField app value={place} meetingPoint={meeting} error={errors.place} onChange={(picked, point) => { setPlace(picked); setMeeting(point); setErrors(e => ({ ...e, place: '' })) }} />
        <span className="m-risk-at place"><RiskMark risk={risk.place} name="장소" /></span>{riskLine(risk.place)}</div>
      <PickField name="date" label="날짜" icon="calendar" value={dayWord(date) + (dayWord(date).length <= 2 ? ' · ' + date.slice(5).replace('-', '/') : '')} error={errors.date} onOpen={() => setSheet('date')} />
      <PickField name="time" label="시간" icon="clock" value={`${start} ~ ${end} · ${durationLabel(duration)}`} error={errors.time} onOpen={() => setSheet('time')} />
      <SunsetNote date={date} start={start} />
      <div className="m-field"><span className="m-label">준비물</span>{supplyChips}{riskLine(risk.supplies)}{err('supplies')}</div>
      <div className="m-field"><span className="m-label">모집 인원 <small>나를 빼고</small></span>
        <div className="m-stepper"><button type="button" aria-label="한 명 줄이기" disabled={capacity <= r.capacityMin} onClick={() => setCapacity(capacity - 1)}>−</button>
          <output name="capacity" aria-live="polite">{capacity}명</output>
          <button type="button" aria-label="한 명 늘리기" disabled={capacity >= r.capacityMax} onClick={() => setCapacity(capacity + 1)}>+</button></div>{err('capacity')}</div>
      <label className="m-switch"><span><strong>처음 오는 분 환영</strong><small>찾기에서 ‘처음 환영’으로 보여요</small></span>
        <input type="checkbox" role="switch" checked={newcomer} onChange={event => setNewcomer(event.target.checked)} /><i /></label>
      <label className="m-switch"><span><strong>신청 바로 확정</strong><small>{autoApprove ? '빈자리가 있으면 승인 없이 확정돼요' : '신청을 하나씩 보고 승인해요'}</small></span>
        <input type="checkbox" role="switch" checked={autoApprove} onChange={event => setAutoApprove(event.target.checked)} /><i /></label>
      <label className="m-field"><span className="m-label">활동 소개</span>
        <span className="m-risk-box"><TextArea name="description" className={'m-input' + (errors.description ? ' bad' : '') + riskClass(risk.description)} rows={4} maxLength={r.descriptionMax} value={description} onChange={event => setDescription(event.target.value)} />
          <span className="m-risk-at"><RiskMark risk={risk.description} name="활동 소개" /></span></span>
        {riskLine(risk.description)}{err('description')}</label>
      <label className={'m-check box' + (errors.safety ? ' bad' : '')}><input name="safety" type="checkbox" checked={safety} onChange={event => setSafety(event.target.checked)} /><span className="m-box" />
        <span>높은 곳·물속·전기·가스 작업, 의료행위, 금전 모금이 없고, 사고가 나면 먼저 119에 신고해요.</span></label>
      {err('safety')}
      <p className="m-help">Volink 활동은 공식 봉사실적이 아니며 자원봉사 종합보험이 적용되지 않아요.</p>
      {message && <div className="m-note bad" role="alert">{message}</div>}
      <ActionBar>{postButton('모집 올리기')}</ActionBar>
    </form>}
    {sheets}
  </div>
  return <div className="m-screen m-create">
    <TopBar title={editId ? '활동 고치기' : from ? '다시 모집하기' : '새 활동 만들기'} back={() => step > 1 ? setStep(step - 1) : !editId && !from ? setMode('pick') : goUp(editId ? '#/manage/' + editId : '#/host')} />
    <div className="m-progress" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step} aria-label="만들기 단계"><i style={{ width: step * 33.34 + '%' }} /></div>
    {loading ? <Loading /> : <form className="m-body m-form" noValidate onSubmit={event => { event.preventDefault(); next() }}>
      <span className="m-step">{step} / 3 · {stepTitle}</span>
      {locked && <div className="m-note warm"><strong>신청한 사람이 있어요</strong>일정·장소·인원은 바꿀 수 없고, 소개와 만나는 곳만 고칠 수 있어요. 일정은 모집 관리에서 한 번 바꿀 수 있어요.</div>}

      {step === 1 && <>
        <h2 className="m-h2">어떤 활동인가요?</h2>
        {canHost && !locked && <div className="m-field"><span className="m-label">활동 유형</span><div className="m-seg wide">
          <button type="button" className={kind === 'GENERAL' ? 'on' : ''} aria-pressed={kind === 'GENERAL'} onClick={() => setKind('GENERAL')}>자율 활동</button>
          <button type="button" className={kind === 'INSTITUTION' ? 'on' : ''} aria-pressed={kind === 'INSTITUTION'} onClick={() => setKind('INSTITUTION')}>기관 주관</button></div></div>}
        <label className="m-field"><span className="m-label">활동 이름</span>
          <span className="m-risk-box"><TextInput name="title" className={'m-input' + (errors.title ? ' bad' : '') + riskClass(risk.title)} placeholder="예: 공원 산책로 함께 걷고 줍기" maxLength={r.titleMax} value={title} disabled={locked} onChange={event => setTitle(event.target.value)} enterKeyHint="done" />
            <span className="m-risk-at"><RiskMark risk={risk.title} name="활동 이름" /></span></span>{riskLine(risk.title)}
          <span className="m-count">{title.trim().length} / {r.titleMax}</span>{err('title')}</label>
        <div className="m-field"><span className="m-label">분야</span><div className="m-tiles">{categories.map(c =>
          <button type="button" key={c} className={'m-tile' + (category === c ? ' on' : '')} aria-pressed={category === c} disabled={locked} onClick={() => setCategory(c)}><MIcon name={fieldIcon[c] ?? 'sprout'} size={24} />{c}</button>)}</div>
          {category && categoryHint[category] && <p className="m-help">{categoryHint[category]}</p>}</div>
        <div className="m-field"><span className="m-label">활동 강도</span><div className="m-seg wide">
          {(Object.keys(difficultyLabel) as (keyof typeof difficultyLabel)[]).map(key => <button type="button" key={key} disabled={locked} className={difficulty === key ? 'on' : ''} aria-pressed={difficulty === key} onClick={() => setDifficulty(key)}>{difficultyLabel[key]}</button>)}</div></div>
        <div className="m-field"><span className="m-label">장소 환경</span><div className="m-seg wide">
          {(Object.keys(placeKindLabel) as (keyof typeof placeKindLabel)[]).map(key => <button type="button" key={key} disabled={locked} className={placeKind === key ? 'on' : ''} aria-pressed={placeKind === key} onClick={() => setPlaceKind(key)}>{placeKindLabel[key]}</button>)}</div></div>
        <label className="m-switch"><span><strong>처음 오는 분 환영</strong><small>찾기에서 ‘처음 환영’으로 보여요</small></span>
          <input type="checkbox" role="switch" checked={newcomer} disabled={locked} onChange={event => setNewcomer(event.target.checked)} /><i /></label>
      </>}

      {step === 2 && <>
        <h2 className="m-h2">어디서, 언제 만나요?</h2>
        {!locked && <div className="m-risk-box"><PlaceField app value={place} meetingPoint={meeting} error={errors.place} onChange={(picked, point) => { setPlace(picked); setMeeting(point) }} />
          <span className="m-risk-at place"><RiskMark risk={risk.place} name="장소" /></span>{riskLine(risk.place)}</div>}
        <label className="m-field"><span className="m-label">만나는 곳 <small>선택</small></span>
          <TextInput name="meetingPoint" className="m-input" placeholder="예: 정문 안내판 앞" maxLength={100} value={meeting} onChange={event => setMeeting(event.target.value)} enterKeyHint="done" />{err('meetingPoint')}</label>
        {!locked && <>
          <PickField name="date" label="날짜" icon="calendar" value={dayWord(date) + (dayWord(date).length <= 2 ? ' · ' + date.slice(5).replace('-', '/') : '')} error={errors.date} onOpen={() => setSheet('date')} />
          <PickField name="time" label="시간" icon="clock" value={`${start} ~ ${end} · ${durationLabel(duration)}`} error={errors.time} onOpen={() => setSheet('time')} />
          <SunsetNote date={date} start={start} />
          <div className="m-field"><span className="m-label">준비물</span>
            <div className="m-chips wrap">{presetSupplies.concat(supplies.filter(s => !presetSupplies.includes(s.name)).map(s => s.name)).map(name => {
              const item = supplies.find(s => s.name === name)
              return <button type="button" key={name} className={'m-chip' + (item ? ' on' : '')} aria-pressed={Boolean(item)}
                onClick={() => setSupplies(item ? supplies.filter(s => s.name !== name) : supplies.length < 6 ? [...supplies, { name, provided: false }] : supplies)}>
                {name}</button>
            })}</div>
            <span className="m-inline"><TextInput className="m-input" placeholder="직접 추가 (10자)" maxLength={10} value={custom} onChange={event => setCustom(event.target.value)} enterKeyHint="done"
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); const name = custom.trim(); if (name && supplies.length < 6 && !supplies.some(s => s.name === name)) { setSupplies([...supplies, { name, provided: false }]); setCustom('') } } }} />
              <button type="button" className="m-btn line sm" disabled={!custom.trim() || supplies.length >= 6} onClick={() => { const name = custom.trim(); if (name && !supplies.some(s => s.name === name)) { setSupplies([...supplies, { name, provided: false }]); setCustom('') } }}>추가</button></span>
            {riskLine(risk.supplies)}{err('supplies')}</div>
        </>}
        <label className="m-field"><span className="m-label">활동 소개</span>
          <span className="m-risk-box"><TextArea name="description" className={'m-input' + (errors.description ? ' bad' : '') + riskClass(risk.description)} rows={5} maxLength={r.descriptionMax} placeholder="무엇을 하는지, 처음 오는 분이 알아야 할 것을 적어 주세요. 연락처는 적지 마세요."
            value={description} onChange={event => setDescription(event.target.value)} />
            <span className="m-risk-at"><RiskMark risk={risk.description} name="활동 소개" /></span></span>
          <span className="m-count">{description.trim().length} / {r.descriptionMax}</span>{riskLine(risk.description)}{err('description')}</label>
      </>}

      {step === 3 && <>
        <h2 className="m-h2">마지막으로 운영 설정</h2>
        {!locked && <div className="m-field"><span className="m-label">모집 인원 <small>나를 빼고 {r.capacityMin}~{r.capacityMax}명</small></span>
          <div className="m-stepper"><button type="button" aria-label="한 명 줄이기" disabled={capacity <= r.capacityMin} onClick={() => setCapacity(capacity - 1)}>−</button>
            <output name="capacity" aria-live="polite">{capacity}명</output>
            <button type="button" aria-label="한 명 늘리기" disabled={capacity >= r.capacityMax} onClick={() => setCapacity(capacity + 1)}>+</button></div>
          <span className="m-help">나 포함 {capacity + 1}명 · 정원이 차면 대기 순번을 받아요</span>{err('capacity')}</div>}
        <label className="m-switch"><span><strong>신청 바로 확정 (자동 승인)</strong><small>{autoApprove ? '빈자리가 있으면 신청하는 순간 참가가 확정돼요' : '신청을 하나씩 보고 승인하거나 거절해요'}</small></span>
          <input type="checkbox" role="switch" checked={autoApprove} onChange={event => setAutoApprove(event.target.checked)} /><i /></label>
        <div className="m-summary">
          <strong>{title || '활동 이름'}</strong>
          <span>{category} · {difficultyLabel[difficulty]} · {placeKindLabel[placeKind]}{newcomer ? ' · 처음 환영' : ''}</span>
          <span>{dayWord(date)} {start}~{end} · {place?.name ?? '장소 미정'}{meeting ? ' · ' + meeting : ''}</span>
          {supplies.length > 0 && <span>준비물 {supplies.map(s => s.name).join(', ')}</span>}
        </div>
        {!locked && <label className={'m-check box' + (errors.safety ? ' bad' : '')}><input name="safety" type="checkbox" checked={safety} onChange={event => setSafety(event.target.checked)} /><span className="m-box" />
          <span>높은 곳·물속·전기·가스 작업, 의료행위, 금전 모금이 없고, 사고가 나면 먼저 119에 신고해요.</span></label>}
        {err('safety')}
        <p className="m-help">Volink 활동은 공식 봉사실적이 아니며 자원봉사 종합보험이 적용되지 않아요.</p>
      </>}
      {message && <div className="m-note bad" role="alert">{message}</div>}
      <ActionBar>{step > 1 && <button type="button" className="m-btn line" onClick={() => setStep(step - 1)}>이전</button>}
        {step < 3 && blockedHere.length > 0 && !locked && <button type="button" className="m-fix" onClick={goFix}>고칠 곳이 {blockedHere.length}개 있어요 · 눌러서 이동</button>}
        {step < 3 || locked || editId ? <button className="m-btn" disabled={busy || (step < 3 && blockedHere.length > 0 && !locked)}>{step < 3 ? '다음' : busy ? '저장하는 중…' : locked ? '고친 내용 저장' : '수정 완료'}</button> : postButton('모집 시작하기')}</ActionBar>
    </form>}

    {sheets}
  </div>
}

/** A date field in our own calendar sheet (2026-11-06: instead of the phone's date box). */
export function DateField({ label, value, first, last, onChange, placeholder = '날짜를 골라 주세요', note, error }: { label: string; value: string; first: string; last: string; onChange: (date: string) => void; placeholder?: string; note?: string; error?: string }) {
  const [open, setOpen] = useState(false)
  const full = value ? new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value + 'T12:00:00+09:00')) : ''
  const word = value ? (dayWord(value).length <= 2 ? dayWord(value) + ' · ' : '') + full : ''
  return <>
    <PickField label={label} icon="calendar" value={word} placeholder={placeholder} error={error} onOpen={() => setOpen(true)} />
    {open && <DateSheet value={value} first={first} last={last} note={note} onClose={() => setOpen(false)} onPick={date => { onChange(date); setOpen(false) }} />}
  </>
}

/** A time field in our own wheel sheet (06:00~21:50, 10-minute steps). */
export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (time: string) => void }) {
  const [open, setOpen] = useState(false)
  return <>
    <PickField label={label} icon="clock" value={value} onOpen={() => setOpen(true)} />
    {open && <AnyTimeSheet title={label} value={value} onClose={() => setOpen(false)} onPick={time => { onChange(time); setOpen(false) }} />}
  </>
}

/** Any time of day, 5-minute steps (a 1365 time is not limited to Volink's activity hours). */
function AnyTimeSheet({ title, value, onPick, onClose }: { title: string; value: string; onPick: (time: string) => void; onClose: () => void }) {
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const mins = Array.from({ length: 12 }, (_, i) => i * 5)
  const [h, setH] = useState(Number(value.slice(0, 2)) || 0)
  const [mm, setMm] = useState(Math.round((Number(value.slice(3, 5)) || 0) / 5) * 5 % 60)
  const result = String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0')
  return <Sheet title={title} onClose={onClose} footer={<button type="button" className="m-btn" onClick={() => onPick(result)}>{result}로 정하기</button>}>
    <Wheels>
      <WheelColumn label="시" items={hours} value={h} render={x => (x < 12 ? '오전 ' : '오후 ') + (x % 12 === 0 ? 12 : x % 12) + '시'} onChange={setH} />
      <WheelColumn label="분" items={mins} value={mm} render={x => String(x).padStart(2, '0') + '분'} onChange={setMm} />
    </Wheels>
  </Sheet>
}

export function DateSheet({ value, first, last, onPick, onClose, note }: { value: string; first: string; last: string; onPick: (date: string) => void; onClose: () => void; note?: string }) {
  const [month, setMonth] = useState((value || first).slice(0, 7))
  const today = seoulToday()
  const [y, m] = month.split('-').map(Number)
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const shift = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)) }
  return <Sheet title="날짜" onClose={onClose}>
    <div className="m-cal-head"><button type="button" className="m-icon-btn" aria-label="이전 달" disabled={month <= first.slice(0, 7)} onClick={() => shift(-1)}><MIcon name="back" /></button>
      <strong>{y}년 {m}월</strong>
      <button type="button" className="m-icon-btn flip" aria-label="다음 달" disabled={month >= last.slice(0, 7)} onClick={() => shift(1)}><MIcon name="back" /></button></div>
    <div className="m-cal">{['일', '월', '화', '수', '목', '금', '토'].map((d, i) => <span key={d} className={'m-cal-w' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '')}>{d}</span>)}
      {Array.from({ length: lead }, (_, i) => <span key={'x' + i} />)}
      {Array.from({ length: count }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, '0')}`
        const can = date >= first && date <= last
        const weekday = (lead + i) % 7
        return <button type="button" key={date} disabled={!can} aria-pressed={date === value} aria-label={dayWord(date)}
          className={'m-day' + (date === value ? ' on' : '') + (date === today ? ' today' : '') + (weekday === 0 ? ' sun' : weekday === 6 ? ' sat' : '')} onClick={() => onPick(date)}>{i + 1}</button>
      })}</div>
    <p className="m-help center">{note ?? `내일부터 ${r.maxDaysAhead}일 안에서 고를 수 있어요`}</p>
  </Sheet>
}

const half = (t: number) => (t < 720 ? '오전' : '오후')
const hour12 = (t: number) => Math.floor(t / 60) % 12 === 0 ? 12 : Math.floor(t / 60) % 12
const nearest = (list: number[], target: number) => list.reduce((best, t) => Math.abs(t - target) < Math.abs(best - target) ? t : best, list[0])

/** 오전/오후 · 시 · 분 in three wheels over a list of allowed times (minutes of the day); each column only offers what fits. */
function TimeWheels({ allowed, value, onChange, label }: { allowed: number[]; value: number; onChange: (t: number) => void; label: string }) {
  const halves = [...new Set(allowed.map(half))]
  const inHalf = allowed.filter(t => half(t) === half(value))
  const hours = [...new Set(inHalf.map(hour12))]
  const mins = inHalf.filter(t => hour12(t) === hour12(value)).map(t => t % 60)
  return <Wheels>
    <WheelColumn label={label + ' 오전/오후'} items={halves} value={half(value)} onChange={h => onChange(nearest(allowed.filter(t => half(t) === h), value + (h === '오후' ? 720 : -720)))} />
    <WheelColumn label={label + ' 시'} items={hours} value={hour12(value)} render={h => h + '시'} onChange={h => onChange(nearest(inHalf.filter(t => hour12(t) === h), value))} />
    <WheelColumn label={label + ' 분'} items={mins} value={value % 60} render={m => String(m).padStart(2, '0') + '분'}
      onChange={m => onChange(inHalf.find(t => hour12(t) === hour12(value) && t % 60 === m) ?? value)} />
  </Wheels>
}

/** The month's sunset (same table as the server's RiskClassifier): an activity that starts after it goes to review. */
export function sunsetOf(date: string) { return sunset[Number(date.slice(5, 7)) - 1] }

/** One line under the time: before sunset, or after it (review). Ending after sunset is fine (2026-11-26). */
export function SunsetNote({ date, start }: { date: string; start: string }) {
  const late = minutes(start) > minutes(sunsetOf(date))
  return <p className={'m-help' + (late ? ' warn' : '')}><MIcon name="sun" size={16} />{late ? `일몰(${sunsetOf(date)}) 이후 활동으로 관리자 검토 후 승인될 예정이에요.` : `일몰(${sunsetOf(date)}) 전에 시작해요.`}</p>
}

/**
 * 2026-11-26: start and end in one sheet (tabs 활동 시작 / 활동 종료, one wheel). The start is free in 06:00~21:30
 * and keeps the length; the end only turns within 30 min ~ 3 h after the start (and by 22:00); the length is shown.
 */
export function ScheduleSheet({ date, start, duration, onPick, onClose }: { date: string; start: string; duration: number; onPick: (start: string, duration: number) => void; onClose: () => void }) {
  const latestStart = minutes(r.latestEnd) - r.durationMin
  const [tab, setTab] = useState<'start' | 'end'>('start')
  const [from, setFrom] = useState(Math.min(minutes(start), latestStart))
  const room = (at: number) => Math.min(r.durationMax, minutes(r.latestEnd) - at)
  // The length the person chose; a late start only trims what is shown (moving back gives it back).
  const [want, setLength] = useState(duration)
  const length = Math.min(want, room(from))
  const starts = useMemo(() => { const out: number[] = []; for (let t = minutes(r.earliestStart); t <= latestStart; t += 10) out.push(t); return out }, [latestStart])
  const ends = useMemo(() => { const out: number[] = []; for (let v = r.durationMin; v <= room(from); v += 10) out.push(from + v); return out }, [from])
  const moveStart = (t: number) => setFrom(t)
  return <Sheet title="시간" onClose={onClose} footer={<button type="button" className="m-btn" onClick={() => onPick(clock(from), length)}>이 시간으로 할게요</button>}>
    <div className="m-seg wide m-time-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'start'} className={tab === 'start' ? 'on' : ''} onClick={() => setTab('start')}><small>활동 시작</small><strong>{clock(from)}</strong></button>
      <button type="button" role="tab" aria-selected={tab === 'end'} className={tab === 'end' ? 'on' : ''} onClick={() => setTab('end')}><small>활동 종료</small><strong>{clock(from + length)}</strong></button>
    </div>
    {tab === 'start'
      ? <TimeWheels key="start" label="활동 시작" allowed={starts} value={from} onChange={moveStart} />
      : <TimeWheels key="end" label="활동 종료" allowed={ends} value={from + length} onChange={t => setLength(t - from)} />}
    <p className="m-time-sum">활동 시간 <strong>{durationLabel(length)}</strong></p>
    <SunsetNote date={date} start={clock(from)} />
  </Sheet>
}
