// 기관센터 모집글 (2026-11-11): 모집 만들기·수정·복사 (여러 날짜 한 번에, 1365 연결) and one post's 관리 screen
// (신청자 · 출석·완료 · 소식, 일정 변경 · 취소 · 출석부 내려받기). Same API as the app; the server re-checks every rule.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError } from '../api'
import type { Applicant, LiveActivity, User } from '../api'
import { categories } from '../categories'
import { durationLabel, durationsFor } from '../create'
import { ActivityNews } from '../news'
import { PlaceField } from '../placePicker'
import type { PlaceResult } from '../placePicker'
import { activityRules as r } from '../rules'
import { showToast } from '../App'
import { Loading, PcIcon, when } from './ui'

type Hit = { keyword: string; level: string; reason: string }
type Checked = { title: Hit[]; description: Hit[]; supplies: Hit[] }
const seoulDay = (plus = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + plus * 86_400_000))
const times = Array.from({ length: 31 }, (_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
const fail = (cause: unknown) => cause instanceof ApiError ? (Object.values(cause.fieldErrors)[0] ?? cause.message) : '처리하지 못했어요.'
const vmsPattern = /^https:\/\/(www\.)?1365\.go\.kr\/\S*$/

function Switch({ on, onChange, label, note }: { on: boolean; onChange: (on: boolean) => void; label: string; note?: string }) {
  return <label className="pc-opt"><input type="checkbox" role="switch" checked={on} onChange={e => onChange(e.target.checked)} className="pc-switch" /><span><b>{label}</b>{note && <small>{note}</small>}</span></label>
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="pc-sec" aria-label={title}><h2>{title}</h2>{children}</section>
}

export function OrgCreate({ user, editId, fromId }: { user: User; editId?: number; fromId?: number }) {
  const [loaded, setLoaded] = useState(!editId && !fromId)
  const [locked, setLocked] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [dates, setDates] = useState<string[]>([])
  const [pickDate, setPickDate] = useState(seoulDay(2))
  const [time, setTime] = useState('10:00')
  const [duration, setDuration] = useState(120)
  const [place, setPlace] = useState<PlaceResult | null>(null)
  const [meetingPoint, setMeetingPoint] = useState('')
  const [capacity, setCapacity] = useState(5)
  const [difficulty, setDifficulty] = useState('EASY')
  const [placeKind, setPlaceKind] = useState('OUTDOOR')
  const [newcomer, setNewcomer] = useState(true)
  const [autoApprove, setAutoApprove] = useState(false)
  const [supplies, setSupplies] = useState<{ name: string; provided: boolean }[]>([])
  const [vmsOn, setVmsOn] = useState(false)
  const [vmsLink, setVmsLink] = useState('')
  const [safety, setSafety] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [words, setWords] = useState<Checked | null>(null)

  useEffect(() => {
    const source = editId ?? fromId
    if (!source) return
    api<LiveActivity>('/api/activities/' + source).then(a => {
      setTitle(a.title); setCategory(a.category); setDescription(a.description); setTime(a.startTime); setDuration(a.durationMinutes)
      setPlace({ placeId: a.placeId ?? undefined, name: a.placeName ?? '', address: a.placeAddress ?? '', categoryName: '', latitude: a.latitude ?? null, longitude: a.longitude ?? null, distanceMeters: null, placeClass: 'OPEN', classLabel: '' })
      setMeetingPoint(a.meetingPoint ?? ''); setCapacity(a.capacity); setDifficulty(a.difficulty ?? 'EASY'); setPlaceKind(a.placeKind ?? 'OUTDOOR')
      setNewcomer(a.newcomerOk === undefined ? true : Boolean(a.newcomerOk)); setAutoApprove(Boolean(a.autoApprove)); setSupplies(a.supplies ?? [])
      setVmsOn(Boolean(a.vmsLink)); setVmsLink(a.vmsLink ?? '')
      if (editId) { setDates([a.date]); setSafety(true); setLocked((a.applicants ?? 0) > 0) }
      setLoaded(true)
    }).catch(() => { setMessage('모집글을 불러오지 못했어요.'); setLoaded(true) })
  }, [editId, fromId])

  // Words that send a post to review or stop it, checked by the server while typing (nothing is saved).
  useEffect(() => {
    const timer = window.setTimeout(() => { api<Checked>('/api/activities/check', 'POST', { title, description, supplies: supplies.map(s => s.name) }).then(setWords).catch(() => {}) }, 400)
    return () => window.clearTimeout(timer)
  }, [title, description, supplies])
  const hits = [...(words?.title ?? []), ...(words?.description ?? []), ...(words?.supplies ?? [])]
  const blocked = hits.filter(h => h.level === 'BLOCKED'), review = hits.filter(h => h.level !== 'BLOCKED')
  const lengths = useMemo(() => durationsFor(time), [time])
  useEffect(() => { if (!lengths.includes(duration)) setDuration(lengths[lengths.length - 1] ?? 30) }, [lengths, duration])

  if (!loaded) return <Loading />

  function addDate() {
    if (!pickDate || dates.includes(pickDate)) return
    if (dates.length >= 8) { setErrors(e => ({ ...e, date: '한 번에 8개 날짜까지 올릴 수 있어요.' })); return }
    setDates([...dates, pickDate].sort()); setErrors(({ date: _, ...rest }) => rest)
  }

  async function submit() {
    const found: Record<string, string> = {}
    const t = title.trim(), d = description.trim()
    if (!locked) {
      if (t.length < r.titleMin || t.length > r.titleMax) found.title = `활동 이름을 ${r.titleMin}~${r.titleMax}자로 적어 주세요.`
      if (!category) found.category = '분야를 골라 주세요.'
      if (!dates.length) found.date = '날짜를 하나 이상 넣어 주세요.'
      if (!place) found.place = '장소를 골라 주세요.'
      if (!safety) found.safety = '안내를 확인해 주세요.'
      if (vmsOn && !vmsPattern.test(vmsLink.trim())) found.vmsLink = '1365 모집 페이지 주소(https://www.1365.go.kr/…)를 붙여 넣어 주세요.'
    }
    if (d.length < r.descriptionMin) found.description = `소개를 ${r.descriptionMin}자 이상 적어 주세요.`
    setErrors(found)
    if (Object.keys(found).length) { setMessage('입력 내용을 확인해 주세요.'); return }
    setBusy(true); setMessage('')
    try {
      if (editId && locked) {
        await api('/api/activities/' + editId + '/notes', 'PATCH', { description: d, meetingPoint })
        showToast('소개와 만나는 곳을 고쳤어요'); window.location.hash = '#/org/activity/' + editId; return
      }
      const chosen = place!.kakaoId
        ? { place: { kakaoId: place!.kakaoId, name: place!.name, address: place!.address, categoryName: place!.categoryName, latitude: place!.latitude, longitude: place!.longitude, placeClass: place!.placeClass, classLabel: place!.classLabel, token: place!.token } }
        : { placeId: place!.placeId }
      const body = (date: string) => ({ activityType: 'INSTITUTION', title: t, category, ...chosen, meetingPoint, date, time, capacity, durationMinutes: duration, description: d, safetyConfirmed: true,
        supplies, difficulty, placeKind, newcomerOk: newcomer, autoApprove, vmsLink: vmsOn ? vmsLink.trim() : '' })
      if (editId) {
        const saved = await api<LiveActivity>('/api/activities/' + editId, 'PUT', body(dates[0]))
        showToast(saved.status === 'DRAFT' ? '고쳤어요 · 운영자 확인 뒤 공개돼요' : '고쳤어요'); window.location.hash = '#/org/activity/' + editId; return
      }
      const made: LiveActivity[] = []
      for (const date of dates) {
        try { made.push(await api<LiveActivity>('/api/activities', 'POST', body(date))) }
        catch (cause) {
          if (!made.length) throw cause
          setMessage(`${when(date)}부터는 올리지 못했어요: ${fail(cause)}`); break
        }
      }
      const drafts = made.filter(a => a.status === 'DRAFT').length
      showToast(made.length > 1 ? `${made.length}개 날짜로 올렸어요` : '모집을 올렸어요', drafts ? '운영자 확인 뒤 공개돼요' : '앱과 PC에 바로 공개됐어요')
      window.location.hash = '#/org/activity/' + made[0].id
    } catch (cause) {
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length) setErrors(cause.fieldErrors)
      setMessage(fail(cause))
    } finally { setBusy(false) }
  }

  const err = (k: string) => errors[k] ? <em role="alert">{errors[k]}</em> : null
  const preview = <div className="pc-phone" aria-label="앱에서 보이는 모습"><div className="sc">
    <div className="cover" />
    <div className="body">
      <div className="pc-chips" style={{ gap: 4 }}>{category && <span className="pc-tag g">{category}</span>}<span className="pc-tag">{({ EASY: '가벼워요', NORMAL: '보통', HARD: '힘써요' } as Record<string, string>)[difficulty]}</span>{newcomer && <span className="pc-tag g">처음 환영</span>}<span className="pc-tag blu">{user.organization?.name} 주관</span></div>
      <b className="t">{title.trim() || '활동 이름'}</b>
      <span className="mu">{dates[0] ? when(dates[0], time) : '날짜'} · {durationLabel(duration)}</span>
      <span className="mu">{[place?.name || '장소', meetingPoint].filter(Boolean).join(' · ')}</span>
      {vmsOn && <div className="card"><b style={{ color: 'var(--pc-blu)' }}>1365에도 등록된 활동</b><span className="mu">1365 실적은 1365에서 신청해야 인정돼요</span></div>}
      {dates.length > 1 && <div className="card"><b>다른 날짜도 있어요</b><span className="mu">{dates.slice(1).map(x => when(x).replace(/ \(.\)/, '')).join(' · ')}</span></div>}
      <p className="desc">{description.trim() || '소개'}</p>
    </div>
    <div className="cta">신청하기</div></div></div>

  return <div className="pc-create">
    <div className="form">
      <div className="pc-head"><a className="mu" href={editId ? '#/org/activity/' + editId : '#/org/activities'}>‹ {editId ? '모집글 관리' : '모집 관리'}</a><h1>{editId ? '모집글 고치기' : fromId ? '복사해서 새 모집' : '모집 만들기'}</h1></div>
      {locked && <p className="pc-ok" style={{ background: 'var(--pc-ambs)', color: 'var(--pc-amb)' }}>신청한 사람이 있어 소개와 만나는 곳만 고칠 수 있어요. 일정은 ‘일정 변경’으로 한 번 바꿀 수 있어요.</p>}
      <div className="pc-pn">
        <Section title="기본 정보">
          <label className="pc-f"><span>활동 이름</span><input className={'pc-in' + (errors.title ? ' bad' : '')} value={title} maxLength={r.titleMax} disabled={locked} onChange={e => setTitle(e.target.value)} />{err('title')}</label>
          <div className="pc-f"><span>분야</span><div className="pc-chips" role="group" aria-label="분야">{categories.map(c => <button key={c} type="button" disabled={locked} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div>{err('category')}</div>
          <label className="pc-f"><span>소개 <small>{description.trim().length} / {r.descriptionMax}</small></span><textarea className={'pc-ta' + (errors.description ? ' bad' : '')} value={description} maxLength={r.descriptionMax} style={{ minHeight: 110 }} onChange={e => setDescription(e.target.value)} />{err('description')}</label>
        </Section>
        <Section title="일정">
          <div className="pc-two">
            <label className="pc-f"><span>시작 시각</span><select className="pc-in" value={time} disabled={locked} onChange={e => setTime(e.target.value)}>{times.filter(x => durationsFor(x).length).map(x => <option key={x}>{x}</option>)}</select></label>
            <label className="pc-f"><span>활동 시간</span><select className="pc-in" value={duration} disabled={locked} onChange={e => setDuration(Number(e.target.value))}>{lengths.map(x => <option key={x} value={x}>{durationLabel(x)}</option>)}</select></label>
          </div>
          <div className="pc-f"><span>날짜 {!editId && <small>여러 날짜를 넣으면 날짜마다 모집글이 따로 만들어져요</small>}</span>
            {!editId && <div style={{ display: 'flex', gap: 8 }}><input className="pc-in" type="date" aria-label="날짜 고르기" style={{ width: 200 }} min={seoulDay(1)} max={seoulDay(r.maxDaysAhead)} value={pickDate} onChange={e => setPickDate(e.target.value)} />
              <button type="button" className="pc-btn line" onClick={addDate}><PcIcon name="plus" />날짜 추가</button></div>}
            <div className="pc-dates">{dates.length === 0 ? <span className="mu">아직 넣은 날짜가 없어요</span> : dates.map(x => <span key={x}>{when(x)}{!editId && <button type="button" aria-label={when(x) + ' 빼기'} onClick={() => setDates(dates.filter(y => y !== x))}>×</button>}</span>)}</div>
            {err('date')}{err('time')}</div>
        </Section>
        <Section title="장소">
          <div className="pc-legacy-field">{locked ? <p><b>{place?.name}</b></p> : <PlaceField value={place} meetingPoint={meetingPoint} error={errors.place} onChange={(picked, meeting) => { setPlace(picked); setMeetingPoint(meeting); setErrors(({ place: _, ...rest }) => rest) }} />}</div>
          <label className="pc-f"><span>만나는 곳 <small>(선택)</small></span><input className="pc-in" value={meetingPoint} maxLength={255} placeholder="예: 센터 마당 천막 앞" onChange={e => setMeetingPoint(e.target.value)} /></label>
        </Section>
        <Section title="인원·조건">
          <div className="pc-two">
            <label className="pc-f"><span>모집 인원 <small>담당자 빼고 {r.capacityMin}~{r.capacityMax}명</small></span><select className="pc-in" value={capacity} disabled={locked} onChange={e => setCapacity(Number(e.target.value))}>{Array.from({ length: r.capacityMax }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}명</option>)}</select></label>
            <div className="pc-f"><span>활동 강도</span><div className="pc-chips">{[['EASY', '가벼워요'], ['NORMAL', '보통'], ['HARD', '힘써요']].map(([k, label]) => <button key={k} type="button" disabled={locked} aria-pressed={difficulty === k} onClick={() => setDifficulty(k)}>{label}</button>)}</div></div>
          </div>
          <div className="pc-f"><span>장소 형태</span><div className="pc-chips">{[['OUTDOOR', '야외'], ['INDOOR', '실내'], ['MIXED', '실내·야외']].map(([k, label]) => <button key={k} type="button" disabled={locked} aria-pressed={placeKind === k} onClick={() => setPlaceKind(k)}>{label}</button>)}</div></div>
          <div><Switch on={newcomer} onChange={setNewcomer} label="처음 환영" note="처음 오는 사람도 편하게 신청할 수 있다고 보여 줘요" />
            <Switch on={autoApprove} onChange={setAutoApprove} label="자동 승인" note="빈자리가 있으면 신청하자마자 확정돼요" /></div>
        </Section>
        <Section title="1365">
          <Switch on={vmsOn} onChange={v => { if (!locked) setVmsOn(v) }} label="1365에도 등록한 활동이에요" note="참여자에게 1365 모집 페이지 링크를 보여 줘요. 1365 실적은 1365에서 신청해야 인정돼요" />
          {vmsOn && <label className="pc-f"><span>1365 모집 페이지 주소</span><input className={'pc-in' + (errors.vmsLink ? ' bad' : '')} value={vmsLink} disabled={locked} placeholder="https://www.1365.go.kr/…" onChange={e => setVmsLink(e.target.value)} />{err('vmsLink')}</label>}
        </Section>
        {!editId && <Section title="안내 확인"><label className="pc-check"><input type="checkbox" className="pc-cb" checked={safety} onChange={e => setSafety(e.target.checked)} /><span>위험한 일은 하지 않고, Volink 활동은 공식 봉사실적이 아니며 자원봉사 종합보험이 적용되지 않음을 참여자에게 안내합니다.</span></label>{err('safety')}</Section>}
      </div>
    </div>
    <aside className="side">
      <b className="mu" style={{ fontSize: 12.5 }}>앱에서 보이는 모습</b>
      {preview}
      {blocked.length ? <p className="pc-err" style={{ margin: 0 }}>올릴 수 없는 내용이 있어요: {blocked.map(h => `‘${h.keyword}’`).join(', ')}</p>
        : review.length ? <p className="pc-ok" style={{ margin: 0, background: 'var(--pc-ambs)', color: 'var(--pc-amb)' }}>{review.map(h => `‘${h.keyword}’`).join(', ')} 때문에 운영자 확인 뒤 공개돼요</p>
        : <p className="pc-ok" style={{ margin: 0 }}>확인이 필요한 단어가 없어요</p>}
      {message && <p className="pc-err" role="alert" style={{ margin: 0 }}>{message}</p>}
      <button type="button" className="pc-btn lg wide" disabled={busy || blocked.length > 0} onClick={() => void submit()}>{busy ? '올리는 중…' : editId ? '고친 내용 저장' : dates.length > 1 ? `${dates.length}개 날짜로 올리기` : '모집 올리기'}</button>
    </aside>
  </div>
}

/* ---------------- 모집글 관리 ---------------- */

const statusWord: Record<string, [string, string]> = { RECRUITING: ['모집 중', 'g'], DRAFT: ['검토 중', 'amb'], IN_PROGRESS: ['진행 중', 'blu'], FINISHED: ['끝남', ''], CANCELLED: ['취소', 'red'] }
const applicantWord: Record<string, [string, string]> = { APPLIED: ['승인 대기', 'amb'], CONFIRMED: ['확정', 'g'], WAITLISTED: ['대기', ''], OFFERED: ['자리 제안 중', 'blu'], CHECKED_IN: ['출석', 'g'], COMPLETED: ['완료', 'g'], NO_SHOW: ['불참', 'red'], CANCELLED: ['취소', ''], REJECTED: ['거절', ''], EXPIRED: ['만료', ''] }
const method = (a: Applicant) => a.checkInMethod ? (a.checkInMethod === 'MANUAL' ? '수동 확인' : a.checkInMethod === 'CODE' ? '숫자 코드' : 'QR') : '-'
type Roster = { capacity: number; confirmed: number; items: Applicant[] }

export function OrgManage({ id, onChanged }: { id: number; onChanged: () => void }) {
  const [a, setA] = useState<LiveActivity | null>(null)
  const [roster, setRoster] = useState<Roster | null>(null)
  const [missing, setMissing] = useState(false)
  const [tab, setTab] = useState<'people' | 'attend' | 'news'>('people')
  const [sheet, setSheet] = useState<'move' | 'cancel' | 'delete' | null>(null)
  const load = useCallback(() => {
    api<LiveActivity>('/api/activities/' + id).then(setA).catch(() => setMissing(true))
    api<Roster>('/api/activities/' + id + '/participations').then(setRoster).catch(() => setRoster(null))
  }, [id])
  useEffect(load, [load])
  const reload = () => { load(); onChanged() }
  if (missing) return <p className="pc-err">모집글을 찾을 수 없어요.</p>
  if (!a) return <Loading />
  const start = new Date(`${a.date}T${a.startTime}:00+09:00`).getTime()
  const ended = start + a.durationMinutes * 60_000 < Date.now() || a.status === 'FINISHED'
  const before = start > Date.now() && ['RECRUITING', 'DRAFT'].includes(a.status)
  const [word, tone] = statusWord[a.status] ?? [a.status, '']
  const count = (states: string[]) => (roster?.items ?? []).filter(i => states.includes(i.status)).length
  const canMove = a.status === 'RECRUITING' && (a.rescheduleCount ?? 0) === 0 && start - Date.now() > 24 * 3_600_000
  return <>
    <div className="pc-head"><a className="mu" href="#/org/activities">‹ 모집 관리</a></div>
    <section className="pc-pn" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="모집글">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className={'pc-tag ' + tone}>{word}</span>{a.vmsLink && <a className="pc-tag blu" href={a.vmsLink} target="_blank" rel="noreferrer">1365에도 등록</a>}
        <h1>{a.title}</h1>
        <div className="pc-sp" />
        {before && <a className="pc-btn sm line" href={'#/org/activity/' + id + '/edit'}>고치기</a>}
        {canMove && <button className="pc-btn sm line" onClick={() => setSheet('move')}>일정 변경</button>}
        <a className="pc-btn sm line" href={'#/org/create?from=' + id}>복사해서 새 모집</a>
        <button className="pc-btn sm line" onClick={() => { void navigator.clipboard?.writeText(window.location.origin + '/#/activity/' + id).then(() => showToast('모집글 링크를 복사했어요')) }}>링크 복사</button>
        {before && ((a.applicants ?? 0) > 0
          ? <button className="pc-btn sm line" style={{ color: 'var(--pc-red)' }} onClick={() => setSheet('cancel')}>모집 취소</button>
          : <button className="pc-btn sm line" style={{ color: 'var(--pc-red)' }} onClick={() => setSheet('delete')}>삭제</button>)}
      </div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{when(a.date, a.startTime)} · {durationLabel(a.durationMinutes)}</span><span className="mu">{[a.placeName, a.meetingPoint].filter(Boolean).join(' · ')}</span>
        <div className="pc-sp" /><span className="mu">확정</span><b>{roster ? roster.confirmed : a.confirmed} / {a.capacity}명</b>
        <div className="pc-prog" style={{ width: 170 }}><i style={{ width: Math.min(100, (roster?.confirmed ?? a.confirmed) / Math.max(1, a.capacity) * 100) + '%' }} /></div>
        <span className="mu">승인 대기 {count(['APPLIED'])} · 대기 {count(['WAITLISTED', 'OFFERED'])}</span></div>
      {a.status === 'DRAFT' && <p className="pc-ok" style={{ margin: 0, background: 'var(--pc-ambs)', color: 'var(--pc-amb)' }}>{a.reviewNote ? `운영자가 반려했어요: ${a.reviewNote}` : `운영자 확인 뒤 공개돼요${a.riskReasons ? ` · ${a.riskReasons}` : ''}`}</p>}
      {a.status === 'CANCELLED' && <p className="pc-err" style={{ margin: 0 }}>취소한 모집이에요{a.cancellation ? ` · ${a.cancellation.reasonLabel}` : ''}</p>}
    </section>
    <section className="pc-pn">
      <div className="pc-tabs" role="tablist">{([['people', `신청자 ${roster?.items.length ?? ''}`], ['attend', '출석·완료'], ['news', '소식']] as const).map(([k, label]) =>
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}</div>
      {tab === 'people' && <People a={a} roster={roster} ended={ended} onChanged={reload} />}
      {tab === 'attend' && <Attendance a={a} roster={roster} ended={ended} onChanged={reload} />}
      {tab === 'news' && <div style={{ padding: '6px 18px 18px' }} className="pc-legacy-in"><ActivityNews activityId={id} organizer /></div>}
    </section>
    {sheet === 'move' && <MoveDialog a={a} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload() }} />}
    {sheet === 'cancel' && <CancelDialog a={a} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload() }} />}
    {sheet === 'delete' && <Dialog title="이 모집글을 지울까요?" onClose={() => setSheet(null)}>
      <p className="mu">신청한 사람이 없어서 바로 지울 수 있어요. 지우면 되돌릴 수 없어요.</p>
      <DialogButtons onClose={() => setSheet(null)} label="지우기" danger run={async () => { await api('/api/activities/' + id, 'DELETE'); showToast('모집글을 지웠어요'); onChanged(); window.location.hash = '#/org/activities' }} />
    </Dialog>}
  </>
}

function People({ a, roster, ended, onChanged }: { a: LiveActivity; roster: Roster | null; ended: boolean; onChanged: () => void }) {
  const [filter, setFilter] = useState('ALL')
  const [checked, setChecked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok?: string; error?: string }>({})
  const [cap, setCap] = useState<number | null>(null)
  if (!roster) return <Loading />
  const groups: [string, string, string[]][] = [['ALL', '전체', ['APPLIED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'WAITLISTED', 'OFFERED', 'NO_SHOW']], ['APPLIED', '승인 대기', ['APPLIED']], ['CONFIRMED', '확정', ['CONFIRMED', 'CHECKED_IN', 'COMPLETED']], ['WAITLISTED', '대기', ['WAITLISTED', 'OFFERED']], ['OTHER', '취소·거절', ['CANCELLED', 'REJECTED', 'EXPIRED']]]
  const group = groups.find(g => g[0] === filter)!
  const rows = roster.items.filter(i => group[2].includes(i.status))
  const choosable = rows.filter(i => i.status === 'APPLIED' && !ended)
  async function decide(approve: boolean) {
    setBusy(true); setNote({})
    let ok = 0; const failed: string[] = []
    for (const pid of checked) { try { await api('/api/participations/' + pid + '/' + (approve ? 'approve' : 'reject'), 'POST', {}); ok++ } catch (cause) { failed.push(fail(cause)) } }
    setBusy(false); setChecked([])
    setNote({ ok: ok ? `${ok}명을 ${approve ? '확정했어요. 각자에게 알림이 가요' : '거절했어요'}.` : undefined, error: failed.length ? `${failed.length}명은 처리하지 못했어요: ${failed[0]}` : undefined })
    onChanged()
  }
  async function toggleAuto(on: boolean) {
    try { await api('/api/activities/' + a.id + '/auto-approve', 'PUT', { on }); setNote({ ok: on ? '자동 승인을 켰어요' : '자동 승인을 껐어요' }); onChanged() } catch (cause) { setNote({ error: fail(cause) }) }
  }
  async function saveCap() {
    try { const out = await api<{ offered: number; confirmed: number }>('/api/activities/' + a.id + '/capacity', 'PUT', { capacity: cap }); setNote({ ok: `${cap}명으로 바꿨어요${out.offered ? ` · 대기 ${out.offered}명에게 자리를 제안했어요` : out.confirmed ? ` · ${out.confirmed}명을 바로 확정했어요` : ''}` }); setCap(null); onChanged() }
    catch (cause) { setNote({ error: fail(cause) }) }
  }
  const room = Math.max(0, roster.capacity - roster.confirmed)
  return <>
    <div style={{ padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid var(--pc-line)', flexWrap: 'wrap' }}>
      <div className="pc-chips">{groups.map(([k, label, states]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => { setFilter(k); setChecked([]) }}>{label} {roster.items.filter(i => states.includes(i.status)).length}</button>)}</div>
      <div className="pc-sp" />
      {a.status === 'RECRUITING' && !ended && <><label className="pc-opt" style={{ border: 0, padding: 0 }}><input type="checkbox" role="switch" className="pc-switch" checked={Boolean(a.autoApprove)} onChange={e => void toggleAuto(e.target.checked)} /><span><b>자동 승인</b></span></label>
        {cap == null ? <button className="pc-btn sm line" onClick={() => setCap(a.capacity)}>인원 바꾸기</button>
          : <span style={{ display: 'flex', gap: 6 }}><select className="pc-in" style={{ height: 30, width: 90 }} aria-label="모집 인원" value={cap} onChange={e => setCap(Number(e.target.value))}>{Array.from({ length: r.capacityMax }, (_, i) => i + 1).map(n => <option key={n} value={n} disabled={n < roster.confirmed}>{n}명</option>)}</select><button className="pc-btn sm" onClick={() => void saveCap()}>저장</button><button className="pc-btn sm line" onClick={() => setCap(null)}>닫기</button></span>}</>}
    </div>
    {note.ok && <p className="pc-ok" role="status" style={{ margin: '10px 16px 0' }}>{note.ok}</p>}{note.error && <p className="pc-err" role="alert" style={{ margin: '10px 16px 0' }}>{note.error}</p>}
    {rows.length === 0 ? <p className="pc-empty">{filter === 'APPLIED' ? '승인을 기다리는 신청이 없어요.' : '해당하는 사람이 없어요.'}</p>
      : <table className="pc-tbl"><thead><tr><th style={{ width: 40 }}>{choosable.length > 0 && <input type="checkbox" className="pc-cb" aria-label="승인 대기 모두 고르기" checked={checked.length === choosable.length} onChange={e => setChecked(e.target.checked ? choosable.map(x => x.id) : [])} />}</th><th>이름</th><th>신청</th><th>상태</th><th>출석</th></tr></thead>
        <tbody>{rows.map(p => <tr key={p.id} className={checked.includes(p.id) ? 'on' : ''}>
          <td>{p.status === 'APPLIED' && !ended && <input type="checkbox" className="pc-cb" aria-label={p.name + ' 고르기'} checked={checked.includes(p.id)} onChange={e => setChecked(old => e.target.checked ? [...old, p.id] : old.filter(x => x !== p.id))} />}</td>
          <td className="t">{p.name}</td><td className="mu nw">{p.appliedAt}</td>
          <td><span className={'pc-tag ' + (applicantWord[p.status]?.[1] ?? '')}>{applicantWord[p.status]?.[0] ?? p.status}{p.status === 'WAITLISTED' && p.waitOrder ? ` ${p.waitOrder}번` : ''}</span>{p.lateMinutes ? <small>{p.lateMinutes}분 늦는다고 알렸어요</small> : null}</td>
          <td className="mu">{method(p)}{p.checkedInAt ? ' ' + p.checkedInAt : ''}</td></tr>)}</tbody></table>}
    {checked.length > 0 && <div className="pc-bulk"><b>{checked.length}명 선택</b><span className="mu">{checked.length > room ? `남은 자리는 ${room}명이에요. 넘는 신청은 확정되지 않아요` : `승인하면 확정 ${roster.confirmed + checked.length} / ${roster.capacity}명 · 각자에게 알림이 가요`}</span>
      <div className="pc-sp" /><button className="pc-btn line" disabled={busy} onClick={() => void decide(false)}>거절</button><button className="pc-btn" disabled={busy} onClick={() => void decide(true)}>{busy ? '처리하는 중…' : `${checked.length}명 승인`}</button></div>}
    <p className="pc-note" style={{ padding: '10px 16px' }}>이름은 일부만 보이고 연락처는 공개하지 않아요. 확정자가 취소하면 대기 1번에게 자동으로 자리를 제안해요.</p>
  </>
}

function Attendance({ a, roster, ended, onChanged }: { a: LiveActivity; roster: Roster | null; ended: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok?: string; error?: string }>({})
  if (!roster) return <Loading />
  const people = roster.items.filter(i => ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'].includes(i.status))
  const here = people.filter(i => ['CHECKED_IN', 'COMPLETED'].includes(i.status)).length
  const waiting = people.filter(i => i.status === 'CHECKED_IN').length
  async function completeAll() {
    setBusy(true); setNote({})
    try { await api('/api/activities/' + a.id + '/complete', 'POST', {}); setNote({ ok: `출석한 ${waiting}명을 완료 처리했어요. 활동 기록이 만들어졌어요.` }); onChanged() } catch (cause) { setNote({ error: fail(cause) }) } finally { setBusy(false) }
  }
  function download() {
    const head = ['이름', '상태', '출석 방법', '출석 시각', '신청 시각']
    const rows = people.map(p => [p.name, applicantWord[p.status]?.[0] ?? p.status, method(p), p.checkedInAt ?? '', p.appliedAt])
    const csv = '﻿' + [[`${a.title} · ${a.date} ${a.startTime}`], head, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `volink-attendance-${a.date}-${a.id}.csv`
    document.body.appendChild(link); link.click(); link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <>
    <div className="pc-stats" style={{ padding: '14px 16px', borderBottom: '1px solid var(--pc-line)' }}>
      <div className="pc-stat"><span>확정</span><b>{people.length}명</b></div><div className="pc-stat"><span>출석</span><b>{here}명</b></div>
      <div className="pc-stat"><span>완료 대기</span><b>{waiting}명</b></div><div className="pc-stat"><span>출석 시작</span><b style={{ fontSize: 17 }}>{a.checkinOpenedAt ? a.checkinOpenedAt.slice(11, 16) : '아직'}</b><small>현장에서 앱으로 열어요</small></div>
    </div>
    {note.ok && <p className="pc-ok" role="status" style={{ margin: '10px 16px 0' }}>{note.ok}</p>}{note.error && <p className="pc-err" role="alert" style={{ margin: '10px 16px 0' }}>{note.error}</p>}
    {people.length === 0 ? <p className="pc-empty">확정된 사람이 없어요.</p>
      : <table className="pc-tbl"><thead><tr><th>이름</th><th>출석 방법</th><th>출석 시각</th><th>상태</th></tr></thead><tbody>{people.map(p =>
        <tr key={p.id}><td className="t">{p.name}</td><td>{method(p)}{p.checkInReason ? <small>{p.checkInReason}</small> : null}</td><td className="mu">{p.checkedInAt ?? '-'}</td><td><span className={'pc-tag ' + (applicantWord[p.status]?.[1] ?? '')}>{p.status === 'CONFIRMED' && ended ? '출석 안 함' : applicantWord[p.status]?.[0] ?? p.status}</span></td></tr>)}</tbody></table>}
    <div className="pc-bulk"><button className="pc-btn line" onClick={download}><PcIcon name="download" />출석부 내려받기</button><span className="mu">엑셀에서 열리는 CSV 파일이에요</span><div className="pc-sp" />
      {ended ? <button className="pc-btn" disabled={busy || waiting === 0} onClick={() => void completeAll()}>{waiting ? `${waiting}명 완료 처리` : '완료 처리할 사람 없음'}</button>
        : <span className="mu">활동이 끝나면 완료 처리할 수 있어요</span>}</div>
  </>
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [onClose])
  return <div className="pc-dim" onClick={onClose}><div className="pc-pn pc-dialog" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}><h2>{title}</h2>{children}</div></div>
}
function DialogButtons({ onClose, label, run, danger, disabled }: { onClose: () => void; label: string; run: () => Promise<void>; danger?: boolean; disabled?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <>{error && <p className="pc-err" role="alert" style={{ margin: 0 }}>{error}</p>}<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button className="pc-btn line" onClick={onClose}>닫기</button>
    <button className={'pc-btn' + (danger ? ' red' : '')} disabled={busy || disabled} onClick={async () => { setBusy(true); setError(''); try { await run() } catch (cause) { setError(fail(cause)) } finally { setBusy(false) } }}>{busy ? '처리하는 중…' : label}</button></div></>
}

function MoveDialog({ a, onClose, onDone }: { a: LiveActivity; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(a.date), [time, setTime] = useState(a.startTime), [duration, setDuration] = useState(a.durationMinutes), [reason, setReason] = useState('')
  return <Dialog title="일정 변경" onClose={onClose}>
    <p className="mu">일정은 한 번만 바꿀 수 있어요. 바꾸면 신청한 사람 모두에게 알림이 가요.</p>
    <div className="pc-two"><label className="pc-f"><span>날짜</span><input className="pc-in" type="date" min={seoulDay(1)} max={seoulDay(r.maxDaysAhead)} value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="pc-f"><span>시작 시각</span><select className="pc-in" value={time} onChange={e => setTime(e.target.value)}>{times.map(x => <option key={x}>{x}</option>)}</select></label></div>
    <label className="pc-f"><span>활동 시간</span><select className="pc-in" value={duration} onChange={e => setDuration(Number(e.target.value))}>{durationsFor(time).map(x => <option key={x} value={x}>{durationLabel(x)}</option>)}</select></label>
    <label className="pc-f"><span>바꾸는 이유 <small>(신청자에게 보여요)</small></span><input className="pc-in" value={reason} maxLength={200} onChange={e => setReason(e.target.value)} /></label>
    <DialogButtons onClose={onClose} label="일정 바꾸기" disabled={reason.trim().length < 2} run={async () => { await api('/api/activities/' + a.id + '/reschedule', 'POST', { date, time, durationMinutes: duration, reason }); showToast('일정을 바꿨어요', '신청자에게 알림을 보냈어요'); onDone() }} />
  </Dialog>
}

const cancelReasons: [string, string][] = [['WEATHER', '기상 악화 및 안전 문제'], ['PLACE', '장소·시설 이용 불가'], ['STAFF', '운영 인력 부족'], ['PERSONAL', '기관 사정'], ['OTHER', '기타 사유']]
function CancelDialog({ a, onClose, onDone }: { a: LiveActivity; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(''), [message, setMessage] = useState('')
  return <Dialog title="모집 취소" onClose={onClose}>
    <p className="mu">신청한 {a.applicants ?? 0}명에게 바로 알림이 가요. 취소하면 되돌릴 수 없어요.</p>
    <div className="pc-radio">{cancelReasons.map(([k, label]) => <label key={k} className={code === k ? 'on' : ''}><input type="radio" name="reason" className="pc-cb" checked={code === k} onChange={() => setCode(k)} />{label}</label>)}</div>
    <label className="pc-f"><span>신청자에게 전할 안내 <small>5~300자 · 연락처는 적을 수 없어요</small></span><textarea className="pc-ta" value={message} maxLength={300} onChange={e => setMessage(e.target.value)} /></label>
    <DialogButtons onClose={onClose} label="모집 취소하기" danger disabled={!code || message.trim().length < 5} run={async () => { await api('/api/activities/' + a.id + '/cancel', 'POST', { reasonCode: code, message }); showToast('모집을 취소했어요', '신청자에게 알림을 보냈어요'); onDone() }} />
  </Dialog>
}
