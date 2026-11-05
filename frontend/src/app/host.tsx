// 모집: start a new activity, recruit again from a past one, and see what I am recruiting now.
// The create form has three steps: 기본 정보 → 참여 안내 → 운영 설정. The server checks every rule again.
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError } from '../api'
import type { LiveActivity, User } from '../api'
import { categories, showToast } from '../App'
import { durationLabel } from '../create'
import { PlaceField } from '../placePicker'
import type { PlaceResult } from '../placePicker'
import { activityRules as r } from '../rules'
import type { Errors } from '../rules'
import { difficultyLabel, fieldIcon, placeKindLabel } from './cards'
import { ActionBar, dayWord, Empty, go, Loading, MIcon, PickField, Sheet, TopBar, WheelColumn, Wheels } from './ui'

export function HostScreen({ user, actions }: { user: User; actions: ReactNode }) {
  const [mine, setMine] = useState<LiveActivity[] | null>(null)
  useEffect(() => { api<LiveActivity[]>('/api/me/activities').then(setMine).catch(() => setMine([])) }, [user.id])
  const now = Date.now()
  const live = (mine ?? []).filter(a => ['RECRUITING', 'IN_PROGRESS', 'DRAFT'].includes(a.status) && new Date(`${a.date}T${a.startTime}:00+09:00`).getTime() + a.durationMinutes * 60_000 > now)
  const past = (mine ?? []).filter(a => !live.includes(a)).slice(0, 5)
  return <div className="m-screen">
    <TopBar title="봉사 만들기" actions={actions} />
    <div className="m-body">
      <p className="m-lede">처음부터 복잡하게 입력하지 않아도 돼요.</p>
      <section className="m-hero">
        <span className="m-hero-ico"><MIcon name="plus" size={26} /></span>
        <h2>새로운 봉사 모집하기</h2>
        <p>기본 정보 → 참여 안내 → 운영 설정</p>
        <a className="m-btn" href="#/create">새 활동 만들기</a>
      </section>
      {!mine ? <Loading /> : <>
        {live.length > 0 && <section className="m-section"><div className="m-section-head"><h2>모집 중인 활동</h2></div>
          <div className="m-list">{live.map(a => <a key={a.id} className="m-row" href={'#/manage/' + a.id}>
            <span className="m-row-ico f1"><MIcon name={fieldIcon[a.category] ?? 'sprout'} size={22} /></span>
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

// Which step shows each server field error.
const stepOf: Record<string, number> = { title: 1, category: 1, difficulty: 1, placeKind: 1, activityType: 1, place: 2, meetingPoint: 2, date: 2, time: 2, duration: 2, supplies: 2, description: 2, capacity: 3, safety: 3 }

export function CreateWizard({ user, from, editId }: { user: User; from?: number; editId?: number }) {
  const today = seoulToday()
  const [step, setStep] = useState(1)
  const [kind, setKind] = useState<'GENERAL' | 'INSTITUTION'>('GENERAL')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState(categories[0])
  const [difficulty, setDifficulty] = useState<'EASY' | 'NORMAL' | 'HARD'>('EASY')
  const [placeKind, setPlaceKind] = useState<'OUTDOOR' | 'INDOOR' | 'MIXED'>('OUTDOOR')
  const [newcomer, setNewcomer] = useState(true)
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
  const [sheet, setSheet] = useState<'date' | 'time' | 'duration' | null>(null)
  const [locked, setLocked] = useState(false)
  const [loading, setLoading] = useState(Boolean(from || editId))
  const canHost = user.organization?.status === 'APPROVED'

  // 다시 모집 (from) copies everything but the date; 수정 (editId) loads it all. With applicants only notes change.
  useEffect(() => {
    const id = editId ?? from
    if (!id) return
    api<LiveActivity>('/api/activities/' + id).then(a => {
      setKind(a.activityType); setTitle(a.title); setCategory(a.category); setDifficulty(a.difficulty ?? 'EASY'); setPlaceKind(a.placeKind ?? 'OUTDOOR')
      setNewcomer(a.newcomerOk === undefined || Boolean(a.newcomerOk)); setMeeting(a.meetingPoint ?? '')
      // Keep the start on the form's 10-minute grid inside 06:00 ~ 21:30.
      setStart(clock(Math.min(minutes(r.latestEnd) - r.durationMin, Math.max(minutes(r.earliestStart), Math.round(minutes(a.startTime) / 10) * 10)))); setDuration(a.durationMinutes)
      setCapacity(a.capacity); setDescription(a.description); setSupplies(a.supplies ?? [])
      setPlace({ placeId: a.placeId ?? undefined, name: a.placeName ?? '', address: a.placeAddress ?? '', categoryName: '', latitude: a.latitude ?? null, longitude: a.longitude ?? null, distanceMeters: null, placeClass: 'OPEN', classLabel: '지난 장소' })
      if (editId) { setDate(a.date); setSafety(true); setLocked((a.applicants ?? 0) > 0) }
    }).catch(() => setMessage('활동 정보를 불러오지 못했어요.')).finally(() => setLoading(false))
  }, [from, editId])

  const end = clock(minutes(start) + duration)
  const afterSunset = minutes(end) > minutes(sunset[Number(date.slice(5, 7)) - 1])
  const lengths = useMemo(() => { const out: number[] = []; for (let v = r.durationMin; v <= Math.min(r.durationMax, minutes(r.latestEnd) - minutes(start)); v += 10) out.push(v); return out }, [start])
  useEffect(() => { if (lengths.length && !lengths.includes(duration)) setDuration(lengths[lengths.length - 1]) }, [lengths, duration])

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
        description: description.trim(), safetyConfirmed: safety, supplies, difficulty, placeKind, newcomerOk: newcomer }
      const activity = await api<LiveActivity>(editId ? '/api/activities/' + editId : '/api/activities', editId ? 'PUT' : 'POST', body)
      setSaved({ kind: activity.status === 'RECRUITING' ? 'published' : 'review', activity })
    } catch (cause) {
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length) {
        const found = cause.fieldErrors
        setErrors(found)
        if (found.risk) setMessage(cause.message)
        const back = Math.min(...Object.keys(found).map(key => stepOf[key] ?? 3))
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
      <ActionBar><a className="m-btn" href={'#/manage/' + saved.activity.id}>모집 관리로 가기</a></ActionBar>
    </div></div>

  const stepTitle = ['기본 정보', '참여 안내', '운영 설정'][step - 1]
  const err = (key: string) => errors[key] && <span className="m-err" role="alert">{errors[key]}</span>
  return <div className="m-screen m-create">
    <TopBar title={editId ? '활동 고치기' : from ? '다시 모집하기' : '새 활동 만들기'} back={() => step > 1 ? setStep(step - 1) : go(editId ? '#/manage/' + editId : '#/host')} />
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
          <input name="title" className={'m-input' + (errors.title ? ' bad' : '')} placeholder="예: 공원 산책로 함께 걷고 줍기" maxLength={r.titleMax} value={title} disabled={locked} onChange={event => setTitle(event.target.value)} enterKeyHint="done" />
          <span className="m-count">{title.trim().length} / {r.titleMax}</span>{err('title')}</label>
        <div className="m-field"><span className="m-label">분야</span><div className="m-tiles">{categories.map(c =>
          <button type="button" key={c} className={'m-tile' + (category === c ? ' on' : '')} aria-pressed={category === c} disabled={locked} onClick={() => setCategory(c)}><MIcon name={fieldIcon[c] ?? 'sprout'} size={24} />{c}</button>)}</div></div>
        <div className="m-field"><span className="m-label">활동 강도 <small>처음 오는 사람이 고를 때 도움이 돼요</small></span><div className="m-seg wide">
          {(Object.keys(difficultyLabel) as (keyof typeof difficultyLabel)[]).map(key => <button type="button" key={key} disabled={locked} className={difficulty === key ? 'on' : ''} aria-pressed={difficulty === key} onClick={() => setDifficulty(key)}>{difficultyLabel[key]}</button>)}</div></div>
        <div className="m-field"><span className="m-label">장소 환경</span><div className="m-seg wide">
          {(Object.keys(placeKindLabel) as (keyof typeof placeKindLabel)[]).map(key => <button type="button" key={key} disabled={locked} className={placeKind === key ? 'on' : ''} aria-pressed={placeKind === key} onClick={() => setPlaceKind(key)}>{placeKindLabel[key]}</button>)}</div></div>
        <label className="m-switch"><span><strong>처음 오는 분 환영</strong><small>찾기에서 ‘처음 환영’으로 보여요</small></span>
          <input type="checkbox" role="switch" checked={newcomer} disabled={locked} onChange={event => setNewcomer(event.target.checked)} /><i /></label>
      </>}

      {step === 2 && <>
        <h2 className="m-h2">어디서, 언제 만나요?</h2>
        {!locked && <div className="m-legacy"><PlaceField value={place} meetingPoint={meeting} error={errors.place} onChange={(picked, point) => { setPlace(picked); setMeeting(point) }} /></div>}
        <label className="m-field"><span className="m-label">만나는 곳 <small>선택 · 100자</small></span>
          <input name="meetingPoint" className="m-input" placeholder="예: 정문 안내판 앞" maxLength={100} value={meeting} onChange={event => setMeeting(event.target.value)} enterKeyHint="done" />{err('meetingPoint')}</label>
        {!locked && <>
          <PickField name="date" label="날짜" icon="calendar" value={dayWord(date) + (dayWord(date).length <= 2 ? ' · ' + date.slice(5).replace('-', '/') : '')} error={errors.date} onOpen={() => setSheet('date')} />
          <div className="m-two">
            <PickField name="time" label="시작" icon="clock" value={start} error={errors.time} onOpen={() => setSheet('time')} />
            <PickField name="duration" label="활동 시간" icon="timer" value={durationLabel(duration)} onOpen={() => setSheet('duration')} />
          </div>
          <p className={'m-help' + (afterSunset ? ' warn' : '')}><MIcon name="sun" size={16} />{start} ~ {end} · {afterSunset ? `해 진 뒤(${sunset[Number(date.slice(5, 7)) - 1]} 이후) 끝나서 관리자 확인 후 공개돼요.` : '해 지기 전에 끝나요.'}</p>
          <div className="m-field"><span className="m-label">준비물 <small>누르면 ‘각자 챙겨요’ → ‘모집자가 준비’ → 빼기</small></span>
            <div className="m-chips wrap">{presetSupplies.concat(supplies.filter(s => !presetSupplies.includes(s.name)).map(s => s.name)).map(name => {
              const item = supplies.find(s => s.name === name)
              return <button type="button" key={name} className={'m-chip' + (item ? item.provided ? ' on blue' : ' on' : '')} aria-pressed={Boolean(item)}
                onClick={() => setSupplies(item ? item.provided ? supplies.filter(s => s.name !== name) : supplies.map(s => s.name === name ? { ...s, provided: true } : s) : supplies.length < 6 ? [...supplies, { name, provided: false }] : supplies)}>
                {name}{item && <small>{item.provided ? '모집자 준비' : '각자'}</small>}</button>
            })}</div>
            <span className="m-inline"><input className="m-input" placeholder="직접 추가 (10자)" maxLength={10} value={custom} onChange={event => setCustom(event.target.value)} enterKeyHint="done"
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); const name = custom.trim(); if (name && supplies.length < 6 && !supplies.some(s => s.name === name)) { setSupplies([...supplies, { name, provided: false }]); setCustom('') } } }} />
              <button type="button" className="m-btn line sm" disabled={!custom.trim() || supplies.length >= 6} onClick={() => { const name = custom.trim(); if (name && !supplies.some(s => s.name === name)) { setSupplies([...supplies, { name, provided: false }]); setCustom('') } }}>추가</button></span>
            {err('supplies')}</div>
        </>}
        <label className="m-field"><span className="m-label">활동 소개</span>
          <textarea name="description" className={'m-input' + (errors.description ? ' bad' : '')} rows={5} maxLength={r.descriptionMax} placeholder="무엇을 하는지, 처음 오는 분이 알아야 할 것을 적어 주세요. 연락처는 적지 마세요."
            value={description} onChange={event => setDescription(event.target.value)} />
          <span className="m-count">{description.trim().length} / {r.descriptionMax}</span>{err('description')}</label>
      </>}

      {step === 3 && <>
        <h2 className="m-h2">마지막으로 운영 설정</h2>
        {!locked && <div className="m-field"><span className="m-label">모집 인원 <small>나를 빼고 {r.capacityMin}~{r.capacityMax}명</small></span>
          <div className="m-stepper"><button type="button" aria-label="한 명 줄이기" disabled={capacity <= r.capacityMin} onClick={() => setCapacity(capacity - 1)}>−</button>
            <output name="capacity" aria-live="polite">{capacity}명</output>
            <button type="button" aria-label="한 명 늘리기" disabled={capacity >= r.capacityMax} onClick={() => setCapacity(capacity + 1)}>+</button></div>
          <span className="m-help">나 포함 {capacity + 1}명 · 정원이 차면 대기 순번을 받아요</span>{err('capacity')}</div>}
        <div className="m-summary">
          <strong>{title || '활동 이름'}</strong>
          <span>{category} · {difficultyLabel[difficulty]} · {placeKindLabel[placeKind]}{newcomer ? ' · 처음 환영' : ''}</span>
          <span>{dayWord(date)} {start}~{end} · {place?.name ?? '장소 미정'}{meeting ? ' · ' + meeting : ''}</span>
          {supplies.length > 0 && <span>준비물 {supplies.map(s => s.name + (s.provided ? '(준비)' : '')).join(', ')}</span>}
        </div>
        {!locked && <label className={'m-check box' + (errors.safety ? ' bad' : '')}><input name="safety" type="checkbox" checked={safety} onChange={event => setSafety(event.target.checked)} /><span className="m-box" />
          <span>높은 곳·물속·전기·가스 작업, 의료행위, 금전 모금이 없고, 사고가 나면 먼저 119에 신고해요.</span></label>}
        {err('safety')}
        <p className="m-help">Volink 활동은 공식 봉사실적이 아니며 자원봉사 종합보험이 적용되지 않아요.</p>
      </>}
      {message && <div className="m-note bad" role="alert">{message}</div>}
      <ActionBar>{step > 1 && <button type="button" className="m-btn line" onClick={() => setStep(step - 1)}>이전</button>}
        <button className="m-btn" disabled={busy}>{step < 3 ? '다음' : busy ? '저장하는 중…' : locked ? '고친 내용 저장' : editId ? '수정 완료' : '모집 시작하기'}</button></ActionBar>
    </form>}

    {sheet === 'date' && <DateSheet value={date} first={addDays(today, 1)} last={addDays(today, r.maxDaysAhead)} onClose={() => setSheet(null)} onPick={value => { setDate(value); setSheet(null); setErrors(e => ({ ...e, date: '' })) }} />}
    {sheet === 'time' && <TimeSheet value={start} onClose={() => setSheet(null)} onPick={value => { setStart(value); setSheet(null) }} />}
    {sheet === 'duration' && <DurationSheet value={duration} start={start} options={lengths} onClose={() => setSheet(null)} onPick={value => { setDuration(value); setSheet(null) }} />}
  </div>
}

export function DateSheet({ value, first, last, onPick, onClose }: { value: string; first: string; last: string; onPick: (date: string) => void; onClose: () => void }) {
  const [month, setMonth] = useState(value.slice(0, 7))
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
    <p className="m-help center">내일부터 {r.maxDaysAhead}일 안에서 고를 수 있어요</p>
  </Sheet>
}

export function TimeSheet({ value, onPick, onClose }: { value: string; onPick: (time: string) => void; onClose: () => void }) {
  const hours = Array.from({ length: 16 }, (_, i) => i + 6)
  const mins = [0, 10, 20, 30, 40, 50]
  const [h, setH] = useState(Number(value.slice(0, 2)))
  const [mm, setMm] = useState(Number(value.slice(3, 5)))
  const result = clock(Math.min(h * 60 + mm, minutes(r.latestEnd) - r.durationMin))
  return <Sheet title="시작 시간" onClose={onClose} footer={<><p className="m-help center">{r.earliestStart} ~ {clock(minutes(r.latestEnd) - r.durationMin)} · 10분 단위</p><button type="button" className="m-btn" onClick={() => onPick(result)}>{result} 시작</button></>}>
    <Wheels>
      <WheelColumn label="시" items={hours} value={h} render={x => (x < 12 ? '오전 ' : '오후 ') + (x % 12 === 0 ? 12 : x % 12) + '시'} onChange={setH} />
      <WheelColumn label="분" items={mins} value={mm} render={x => String(x).padStart(2, '0') + '분'} onChange={setMm} />
    </Wheels>
  </Sheet>
}

export function DurationSheet({ value, start, options, onPick, onClose }: { value: number; start: string; options: number[]; onPick: (minutes: number) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value)
  return <Sheet title="활동 시간" onClose={onClose} footer={<><p className="m-help center">{start} 시작 → <strong>{clock(minutes(start) + draft)} 종료</strong></p><button type="button" className="m-btn" onClick={() => onPick(draft)}>{durationLabel(draft)}</button></>}>
    <Wheels><WheelColumn label="활동 시간" items={options} value={options.includes(draft) ? draft : options[options.length - 1]} render={x => durationLabel(x)} onChange={setDraft} /></Wheels>
  </Sheet>
}
