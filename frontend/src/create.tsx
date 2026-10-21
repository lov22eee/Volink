// Activity form (4주차 보완): one place field with a search dialog, a schedule card (date first, then a wheel for the
// start time) and a duration list that only offers lengths ending by 22:00. Minutes are in 10-minute steps.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError, preview } from './api'
import type { LiveActivity, User } from './api'
import { categories, LoginRequired, PageHeading } from './App'
import { Glyph } from './icons'
import { classBadge, PlaceField } from './placePicker'
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

const templates = [
  { name: '공원 플로깅', title: '공원 산책로 함께 걷고 줍기', category: '환경 정화', duration: 90, description: '공원 산책로를 천천히 걸으며 눈에 띄는 쓰레기를 함께 줍습니다. 집게와 봉투는 나눠 드려요. 처음 오셔도 괜찮아요.' },
  { name: '동네 화단 가꾸기', title: '동네 화단 물주기와 잡초 뽑기', category: '환경 정화', duration: 60, description: '동네 화단에 물을 주고 잡초를 뽑는 가벼운 활동입니다. 장갑을 챙겨 오시면 좋아요.' },
  { name: '나눔 장터 정리', title: '주민 나눔 장터 정리 돕기', category: '생활 지원', duration: 120, description: '주민 나눔 장터가 끝난 뒤 테이블과 물품을 함께 정리합니다. 무거운 물건은 두 사람이 함께 옮겨요.' },
]

type CreateResult = { kind: 'published' | 'review'; activity: LiveActivity }

export default function CreateActivity({ user, ready }: { user: User | null; ready: boolean }) {
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
  const [errors, setErrors] = useState<Errors>({})
  const [blocked, setBlocked] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CreateResult | null>(null)
  const organization = user?.organization
  const canHost = organization?.status === 'APPROVED'

  const durations = useMemo(() => durationsFor(start), [start])
  // A later start keeps the chosen length when it still fits, otherwise the longest length that does.
  useEffect(() => { if (!durations.includes(duration)) setDuration(durations[durations.length - 1] ?? r.durationMin) }, [durations, duration])
  const end = toTime(toMinutes(start) + duration)
  const dates = useMemo(() => Array.from({ length: r.maxDaysAhead }, (_, i) => addDays(today, i + 1)), [today])
  const afterSunset = toMinutes(end) > toMinutes(sunset[Number(date.slice(5, 7)) - 1])
  const reviewReasons = [
    place?.placeClass === 'REVIEW' && '장소: ' + place.classLabel,
    afterSunset && '해가 진 뒤(' + sunset[Number(date.slice(5, 7)) - 1] + ' 이후) 끝나요',
    category === '지역 돌봄' && '지역 돌봄 분야',
  ].filter(Boolean) as string[]

  function validate(): Errors {
    const found: Errors = {}
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
    if (preview || !user || !place) { setMessage('입력 내용을 확인했습니다. 현재는 활동을 등록하거나 저장하지 않습니다.'); return }
    setBusy(true)
    try {
      const chosen = place.kakaoId
        ? { place: { kakaoId: place.kakaoId, name: place.name, address: place.address, categoryName: place.categoryName, latitude: place.latitude, longitude: place.longitude, placeClass: place.placeClass, classLabel: place.classLabel, token: place.token } }
        : { placeId: place.placeId }
      const activity = await api<LiveActivity>('/api/activities', 'POST', {
        activityType: kind, title: title.trim(), category, ...chosen, meetingPoint, date, time: start, capacity,
        durationMinutes: duration, description: description.trim(), safetyConfirmed: safety,
      })
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

  const heading = <PageHeading title="활동 만들기" description="이웃과 함께할 일과 시간·장소를 알려주세요." />
  if (!preview && !user) return <>{heading}<LoginRequired ready={ready} text="활동을 만들려면 먼저 로그인해 주세요." /></>
  if (result) return <>
    {heading}
    <section className="panel result-panel" role="status">
      <span className={'risk-badge ' + (result.kind === 'published' ? 'low' : 'review')}>{result.kind === 'published' ? '바로 공개' : '관리자 검토'}</span>
      <h2>{result.kind === 'published' ? '활동이 공개되었습니다' : '관리자 검토 후 공개됩니다'}</h2>
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
    <div className="create-layout">
      <form className="panel activity-form create-form" noValidate onSubmit={submit} onChange={() => { setMessage(''); setBlocked('') }}>
        <div className="form-title"><h2>활동 정보</h2>
          <label className="template-pick"><Glyph name="bolt" size={15} /><select aria-label="자주 하는 활동 불러오기" value="" onChange={event => {
            const picked = templates.find(item => item.name === event.target.value)
            if (picked) { setTitle(picked.title); setCategory(picked.category); setDescription(picked.description); setDuration(Math.min(picked.duration, durations[durations.length - 1])) }
          }}><option value="">자주 하는 활동 불러오기</option>{templates.map(item => <option key={item.name}>{item.name}</option>)}</select></label></div>

        <label>활동 이름<span className="input-with-count"><input name="title" value={title} maxLength={r.titleMax} onChange={event => setTitle(event.target.value)} placeholder="예: 공원 산책로 함께 걷고 줍기" {...err('title')} /><small>{title.trim().length} / {r.titleMax}</small></span>{fieldError('title')}</label>

        <div className="form-row">
          <label>분야<span className="select-with-icon"><Glyph name="leaf" size={16} /><select name="category" aria-label="분야" value={category} onChange={event => setCategory(event.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></span></label>
          <label>활동 유형<span className="select-with-icon"><Glyph name="hand" size={16} /><select name="activityType" aria-label="활동 유형" value={kind} onChange={event => setKind(event.target.value as 'GENERAL' | 'INSTITUTION')}><option value="GENERAL">자율 활동</option><option value="INSTITUTION">기관 주관 활동</option></select></span></label>
        </div>
        {kind === 'INSTITUTION' && <p className="inline-notice">{canHost ? organization?.name + ' 이름으로 활동을 엽니다.' : organization?.status === 'PENDING' ? '기관 확인을 기다리고 있습니다. 관리자 확인이 끝나면 기관 주관 활동을 열 수 있습니다.' : '기관 주관 활동은 기관 확인이 완료된 기관회원만 개설할 수 있습니다.'}</p>}

        <PlaceField value={place} meetingPoint={meetingPoint} error={errors.place} onChange={(picked, meeting) => { setPlace(picked); setMeetingPoint(meeting); setErrors(({ place: _, ...rest }) => rest) }} />
        {fieldError('meetingPoint')}

        <div className="field-block"><span className="field-label">일정</span>
          <div className="schedule-cards">
            <div className="schedule-card"><span className="card-head"><Glyph name="calendar" size={15} />날짜와 시작 시간</span>
              <span className="select-with-icon"><select name="date" aria-label="활동 날짜" value={date} onChange={event => setDate(event.target.value)} {...err('date')}>{dates.map((value, i) => <option key={value} value={value}>{friendlyDate(value)} · {i === 0 ? '내일' : i === 1 ? '모레' : i + 1 + '일 뒤'}</option>)}</select></span>
              <TimeWheel value={start} onChange={setStart} />
            </div>
            <div className="schedule-card"><span className="card-head"><Glyph name="timer" size={15} />활동 시간</span>
              <span className="select-with-icon"><select name="duration" aria-label="활동 시간" value={duration} onChange={event => setDuration(Number(event.target.value))}>{durations.map(value => <option key={value} value={value}>{durationLabel(value)} · {toTime(toMinutes(start) + value)} 종료</option>)}</select></span>
              <span className="end-line"><Glyph name="clock" size={15} />{r.latestEnd} 전에 끝나는 시간만 보여요</span>
            </div>
          </div>
          <span className="schedule-summary"><Glyph name={afterSunset ? 'alert' : 'sun'} size={15} /><strong>{friendlyDate(date)} {start} ~ {end}</strong>{afterSunset ? ' · 해가 진 뒤 끝나서 관리자가 확인해요' : ' · 해 지기 전에 끝나요'}</span>
          {fieldError('date')}{fieldError('time')}{fieldError('duration')}
        </div>

        <div className="form-row">
          <label>모집 정원 <span className="field-hint">나를 빼고</span><span className="select-with-icon"><Glyph name="users" size={16} /><select name="capacity" aria-label="모집 정원" value={capacity} onChange={event => setCapacity(Number(event.target.value))}>{Array.from({ length: r.capacityMax - r.capacityMin + 1 }, (_, i) => r.capacityMin + i).map(value => <option key={value} value={value}>{value}명</option>)}</select></span>{fieldError('capacity')}</label>
        </div>

        <label>활동 소개<span className="input-with-count"><textarea name="description" value={description} maxLength={r.descriptionMax} rows={4} onChange={event => setDescription(event.target.value)} placeholder="함께할 일과 준비물을 알려주세요." {...err('description')} /><small>{description.trim().length} / {r.descriptionMax}</small></span>{fieldError('description')}</label>

        <label className="check-line"><input type="checkbox" name="safety" checked={safety} onChange={event => setSafety(event.target.checked)} {...err('safety')} />공공장소의 저위험 활동이며, 공식 봉사실적·자원봉사 종합보험이 적용되지 않음을 확인합니다</label>
        {fieldError('safety')}
        {count > 0 && <p className="form-alert" role="alert">입력 내용을 확인해 주세요. 고칠 항목 {count}개</p>}
        {blocked && <div className="form-alert blocked" role="alert"><strong>등록할 수 없는 활동입니다.</strong><span>{blocked}</span><span>높은 곳·물속·전기·가스 작업, 의료행위, 금전 모금 등은 열 수 없습니다.</span></div>}
        <button className="primary-button" type="submit" disabled={busy || (kind === 'INSTITUTION' && !canHost)}>{preview ? '입력 내용 확인' : '활동 등록'} <Glyph name="arrow" size={17} /></button>
        {message && <p role="status" className="success-message">{message}</p>}
      </form>

      <aside className="create-aside">
        <span className="aside-label">미리보기</span>
        <article className="preview-card">
          <span className="category-label">{category} · {kind === 'INSTITUTION' ? '기관 주관 활동' : '자율 활동'}</span>
          <h3>{title.trim() || '활동 이름'}</h3>
          <p><Glyph name="pin" size={15} />{place ? place.name + (meetingPoint ? ' · ' + meetingPoint : '') : '장소를 골라 주세요'}</p>
          <p><Glyph name="calendar" size={15} />{friendlyDate(date)} {start} ~ {end}</p>
          <p><Glyph name="users" size={15} />0 / {capacity}명</p>
        </article>
        <div className={'expect ' + (reviewReasons.length ? 'review' : 'ok')}>
          <strong><Glyph name={reviewReasons.length ? 'alert' : 'check'} size={16} />{reviewReasons.length ? '관리자 확인 후 공개돼요' : '바로 공개될 예정이에요'}</strong>
          <span>{reviewReasons.length ? reviewReasons.join(' · ') : (place ? '장소: ' + place.classLabel + ' · ' : '') + '해 지기 전 종료'}</span>
          <small>위험한 단어가 있는지는 등록할 때 한 번 더 확인합니다.</small>
        </div>
        {place && <p className="small-print">장소 분류: {place.classLabel} · {classBadge[place.placeClass].text}</p>}
        <div className="help-card"><h3>안전하게 함께해요</h3><p>높은 곳·물속·전기·가스 작업, 의료행위, 금전 모금은 열 수 없습니다. 요양·병원·반려동물·학교 같은 장소, 해가 진 뒤 끝나는 활동은 확인 후 공개됩니다.</p></div>
      </aside>
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

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    box.current?.querySelectorAll<HTMLElement>('.wheel-col [aria-selected="true"]').forEach(item => item.scrollIntoView({ block: 'center' }))
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
