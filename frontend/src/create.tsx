// Activity form (4주차 보완): one place field with a search dialog, a schedule card (date first, then a wheel for the
// start time) and a duration list that only offers lengths ending by 22:00. Minutes are in 10-minute steps.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError, preview } from './api'
import type { LiveActivity, User } from './api'
import { categories, LoginRequired, PageHeading } from './App'
import { Glyph, supplyGlyph } from './icons'
import type { Supply } from './icons'
import { PlaceField } from './placePicker'
import type { PlaceResult } from './placePicker'
import { activityRules } from './rules'
import type { Errors } from './rules'

const r = activityRules
const toMinutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m }
const toTime = (minutes: number) => String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0')
const latestStart = toMinutes(r.latestEnd) - r.durationMin
/** Approximate mid-month sunset (same table as the server's RiskClassifier); ending later sends the activity to review. */
const sunset = ['17:40', '18:10', '18:40', '19:05', '19:30', '19:50', '19:50', '19:25', '18:45', '18:00', '17:25', '17:15']

function seoulToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

function addDays(date: string, days: number) {
  const value = new Date(date + 'T12:00:00+09:00')
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function friendlyDate(date: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(date + 'T12:00:00+09:00'))
}

type WordHit = { keyword: string; level: 'BLOCKED' | 'REVIEW'; reason: string }
type WordCheck = { title: WordHit[]; description: WordHit[]; supplies: WordHit[] }
type FieldStatus = { level: 'BLOCKED' | 'REVIEW'; reasons: string[] }
const safetyText = '높은 곳·물속·전기·가스 작업, 의료행위, 금전 모금은 열 수 없어요. 어르신·아이 돌봄 같은 활동, 어떤 곳인지 알 수 없는 장소, 해가 진 뒤 끝나는 활동은 관리자가 확인한 뒤 공개돼요.'

/** Risk words of one field → the strongest level, with each word and why. */
function fromWords(hits: WordHit[]): FieldStatus | null {
  if (!hits.length) return null
  const blocked = hits.filter(hit => hit.level === 'BLOCKED')
  const shown = blocked.length ? blocked : hits
  return { level: blocked.length ? 'BLOCKED' : 'REVIEW', reasons: shown.map(hit => `‘${hit.keyword}’ · ${hit.reason}`) }
}

/** Under a field: (!) 검토 후 승인 예정이에요 / (⊘) 모집을 올릴 수 없어요. Pointing at (or focusing) the icon shows why. */
function FieldRisk({ field, status }: { field: string; status: FieldStatus | null }) {
  if (!status) return null
  const blocked = status.level === 'BLOCKED'
  const id = 'risk-' + field.replace(/\s/g, '')
  return <span className={'field-risk ' + (blocked ? 'blocked' : 'review')}>
    <span className="risk-tip" tabIndex={0} role="button" aria-label={blocked ? '올릴 수 없는 이유' : '검토 이유'} data-field={field} aria-describedby={id}>
      <Glyph name={blocked ? 'ban' : 'notice'} size={16} />
      <span className="risk-bubble" role="tooltip" id={id}>
        {blocked && <strong>안전하게 함께해요</strong>}
        {status.reasons.map(reason => <span key={reason}>{reason}</span>)}
        {blocked && <span className="risk-safety">{safetyText}</span>}
      </span>
    </span>
    {blocked ? '모집을 올릴 수 없어요.' : '검토 후 승인 예정이에요.'}
  </span>
}

export function durationLabel(minutes: number) {
  const h = Math.floor(minutes / 60), m = minutes % 60
  return (h ? h + '시간' : '') + (h && m ? ' ' : '') + (m ? m + '분' : '')
}

function clockLabel(time: string) {
  const minutes = toMinutes(time), h = Math.floor(minutes / 60)
  return (h < 12 ? '오전 ' : '오후 ') + (h % 12 === 0 ? 12 : h % 12) + ':' + String(minutes % 60).padStart(2, '0')
}

/** Lengths from 30 minutes in 10-minute steps that still end by 22:00 (and at most 3 hours). */
export function durationsFor(start: string) {
  const room = Math.min(r.durationMax, toMinutes(r.latestEnd) - toMinutes(start))
  const options: number[] = []
  for (let value = r.durationMin; value <= room; value += 10) options.push(value)
  return options
}

const presetSupplies = ['장갑', '집게', '봉투', '물', '모자', '편한 신발']
const maxSupplies = 6
/** Starting supplies per field until the person changes them. */
const suppliesFor: Record<string, Supply[]> = {
  '환경 정화': [{ name: '장갑', provided: false }, { name: '편한 신발', provided: false }],
  '생활 지원': [{ name: '장갑', provided: false }],
  '지역 돌봄': [],
}

const templates = [
  { name: '공원 플로깅', title: '공원 산책로 함께 걷고 줍기', category: '환경 정화', duration: 90, description: '공원 산책로를 천천히 걸으며 눈에 띄는 쓰레기를 함께 줍습니다. 집게와 봉투는 나눠 드려요. 처음 오셔도 괜찮아요.' },
  { name: '동네 화단 가꾸기', title: '동네 화단 물주기와 잡초 뽑기', category: '환경 정화', duration: 60, description: '동네 화단에 물을 주고 잡초를 뽑는 가벼운 활동입니다. 장갑을 챙겨 오시면 좋아요.' },
  { name: '나눔 장터 정리', title: '주민 나눔 장터 정리 돕기', category: '생활 지원', duration: 120, description: '주민 나눔 장터가 끝난 뒤 테이블과 물품을 함께 정리합니다. 무거운 물건은 두 사람이 함께 옮겨요.' },
]

type CreateResult = { kind: 'published' | 'review'; activity: LiveActivity }

export default function CreateActivity({ user, ready, editId }: { user: User | null; ready: boolean; editId?: number }) {
  const today = seoulToday()
  const [kind, setKind] = useState<'GENERAL' | 'INSTITUTION'>('GENERAL')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState(categories[0])
  const [place, setPlace] = useState<PlaceResult | null>(null)
  const [meetingPoint, setMeetingPoint] = useState('')
  const [date, setDate] = useState(addDays(today, 2))
  const [start, setStart] = useState('10:00')
  const [duration, setDuration] = useState(90)
  const [capacity, setCapacity] = useState(6)
  const [description, setDescription] = useState('')
  const [safety, setSafety] = useState(false)
  const [supplies, setSupplies] = useState<Supply[]>(suppliesFor[categories[0]])
  const [suppliesTouched, setSuppliesTouched] = useState(false)
  const [customSupply, setCustomSupply] = useState('')
  useEffect(() => { if (!suppliesTouched) setSupplies(suppliesFor[category] ?? []) }, [category, suppliesTouched])
  const [errors, setErrors] = useState<Errors>({})
  const [blocked, setBlocked] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CreateResult | null>(null)
  // Editing: the saved activity fills the form. With applications only the description and meeting point can change.
  const [editing, setEditing] = useState<LiveActivity | null>(null)
  const [loadError, setLoadError] = useState('')
  const locked = (editing?.applicants ?? 0) > 0
  useEffect(() => {
    if (!editId || !user) return
    api<LiveActivity>('/api/activities/' + editId).then(a => {
      setSuppliesTouched(true)
      setEditing(a); setKind(a.activityType); setTitle(a.title); setCategory(a.category); setMeetingPoint(a.meetingPoint ?? '')
      setPlace({ placeId: a.placeId ?? undefined, name: a.placeName ?? '', address: a.placeAddress ?? '', categoryName: '', latitude: a.latitude ?? null, longitude: a.longitude ?? null,
        distanceMeters: null, placeClass: 'OPEN', classLabel: '지금 장소' })
      setDate(a.date); setStart(a.startTime); setDuration(a.durationMinutes); setCapacity(a.capacity); setDescription(a.description); setSupplies(a.supplies ?? []); setSafety(true)
    }).catch(() => setLoadError('고칠 수 있는 활동을 찾지 못했습니다.'))
  }, [editId, user])
  const organization = user?.organization
  const canHost = organization?.status === 'APPROVED'

  const durations = useMemo(() => durationsFor(start), [start])
  // A later start keeps the chosen length when it still fits, otherwise the longest length that does.
  useEffect(() => { if (!durations.includes(duration)) setDuration(durations[durations.length - 1] ?? r.durationMin) }, [durations, duration])
  const end = toTime(toMinutes(start) + duration)
  const dates = useMemo(() => Array.from({ length: r.maxDaysAhead }, (_, i) => addDays(today, i + 1)), [today])
  const afterSunset = toMinutes(end) > toMinutes(sunset[Number(date.slice(5, 7)) - 1])
  // Per-field status shown under each field: risk words come from the server while typing (nothing is saved).
  const [words, setWords] = useState<WordCheck>({ title: [], description: [], supplies: [] })
  const supplyNames = supplies.map(item => item.name).join('|')
  useEffect(() => {
    if (preview || !user) return
    let current = true
    const timer = setTimeout(() => {
      api<WordCheck>('/api/activities/check', 'POST', { title, description, supplies: supplyNames ? supplyNames.split('|') : [] })
        .then(found => { if (current) setWords(found) }).catch(() => undefined)
    }, 400)
    return () => { current = false; clearTimeout(timer) }
  }, [title, description, supplyNames, user])
  const status = {
    title: fromWords(words.title),
    category: category === '지역 돌봄' ? { level: 'REVIEW', reasons: ['지역 돌봄 분야는 만나는 분이 누구인지 관리자가 확인해요.'] } as FieldStatus : null,
    place: place?.placeClass === 'REVIEW' ? { level: 'REVIEW', reasons: ['지도에서 어떤 곳인지 알 수 없는 장소라 관리자가 확인해요.'] } as FieldStatus : null,
    schedule: afterSunset ? { level: 'REVIEW', reasons: ['해가 진 뒤(' + sunset[Number(date.slice(5, 7)) - 1] + ' 이후) 끝나는 활동은 관리자가 확인해요.'] } as FieldStatus : null,
    description: fromWords(words.description),
    supplies: fromWords(words.supplies),
  }
  const statuses = Object.values(status).filter(Boolean) as FieldStatus[]
  const willBlock = statuses.some(item => item.level === 'BLOCKED')
  const willReview = statuses.some(item => item.level === 'REVIEW')

  function validate(): Errors {
    const found: Errors = {}
    if (locked) {
      const text = description.trim()
      if (text.length < r.descriptionMin || text.length > r.descriptionMax) found.description = `활동 소개는 ${r.descriptionMin}~${r.descriptionMax}자로 적어 주세요.`
      return found
    }
    const name = title.trim()
    if (name.length < r.titleMin || name.length > r.titleMax) found.title = `활동 이름은 ${r.titleMin}~${r.titleMax}자로 입력해 주세요.`
    if (!place) found.place = '장소를 골라 주세요.'
    const hoursAhead = (new Date(`${date}T${start}:00+09:00`).getTime() - Date.now()) / 3_600_000
    if (hoursAhead < r.minLeadHours) found.date = `활동은 지금부터 ${r.minLeadHours}시간 이후로 정해 주세요.`
    const text = description.trim()
    if (text.length < r.descriptionMin || text.length > r.descriptionMax) found.description = `활동 소개는 ${r.descriptionMin}~${r.descriptionMax}자로 적어 주세요.`
    if (!safety) found.safety = '안전 안내를 확인해 주세요.'
    return found
  }

  // After the first try, errors follow the fields as they are fixed.
  const [tried, setTried] = useState(false)
  useEffect(() => { if (tried) setErrors(validate()) }, [tried, title, place, date, start, description, safety])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const found = validate()
    setTried(true)
    setErrors(found)
    setBlocked('')
    const first = Object.keys(found)[0]
    if (first) { setMessage(''); (form.querySelector(`[name="${first}"]`) as HTMLElement | null)?.focus(); return }
    if (preview || !user || (!place && !locked)) { setMessage('입력 내용을 확인했습니다. 현재는 활동을 등록하거나 저장하지 않습니다.'); return }
    setBusy(true)
    try {
      const chosen = !place ? {} : place.kakaoId
        ? { place: { kakaoId: place.kakaoId, name: place.name, address: place.address, categoryName: place.categoryName, latitude: place.latitude, longitude: place.longitude, placeClass: place.placeClass, classLabel: place.classLabel, token: place.token } }
        : { placeId: place.placeId }
      const body = { activityType: kind, title: title.trim(), category, ...chosen, meetingPoint, date, time: start, capacity,
        durationMinutes: duration, description: description.trim(), safetyConfirmed: safety, supplies }
      const activity = !editId ? await api<LiveActivity>('/api/activities', 'POST', body)
        : locked ? await api<LiveActivity>(`/api/activities/${editId}/notes`, 'PATCH', { description: description.trim(), meetingPoint })
          : await api<LiveActivity>('/api/activities/' + editId, 'PUT', body)
      setResult({ kind: activity.status === 'RECRUITING' ? 'published' : 'review', activity })
      window.scrollTo(0, 0)
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'ACTIVITY_BLOCKED') setBlocked(cause.fieldErrors.risk ?? cause.message)
      else if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length) setErrors(cause.fieldErrors)
      else setMessage(cause instanceof Error ? cause.message : '등록하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const heading = editId ? <PageHeading title="활동 수정하기" description={locked ? '신청한 사람이 있어 소개와 만나는 곳만 고칠 수 있어요.' : '바꾼 내용도 등록할 때와 같이 다시 확인합니다.'} />
    : <PageHeading title="활동 만들기" description="이웃과 함께할 일과 시간·장소를 알려주세요." />
  if (!preview && !user) return <>{heading}<LoginRequired ready={ready} text="활동을 만들려면 먼저 로그인해 주세요." /></>
  if (editId && loadError) return <>{heading}<section className="empty-state"><p>{loadError}</p><a className="secondary-button" href="#/mine">내 활동으로</a></section></>
  if (editId && !editing) return <>{heading}<div className="empty-state">활동을 불러오는 중입니다.</div></>
  if (locked && !result) return <>{heading}
    <form className="panel activity-form create-form" noValidate onSubmit={submit}>
      <p className="inline-notice">신청한 사람이 {editing?.applicants}명 있어 제목·장소·일정·정원은 바꿀 수 없어요. 꼭 바꿔야 하면 활동을 취소해 주세요(신청자 알림은 참가 신청 기능과 함께 제공).</p>
      <label>만나는 곳<input name="meetingPoint" value={meetingPoint} maxLength={100} onChange={event => setMeetingPoint(event.target.value)} placeholder="예: 정문 안내판 앞" /></label>
      {errors.meetingPoint && <span className="field-error">{errors.meetingPoint}</span>}
      <label>활동 소개<textarea name="description" value={description} maxLength={r.descriptionMax} rows={5} onChange={event => setDescription(event.target.value)} /></label>
      {errors.description && <span id="description-error" className="field-error">{errors.description}</span>}
      {blocked && <div className="form-alert blocked" role="alert"><strong>저장할 수 없는 내용입니다.</strong><span>{blocked}</span></div>}
      <button className="primary-button" type="submit" disabled={busy}>수정 저장 <Glyph name="arrow" size={17} /></button>
      {message && <p role="status" className="success-message">{message}</p>}
    </form></>
  if (result) return <>
    {heading}
    <section className="panel result-panel" role="status">
      <span className={'risk-badge ' + (result.kind === 'published' ? 'low' : 'review')}>{result.kind === 'published' ? '바로 공개' : '관리자 검토'}</span>
      <h2>{editId ? (result.kind === 'published' ? '수정한 내용을 저장했습니다' : '수정한 내용은 관리자 확인 후 공개됩니다') : result.kind === 'published' ? '활동이 공개되었습니다' : '관리자 검토 후 공개됩니다'}</h2>
      <p>{result.kind === 'published' ? '활동 찾기 목록에서 이웃들이 볼 수 있습니다.' : '확인이 필요한 내용이 있어 관리자가 확인한 뒤 공개합니다. 그 전에는 나와 관리자만 볼 수 있습니다.'}</p>
      {result.activity.riskReasons && <p className="small-print">검토 이유: {result.activity.riskReasons}</p>}
      <div className="button-row"><a className="primary-button" href={'#/activity/' + result.activity.id}>만든 활동 보기 <Glyph name="arrow" size={17} /></a><button className="secondary-button" onClick={() => { setResult(null); setMessage('') }}>다른 활동 만들기</button></div>
    </section>
  </>

  const count = Object.keys(errors).length
  const err = (name: string) => errors[name] ? { 'aria-invalid': true as const, 'aria-describedby': name + '-error' } : {}
  const fieldError = (name: string) => errors[name] ? <span id={name + '-error'} className="field-error">{errors[name]}</span> : null
  return <>
    {heading}
    <div className="create-layout single">
      <form className="panel activity-form create-form" noValidate onSubmit={submit} onChange={() => { setMessage(''); setBlocked('') }}>
        <div className="form-title"><h2>활동 정보</h2>
          <label className="template-pick"><Glyph name="bolt" size={15} /><select aria-label="자주 하는 활동 불러오기" value="" onChange={event => {
            const picked = templates.find(item => item.name === event.target.value)
            if (picked) { setTitle(picked.title); setCategory(picked.category); setDescription(picked.description); setSuppliesTouched(false); setDuration(Math.min(picked.duration, durations[durations.length - 1])) }
          }}><option value="">자주 하는 활동 불러오기</option>{templates.map(item => <option key={item.name}>{item.name}</option>)}</select></label></div>

        <label>활동 이름<span className="input-with-count"><input name="title" value={title} maxLength={r.titleMax} onChange={event => setTitle(event.target.value)} placeholder="예: 공원 산책로 함께 걷고 줍기" {...err('title')} /><small>{title.trim().length} / {r.titleMax}</small></span>{fieldError('title')}<FieldRisk field="활동 이름" status={status.title} /></label>

        <div className="form-row">
          <label>분야<span className="select-with-icon"><Glyph name="leaf" size={16} /><select name="category" aria-label="분야" value={category} onChange={event => setCategory(event.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></span><FieldRisk field="분야" status={status.category} /></label>
          {/* Only institution members choose; a personal account always opens 자율 활동. */}
          {user?.memberType === 'INSTITUTION' && <label>활동 유형<span className="select-with-icon"><Glyph name="hand" size={16} /><select name="activityType" aria-label="활동 유형" value={kind} onChange={event => setKind(event.target.value as 'GENERAL' | 'INSTITUTION')}><option value="GENERAL">자율 활동</option><option value="INSTITUTION">기관 주관 활동</option></select></span></label>}
        </div>
        {kind === 'INSTITUTION' && <p className="inline-notice">{canHost ? organization?.name + ' 이름으로 활동을 엽니다.' : organization?.status === 'PENDING' ? '기관 확인을 기다리고 있습니다. 관리자 확인이 끝나면 기관 주관 활동을 열 수 있습니다.' : '기관 주관 활동은 기관 확인이 완료된 기관회원만 개설할 수 있습니다.'}</p>}

        <PlaceField value={place} meetingPoint={meetingPoint} error={errors.place} onChange={(picked, meeting) => { setPlace(picked); setMeetingPoint(meeting); setErrors(({ place: _, ...rest }) => rest) }} />
        {fieldError('meetingPoint')}
        <FieldRisk field="장소" status={status.place} />

        <div className="field-block"><span className="field-label">일정</span>
          <div className="schedule-cards">
            <div className="schedule-card"><span className="card-head"><Glyph name="calendar" size={15} />날짜와 시작 시간</span>
              <DatePicker value={date} first={dates[0]} last={dates[dates.length - 1]} today={today} onChange={setDate} invalid={Boolean(errors.date)} />
              <TimeWheel value={start} onChange={setStart} />
            </div>
            <div className="schedule-card"><span className="card-head"><Glyph name="timer" size={15} />활동 시간</span>
              <DurationWheel value={duration} start={start} options={durations} onChange={setDuration} />
              <span className="end-line"><Glyph name="clock" size={15} />{r.latestEnd} 전에 끝나는 시간만 보여요</span>
            </div>
          </div>
          <span className="schedule-summary"><Glyph name="sun" size={15} /><strong>{friendlyDate(date)} {start} ~ {end}</strong>{afterSunset ? '' : ' · 해 지기 전에 끝나요'}</span>
          {fieldError('date')}{fieldError('time')}{fieldError('duration')}
          <FieldRisk field="일정" status={status.schedule} />
        </div>

        <div className="form-row">
          <label>모집 정원 <span className="field-hint">나를 빼고</span><span className="select-with-icon"><Glyph name="users" size={16} /><select name="capacity" aria-label="모집 정원" value={capacity} onChange={event => setCapacity(Number(event.target.value))}>{Array.from({ length: r.capacityMax - r.capacityMin + 1 }, (_, i) => r.capacityMin + i).map(value => <option key={value} value={value}>{value}명</option>)}</select></span>{fieldError('capacity')}</label>
        </div>


        <label>활동 소개<span className="input-with-count"><textarea name="description" value={description} maxLength={r.descriptionMax} rows={4} onChange={event => setDescription(event.target.value)} placeholder="함께할 일과 준비물을 알려주세요." {...err('description')} /><small>{description.trim().length} / {r.descriptionMax}</small></span>{fieldError('description')}<FieldRisk field="활동 소개" status={status.description} /></label>

        <div className="field-block"><span className="field-label">챙겨 올 준비물 <span className="field-hint">선택 · 최대 {maxSupplies}개 · 누르면 켜져요</span></span>
          <div className="supply-pick" role="group" aria-label="챙겨 올 준비물">
            {[...presetSupplies, ...supplies.map(item => item.name).filter(name => !presetSupplies.includes(name))].map(name => {
              const on = supplies.some(item => item.name === name)
              return <button type="button" key={name} className={'pick-chip' + (on ? ' on' : '')} aria-pressed={on} disabled={!on && supplies.length >= maxSupplies}
                onClick={() => { setSuppliesTouched(true); setSupplies(on ? supplies.filter(item => item.name !== name) : [...supplies, { name, provided: false }]) }}><Glyph name={supplyGlyph(name)} size={14} />{name}</button>
            })}
          </div>
          <span className="supply-add"><input aria-label="준비물 직접 추가" value={customSupply} maxLength={10} onChange={event => setCustomSupply(event.target.value)} placeholder="직접 추가 (10자 이내)"
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); (event.currentTarget.nextElementSibling as HTMLButtonElement | null)?.click() } }} />
            <button type="button" className="secondary-button small" disabled={!customSupply.trim() || supplies.length >= maxSupplies || supplies.some(item => item.name === customSupply.trim())}
              onClick={() => { setSuppliesTouched(true); setSupplies([...supplies, { name: customSupply.trim(), provided: false }]); setCustomSupply('') }}><Glyph name="plus" size={14} />추가</button></span>
          {fieldError('supplies')}
          <FieldRisk field="준비물" status={status.supplies} />
        </div>

        <label className="check-line"><input type="checkbox" name="safety" checked={safety} onChange={event => setSafety(event.target.checked)} {...err('safety')} />공공장소의 저위험 활동이며, 공식 봉사실적·자원봉사 종합보험이 적용되지 않음을 확인합니다</label>
        {fieldError('safety')}
        {count > 0 && <p className="form-alert" role="alert">입력 내용을 확인해 주세요. 고칠 항목 {count}개</p>}
        {blocked && <div className="form-alert blocked" role="alert"><strong>등록할 수 없는 활동입니다.</strong><span>{blocked}</span><span>높은 곳·물속·전기·가스 작업, 의료행위, 금전 모금 등은 열 수 없습니다.</span></div>}
        {!willBlock && !willReview && <p className="field-risk ok" role="status"><Glyph name="check" size={16} />바로 공개될 예정이에요.</p>}
        <button className="primary-button" type="submit" disabled={busy || willBlock || (kind === 'INSTITUTION' && !canHost)}>{preview ? '입력 내용 확인' : editId ? '수정 저장' : '활동 등록'} <Glyph name="arrow" size={17} /></button>
        {message && <p role="status" className="success-message">{message}</p>}
      </form>

    </div>
  </>
}

/** Start time as one field: opens three wheels (오전/오후 · 시 · 분) that scroll and snap. 06:00–21:30, 10-minute steps. */
function TimeWheel({ value, onChange }: { value: string; onChange: (time: string) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const box = useRef<HTMLDivElement>(null)
  const minutes = toMinutes(draft)
  const pm = minutes >= 720
  const hour12 = Math.floor(minutes / 60) % 12 === 0 ? 12 : Math.floor(minutes / 60) % 12
  const allowed = (total: number) => total >= toMinutes(r.earliestStart) && total <= latestStart
  const set = (total: number) => setDraft(toTime(Math.min(Math.max(total, toMinutes(r.earliestStart)), latestStart)))
  const hourOf = (h12: number, afternoon: boolean) => (h12 % 12 + (afternoon ? 12 : 0)) * 60

  // PC mouse wheel / trackpad: one notch moves a column by one item (scroll snapping alone skips or sticks).
  useEffect(() => {
    if (!open) return
    const columns = Array.from(box.current?.querySelectorAll<HTMLElement>('.wheel-col') ?? [])
    const steps = [720, 60, 10]
    const pending = columns.map(() => 0)
    const listeners = columns.map((column, index) => {
      const listener = (event: WheelEvent) => {
        event.preventDefault()
        pending[index] += event.deltaY
        if (Math.abs(pending[index]) < 40) return
        const direction = Math.sign(pending[index])
        pending[index] = 0
        setDraft(current => toTime(Math.min(Math.max(toMinutes(current) + direction * steps[index], toMinutes(r.earliestStart)), latestStart)))
      }
      column.addEventListener('wheel', listener, { passive: false })
      return listener
    })
    return () => columns.forEach((column, index) => column.removeEventListener('wheel', listeners[index]))
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    box.current?.querySelectorAll<HTMLElement>('.wheel-col [aria-selected="true"]').forEach(item => {
      const column = item.parentElement as HTMLElement
      column.scrollTo({ top: item.offsetTop - column.clientHeight / 2 + item.offsetHeight / 2, behavior: 'smooth' })
    })
    return () => document.removeEventListener('mousedown', close)
  }, [open, draft])

  const column = (label: string, items: { key: string; text: string; total: number; selected: boolean }[]) =>
    <div className="wheel-col" role="listbox" aria-label={label}>{items.map(item =>
      <button type="button" role="option" key={item.key} aria-selected={item.selected} disabled={!allowed(item.total)} onClick={() => set(item.total)}>{item.text}</button>)}</div>

  return <div className="time-wheel" ref={box}>
    <button type="button" name="time" className="wheel-field" aria-label={'시작 시간 ' + clockLabel(value)} aria-expanded={open} onClick={() => { setDraft(value); setOpen(!open) }}>
      <Glyph name="clock" size={16} /><span>{clockLabel(value)}</span><span className="chev"><Glyph name="chevron" size={15} /></span>
    </button>
    {open && <div className="wheel-pop" role="dialog" aria-label="시작 시간 고르기">
      <div className="wheels"><span className="wheel-band" />
        {column('오전 오후', [{ key: 'am', text: '오전', total: Math.min(minutes % 720, latestStart), selected: !pm }, { key: 'pm', text: '오후', total: 720 + minutes % 720, selected: pm }]
          .map(item => ({ ...item, total: allowed(item.total) ? item.total : item.key === 'am' ? toMinutes(r.earliestStart) : latestStart })))}
        {column('시', [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(h => ({ key: 'h' + h, text: String(h), total: hourOf(h, pm) + minutes % 60, selected: h === hour12 }))
          .map(item => ({ ...item, total: allowed(item.total) ? item.total : allowed(hourOf(Number(item.text), pm)) ? hourOf(Number(item.text), pm) : -1 })))}
        {column('분', [0, 10, 20, 30, 40, 50].map(m => ({ key: 'm' + m, text: String(m).padStart(2, '0'), total: Math.floor(minutes / 60) * 60 + m, selected: minutes % 60 === m })))}
      </div>
      <div className="wheel-foot"><span>{r.earliestStart} ~ {toTime(latestStart)} · 10분 단위</span><button type="button" className="primary-button small" onClick={() => { onChange(draft); setOpen(false) }}>완료</button></div>
    </div>}
  </div>
}

/** Activity length like the start-time wheel: hours and minutes, with the end time. Only lengths ending by 22:00 can be picked. */
function DurationWheel({ value, start, options, onChange }: { value: number; start: string; options: number[]; onChange: (minutes: number) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const box = useRef<HTMLDivElement>(null)
  const allowed = (total: number) => options.includes(total)
  const first = options[0] ?? r.durationMin, last = options[options.length - 1] ?? r.durationMin
  const clamp = (total: number) => Math.min(Math.max(total, first), last)
  const endOf = (minutes: number) => toTime(toMinutes(start) + minutes)

  // PC mouse wheel: one notch moves a column by one item (an hour or 10 minutes).
  useEffect(() => {
    if (!open) return
    const columns = Array.from(box.current?.querySelectorAll<HTMLElement>('.wheel-col') ?? [])
    const steps = [60, 10]
    const pending = columns.map(() => 0)
    const listeners = columns.map((column, index) => {
      const listener = (event: WheelEvent) => {
        event.preventDefault()
        pending[index] += event.deltaY
        if (Math.abs(pending[index]) < 40) return
        const direction = Math.sign(pending[index])
        pending[index] = 0
        setDraft(current => clamp(current + direction * steps[index]))
      }
      column.addEventListener('wheel', listener, { passive: false })
      return listener
    })
    return () => columns.forEach((column, index) => column.removeEventListener('wheel', listeners[index]))
  }, [open, first, last])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    box.current?.querySelectorAll<HTMLElement>('.wheel-col [aria-selected="true"]').forEach(item => {
      const column = item.parentElement as HTMLElement
      column.scrollTo({ top: item.offsetTop - column.clientHeight / 2 + item.offsetHeight / 2, behavior: 'smooth' })
    })
    return () => document.removeEventListener('mousedown', close)
  }, [open, draft])

  const hours = [0, 1, 2, 3]
  // An hour keeps the chosen minutes when it can, otherwise the closest allowed length in that hour.
  const inHour = (h: number) => allowed(h * 60 + draft % 60) ? h * 60 + draft % 60 : options.filter(minutes => Math.floor(minutes / 60) === h).sort((a, b) => Math.abs(a % 60 - draft % 60) - Math.abs(b % 60 - draft % 60))[0] ?? -1
  const column = (label: string, items: { key: string; text: string; total: number; selected: boolean }[]) =>
    <div className="wheel-col" role="listbox" aria-label={label}>{items.map(item =>
      <button type="button" role="option" key={item.key} aria-selected={item.selected} disabled={!allowed(item.total)} onClick={() => setDraft(item.total)}>{item.text}</button>)}</div>

  return <div className="time-wheel" ref={box}>
    <button type="button" name="duration" className="wheel-field" aria-label={'활동 시간 ' + durationLabel(value) + ' · ' + endOf(value) + ' 종료'} aria-expanded={open} onClick={() => { setDraft(value); setOpen(!open) }}>
      <Glyph name="timer" size={16} /><span>{durationLabel(value)} <small>· {endOf(value)} 종료</small></span><span className="chev"><Glyph name="chevron" size={15} /></span>
    </button>
    {open && <div className="wheel-pop" role="dialog" aria-label="활동 시간 고르기">
      <div className="wheels two"><span className="wheel-band" />
        {column('시간', hours.map(h => ({ key: 'h' + h, text: h + '시간', total: inHour(h), selected: Math.floor(draft / 60) === h })))}
        {column('분', [0, 10, 20, 30, 40, 50].map(m => ({ key: 'm' + m, text: String(m).padStart(2, '0') + '분', total: Math.floor(draft / 60) * 60 + m, selected: draft % 60 === m })))}
      </div>
      <div className="wheel-foot"><span>{start} 시작 → <strong>{endOf(draft)} 종료</strong></span><button type="button" className="primary-button small" onClick={() => { onChange(draft); setOpen(false) }}>완료</button></div>
    </div>}
  </div>
}

/** Date as one field: opens a month calendar. Only tomorrow to 60 days ahead can be picked. */
function DatePicker({ value, first, last, today, onChange, invalid }: { value: string; first: string; last: string; today: string; onChange: (date: string) => void; invalid: boolean }) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(value.slice(0, 7))
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  const [y, m] = month.split('-').map(Number)
  const startWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const shift = (delta: number) => { const d = new Date(Date.UTC(y, m - 1 + delta, 1)); setMonth(d.toISOString().slice(0, 7)) }
  const ahead = (date: string) => Math.round((new Date(date + 'T12:00:00Z').getTime() - new Date(today + 'T12:00:00Z').getTime()) / 86_400_000)
  const relative = (date: string) => { const n = ahead(date); return n === 1 ? '내일' : n === 2 ? '모레' : n + '일 뒤' }
  return <div className="date-picker" ref={box}>
    <button type="button" name="date" className={'wheel-field' + (invalid ? ' invalid' : '')} aria-label={'활동 날짜 ' + friendlyDate(value)} aria-expanded={open} aria-describedby={invalid ? 'date-error' : undefined}
      onClick={() => { setMonth(value.slice(0, 7)); setOpen(!open) }}>
      <Glyph name="calendar" size={16} /><span>{friendlyDate(value)} <small>· {relative(value)}</small></span><span className="chev"><Glyph name="chevron" size={15} /></span>
    </button>
    {open && <div className="calendar-pop" role="dialog" aria-label="날짜 고르기">
      <div className="calendar-head">
        <button type="button" className="icon-button" aria-label="이전 달" disabled={month <= first.slice(0, 7)} onClick={() => shift(-1)}><span className="flip"><Glyph name="chevron" size={16} /></span></button>
        <strong>{y}년 {m}월</strong>
        <button type="button" className="icon-button" aria-label="다음 달" disabled={month >= last.slice(0, 7)} onClick={() => shift(1)}><span className="turn"><Glyph name="chevron" size={16} /></span></button>
      </div>
      <div className="calendar-grid">
        {['일', '월', '화', '수', '목', '금', '토'].map((name, i) => <span key={name} className={'weekday' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '')}>{name}</span>)}
        {Array.from({ length: startWeekday }, (_, i) => <span key={'blank' + i} />)}
        {Array.from({ length: days }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`
          const weekday = (startWeekday + i) % 7
          const can = date >= first && date <= last
          return <button type="button" key={date} data-date={date} disabled={!can} aria-pressed={date === value} aria-label={friendlyDate(date)}
            className={'day' + (weekday === 0 ? ' sun' : weekday === 6 ? ' sat' : '') + (date === today ? ' today' : '')}
            onClick={() => { onChange(date); setOpen(false) }}>{i + 1}</button>
        })}
      </div>
      <p className="calendar-foot">내일부터 {r.maxDaysAhead}일 안에서 고를 수 있어요</p>
    </div>}
  </div>
}
