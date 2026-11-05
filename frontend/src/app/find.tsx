// 찾기: search, quick chips and the detail filter (one filter state for both), list or map, our activities and 1365.
// Every condition is searched on the server; 1365 dates are narrowed here because the 1365 API has no date filter.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api } from '../api'
import type { LiveActivity } from '../api'
import { categories } from '../categories'
import { programKind, range, when1365 } from '../explore'
import type { Program } from '../explore'
import { currentPosition, declined, decline, remember, remembered } from '../location'
import { PlaceMap } from '../map'
import { districts, provinces, shortProvince } from '../regions'
import { ActivityRow, fieldIcon, isNewcomer, seatsLeft } from './cards'
import { Empty, Loading, MIcon, RecruitFab, Sheet, TopBar } from './ui'

type Area = { kind: 'all' } | { kind: 'near'; km: 2 | 5 | 10 } | { kind: 'region'; sido: string; sigungu: string }
type When = { kind: 'all' | 'today' | 'tomorrow' | 'weekend' } | { kind: 'range'; from: string; to: string }
type Status = 'OPEN' | 'WAITLIST' | 'ALL'
type Source = 'ALL' | 'VOLINK' | '1365'
export type Filters = { area: Area; when: When; categories: string[]; status: Status; source: Source; newcomer: boolean }
export const defaults: Filters = { area: { kind: 'all' }, when: { kind: 'all' }, categories: [], status: 'OPEN', source: 'ALL', newcomer: false }

const statusLabel: Record<Status, string> = { OPEN: '모집 중인 활동만', WAITLIST: '대기 신청 가능한 활동 포함', ALL: '마감된 활동도 보기' }
const sourceLabel: Record<Source, string> = { ALL: '전체', VOLINK: 'Volink', '1365': '1365' }
const whenLabel: Record<'today' | 'tomorrow' | 'weekend', string> = { today: '오늘', tomorrow: '내일', weekend: '이번 주말' }

const seoulDay = (offset = 0) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10)
/** Korean dates for the chosen day option; the weekend is the coming (or current) Saturday–Sunday. */
export function dates(when: When): { from?: string; to?: string } {
  if (when.kind === 'today') return { from: seoulDay(), to: seoulDay() }
  if (when.kind === 'tomorrow') return { from: seoulDay(1), to: seoulDay(1) }
  if (when.kind === 'weekend') return range('weekend')
  if (when.kind === 'range') return { from: when.from, to: when.to }
  return {}
}
const md = (day: string) => `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일`
const areaText = (area: Area) => area.kind === 'near' ? `내 주변 ${area.km}km` : area.kind === 'region' ? `${shortProvince(area.sido)} ${area.sigungu || '전체'}` : '전체 지역'
const whenText = (when: When) => when.kind === 'range' ? (when.from === when.to ? md(when.from) : `${md(when.from)}~${md(when.to)}`) : when.kind === 'all' ? '전체' : whenLabel[when.kind]

/** Applied conditions that differ from the defaults, each with a way to undo just that one. */
function chipsOf(f: Filters): { key: string; label: string; clear: (f: Filters) => Filters }[] {
  const out: { key: string; label: string; clear: (f: Filters) => Filters }[] = []
  if (f.area.kind !== 'all') out.push({ key: 'area', label: f.area.kind === 'region' ? (f.area.sigungu || shortProvince(f.area.sido) + ' 전체') : areaText(f.area), clear: x => ({ ...x, area: { kind: 'all' } }) })
  if (f.when.kind !== 'all') out.push({ key: 'when', label: whenText(f.when), clear: x => ({ ...x, when: { kind: 'all' } }) })
  for (const c of f.categories) out.push({ key: 'c-' + c, label: c, clear: x => ({ ...x, categories: x.categories.filter(y => y !== c) }) })
  if (f.status !== 'OPEN') out.push({ key: 'status', label: f.status === 'WAITLIST' ? '대기 가능 포함' : '마감 포함', clear: x => ({ ...x, status: 'OPEN' }) })
  if (f.source !== 'ALL') out.push({ key: 'source', label: f.source === 'VOLINK' ? 'Volink만' : '1365만', clear: x => ({ ...x, source: 'ALL' }) })
  if (f.newcomer) out.push({ key: 'newcomer', label: '처음 환영', clear: x => ({ ...x, newcomer: false }) })
  return out
}

/** Server query for our activities. */
function volinkParams(f: Filters, q: string, origin: { lat: number; lng: number } | null) {
  const params = new URLSearchParams({ status: f.status })
  if (q) params.set('q', q)
  if (f.categories.length) params.set('category', f.categories.join(','))
  const d = dates(f.when)
  if (d.from) params.set('from', d.from)
  if (d.to) params.set('to', d.to)
  if (f.area.kind === 'near' && origin) { params.set('lat', origin.lat.toFixed(6)); params.set('lng', origin.lng.toFixed(6)); params.set('radiusKm', String(f.area.km)) }
  if (f.area.kind === 'region') { params.set('sido', f.area.sido); if (f.area.sigungu) params.set('sigungu', f.area.sigungu) }
  return params
}

/** 1365 needs a place to look: the chosen region, or the position (near: the radius; all areas: 5 km around you). */
function programParams(f: Filters, q: string, origin: { lat: number; lng: number } | null) {
  const params = new URLSearchParams()
  if (f.area.kind === 'region') { params.set('sido', f.area.sido); if (f.area.sigungu) params.set('sigungu', f.area.sigungu) }
  else if (origin) { params.set('lat', origin.lat.toFixed(6)); params.set('lng', origin.lng.toFixed(6)); params.set('radiusKm', f.area.kind === 'near' ? String(f.area.km) : '5') }
  else return null
  if (q) params.set('q', q)
  if (f.categories.length) params.set('category', f.categories.join(','))
  if (f.status === 'ALL') params.set('recruiting', 'false')
  return params
}

/** A 1365 program runs on some day inside the chosen dates (period overlap; unknown periods are kept). */
function programInDates(p: Program, f: Filters) {
  const d = dates(f.when)
  if (!d.from || !d.to) return true
  const start = p.periodStart ?? p.periodEnd, end = p.periodEnd ?? p.periodStart
  if (!start || !end) return true
  return start <= d.to && end >= d.from
}

export function FindScreen({ actions, focus, initial }: { actions: ReactNode; focus?: boolean; initial?: string }) {
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<Filters>(() => ({ ...defaults,
    ...(initial === 'near' ? { area: { kind: 'near', km: 5 } } : initial === 'weekend' ? { when: { kind: 'weekend' } } : initial === 'newcomer' ? { newcomer: true } : initial === '1365' ? { source: '1365' } : {}) } as Filters))
  const [sheet, setSheet] = useState(false)
  const [view, setView] = useState<'list' | 'map'>('list')
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [notice, setNotice] = useState('')
  const [items, setItems] = useState<LiveActivity[] | null>(null)
  const [programs, setPrograms] = useState<Program[] | null>(null)
  const [programsState, setProgramsState] = useState<'off' | 'error' | 'needPlace' | 'ok'>('ok')
  const [program, setProgram] = useState<Program | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (focus) input.current?.focus() }, [focus])

  // Position: asked only when 내 주변 is chosen (or remembered); a refusal falls back to all areas with a note.
  const near = filters.area.kind === 'near'
  useEffect(() => {
    if (!near || origin) return
    setLocating(true)
    currentPosition().then(position => {
      setLocating(false)
      if (position) { setOrigin(position); remember(true); setNotice('') }
      else {
        decline()
        setNotice('위치를 확인하지 못했어요. 상세 필터에서 지역을 직접 골라 주세요.')
        setFilters(current => ({ ...current, area: { kind: 'all' } }))
      }
    })
  }, [near, origin])
  useEffect(() => { if (remembered()) currentPosition().then(position => position && setOrigin(position)) }, [])

  const showVolink = filters.source !== '1365', show1365 = filters.source !== 'VOLINK'
  useEffect(() => {
    if (!showVolink || (near && !origin)) { setItems(showVolink ? null : []); return }
    let current = true
    setItems(null)
    api<LiveActivity[]>('/api/activities?' + volinkParams(filters, q, origin)).then(list => { if (current) setItems(list) }).catch(() => { if (current) setItems([]) })
    return () => { current = false }
  }, [filters, q, origin, near, showVolink])

  useEffect(() => {
    if (!show1365 || (near && !origin)) { setPrograms(show1365 ? null : []); return }
    const params = programParams(filters, q, origin)
    if (!params) { setPrograms([]); setProgramsState('needPlace'); return }
    let current = true
    setPrograms(null)
    api<{ enabled: boolean; items: Program[] }>('/api/volunteer-programs?' + params)
      .then(result => { if (!current) return; setProgramsState(result.enabled ? 'ok' : 'off'); setPrograms(result.items.filter(p => programInDates(p, filters))) })
      .catch(() => { if (current) { setProgramsState('error'); setPrograms([]) } })
    return () => { current = false }
  }, [filters, q, origin, near, show1365])

  // Full activities go to the end (the waitlist may still be open).
  const shown = useMemo(() => (items ?? []).filter(a => !filters.newcomer || isNewcomer(a)).sort((a, b) => Number(seatsLeft(a) === 0) - Number(seatsLeft(b) === 0)), [items, filters.newcomer])
  const programList = programs ?? []
  const mapPrograms = useMemo(() => programList.filter(p => p.latitude != null && p.longitude != null), [programList])
  const mapPlaces = useMemo(() => [
    ...shown.map(a => ({ id: a.id, name: a.title, latitude: a.latitude ?? null, longitude: a.longitude ?? null, tone: 'local' as const })),
    ...mapPrograms.map((p, i) => ({ id: -(i + 1), name: p.title, latitude: p.latitude, longitude: p.longitude, tone: 'program' as const })),
  ], [shown, mapPrograms])
  const loading = (showVolink && items === null) || (show1365 && programs === null)
  const total = shown.length + programList.length
  const applied = chipsOf(filters)
  function search(event: FormEvent) { event.preventDefault(); setQ(query.trim()); input.current?.blur() }

  // Quick chips are shortcuts into the same filter state.
  const quick: { key: string; label: string; on: boolean; toggle: () => void; icon?: 'pin' }[] = [
    { key: 'near', label: '내 주변', icon: 'pin', on: near, toggle: () => setFilters(f => ({ ...f, area: near ? { kind: 'all' } : { kind: 'near', km: 5 } })) },
    { key: 'weekend', label: '이번 주말', on: filters.when.kind === 'weekend', toggle: () => setFilters(f => ({ ...f, when: f.when.kind === 'weekend' ? { kind: 'all' } : { kind: 'weekend' } })) },
    { key: 'newcomer', label: '처음 환영', on: filters.newcomer, toggle: () => setFilters(f => ({ ...f, newcomer: !f.newcomer })) },
    { key: '1365', label: '1365', on: filters.source === '1365', toggle: () => setFilters(f => ({ ...f, source: f.source === '1365' ? 'ALL' : '1365' })) },
  ]

  return <div className="m-screen m-find">
    <TopBar title="봉사 찾기" actions={actions} />
    <div className="m-find-head">
      <div className="m-search-row">
        <form className="m-search" role="search" onSubmit={search}>
          <MIcon name="search" size={20} />
          <input ref={input} type="search" enterKeyHint="search" placeholder="지역, 활동명 검색" aria-label="검색어" value={query} onChange={event => { setQuery(event.target.value); if (!event.target.value) setQ('') }} />
          {query && <button type="button" className="m-icon-btn sm" aria-label="검색어 지우기" onClick={() => { setQuery(''); setQ('') }}><MIcon name="close" size={18} /></button>}
        </form>
        <button type="button" className={'m-filter-btn' + (applied.length ? ' on' : '')} aria-label={'상세 필터' + (applied.length ? ` (${applied.length}개 적용 중)` : '')} onClick={() => setSheet(true)}>
          <MIcon name="sliders" size={21} />{applied.length > 0 && <b>{applied.length}</b>}</button>
      </div>
      <div className="m-chips" role="group" aria-label="빠른 조건">
        {quick.map(chip => <button key={chip.key} type="button" className={'m-chip' + (chip.on ? ' on' : '')} aria-pressed={chip.on} onClick={chip.toggle}>
          {chip.icon && <MIcon name={chip.icon} size={16} />}{chip.label}</button>)}
      </div>
      {applied.length > 0 && <div className="m-applied" role="group" aria-label="적용된 조건">
        {applied.map(chip => <button key={chip.key} type="button" className="m-applied-chip" aria-label={chip.label + ' 조건 지우기'} onClick={() => setFilters(f => chip.clear(f))}>{chip.label}<MIcon name="close" size={14} /></button>)}
        <button type="button" className="m-text-btn sm" onClick={() => setFilters(defaults)}>모두 지우기</button>
      </div>}
    </div>
    <div className="m-body">
      {locating && <p className="m-help">위치를 확인하고 있어요…</p>}
      {notice && <div className="m-note">{notice}</div>}
      <div className="m-result-head"><h2>{loading ? '활동' : `${total}개 활동`}</h2>
        <div className="m-seg" role="tablist" aria-label="보기">
          <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><MIcon name="list" size={17} />목록</button>
          <button role="tab" aria-selected={view === 'map'} className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}><MIcon name="map" size={17} />지도</button></div></div>
      {show1365 && programsState === 'needPlace' && <p className="m-help">1365 활동은 위치를 허용하거나 상세 필터에서 지역을 고르면 함께 보여요.</p>}
      {show1365 && programsState === 'off' && <p className="m-help">지금은 1365 활동을 불러올 수 없어요.</p>}
      {show1365 && programsState === 'error' && <p className="m-help">1365 활동을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>}
      {loading ? <Loading />
        : view === 'map' ? <div className="m-map-box">
          <PlaceMap label="활동 위치 지도" places={mapPlaces}
            origin={origin && filters.area.kind !== 'region' ? { ...origin, label: '내 위치' } : null} radiusKm={filters.area.kind === 'near' ? filters.area.km : undefined} selected={selected}
            onSelect={id => { if (id != null && id < 0) { const p = mapPrograms[-id - 1]; if (p) setProgram(p) } else setSelected(id) }} />
          <p className="m-map-legend">{showVolink && <><i className="local" />동네 활동 {shown.length}개</>}{show1365 && mapPrograms.length > 0 && <><i className="program" />1365 활동 {mapPrograms.length}개</>}</p>
          {selected && shown.find(a => a.id === selected) && <div className="m-map-card"><ActivityRow activity={shown.find(a => a.id === selected)!} /></div>}
        </div>
        : total === 0 ? <Empty icon="search" title="조건에 맞는 활동이 없어요" text="조건을 줄이거나 다른 지역·날짜를 골라 보세요."
          action={applied.length || q ? <button className="m-btn line sm" onClick={() => { setFilters(defaults); setQ(''); setQuery('') }}>조건 모두 지우기</button> : undefined} />
        : <>
          {shown.length > 0 && <div className="m-list">{shown.map(a => <ActivityRow key={a.id} activity={a} />)}</div>}
          {programList.length > 0 && <>
            <h3 className="m-list-title">1365 공식 봉사 <small>신청은 1365에서</small></h3>
            <div className="m-list">{programList.map(p => <button key={p.programNo} type="button" className="m-row" onClick={() => setProgram(p)}>
              <span className="m-row-ico p"><MIcon name="flag" size={21} /></span>
              <span className="m-row-main"><strong>{p.title}</strong><small>{[when1365(p) || '일정은 1365에서 확인', p.distanceKm != null ? p.distanceKm + 'km' : null, programKind(p)?.label].filter(Boolean).join(' · ')}</small></span>
              <span className="m-badge blue">{p.recruitStatus && p.recruitStatus !== '모집중' ? p.recruitStatus : '1365'}</span></button>)}</div>
          </>}
        </>}
    </div>
    {view === 'list' && <RecruitFab />}
    {sheet && <FilterSheet value={filters} q={q} origin={origin} onClose={() => setSheet(false)} onApply={next => { setFilters(next); setSheet(false) }} />}
    {program && <Sheet title="1365 활동" onClose={() => setProgram(null)} footer={<a className="m-btn" href={program.link} target="_blank" rel="noopener noreferrer">1365에서 신청하기 <MIcon name="outward" size={18} /></a>}>
      <h3 className="m-h3">{program.title}</h3>
      <dl className="m-dl">
        {([['분야', programKind(program)?.label ?? program.field], ['모집 기관', program.organization], ['장소', program.place ? program.place + (program.distanceKm != null ? ` (${program.distanceKm}km)` : '') : null],
          ['일정', when1365(program) || null], ['모집', program.recruitStatus], ['청소년', program.youthOk ? '참여 가능' : null]] as [string, string | null][])
          .filter(([, value]) => value).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
      </dl>
      <p className="m-help">봉사시간 인정과 보험은 1365 기준이에요. Volink는 신청을 대신하지 않아요.</p>
    </Sheet>}
  </div>
}

/**
 * Detail filter: a draft that changes nothing until "활동 보기". Closing keeps the applied filters; 초기화 resets
 * only the draft. The count is shown only when it is exact (our activities alone: the server counts them).
 */
function FilterSheet({ value, q, origin, onClose, onApply }: { value: Filters; q: string; origin: { lat: number; lng: number } | null; onClose: () => void; onApply: (f: Filters) => void }) {
  const [draft, setDraft] = useState<Filters>(value)
  const [step, setStep] = useState<'main' | 'sido' | 'sigungu'>('main')
  const [sido, setSido] = useState(value.area.kind === 'region' ? value.area.sido : '')
  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  const [rangeOpen, setRangeOpen] = useState(draft.when.kind === 'range')
  const [from, setFrom] = useState(draft.when.kind === 'range' ? draft.when.from : seoulDay())
  const [to, setTo] = useState(draft.when.kind === 'range' ? draft.when.to : seoulDay(7))
  const rangeError = rangeOpen && (!from || !to ? '시작일과 종료일을 골라 주세요.' : from > to ? '시작일이 종료일보다 늦을 수 없어요.' : '')
  const set = (change: Partial<Filters>) => setDraft(current => ({ ...current, ...change }))
  const locationDenied = declined()

  // Exact count only for our activities (1365 has a daily call limit, so it is not counted ahead).
  const countable = draft.source === 'VOLINK' && !(draft.area.kind === 'near' && !origin) && !rangeError
  const countKey = countable ? volinkParams(draft, q, origin).toString() : ''
  useEffect(() => {
    if (!countKey) { setCount(null); return }
    let current = true
    setCounting(true)
    const timer = window.setTimeout(() => {
      api<LiveActivity[]>('/api/activities?' + countKey).then(list => { if (current) setCount(list.filter(a => !draft.newcomer || isNewcomer(a)).length) })
        .catch(() => { if (current) setCount(null) }).finally(() => { if (current) setCounting(false) })
    }, 350)
    return () => { current = false; window.clearTimeout(timer) }
  }, [countKey, draft.newcomer])

  const toggleCategory = useCallback((c: string) => setDraft(current => {
    const has = current.categories.includes(c)
    return { ...current, categories: has ? current.categories.filter(x => x !== c) : [...current.categories, c] }
  }), [])
  function apply() {
    if (rangeError) return
    onApply(rangeOpen ? { ...draft, when: { kind: 'range', from, to } } : draft)
  }

  if (step !== 'main') return <Sheet title={step === 'sido' ? '시·도 선택' : shortProvince(sido) + ' 시·군·구'} className="m-filter-sheet" onClose={() => setStep('main')}
    headAction={<button type="button" className="m-text-btn sm" onClick={() => setStep(step === 'sigungu' ? 'sido' : 'main')}><MIcon name="back" size={16} />이전</button>}>
    <ul className="m-pick-list">{step === 'sido'
      ? provinces.map(p => <li key={p}><button type="button" className={sido === p ? 'on' : ''} onClick={() => { setSido(p); if (districts[p]) setStep('sigungu'); else { set({ area: { kind: 'region', sido: p, sigungu: '' } }); setStep('main') } }}>
        {p}{districts[p] ? <MIcon name="chevron" size={16} /> : <small>전체만</small>}</button></li>)
      : ['', ...districts[sido]].map(d => { const on = draft.area.kind === 'region' && draft.area.sido === sido && draft.area.sigungu === d
        return <li key={d || 'all'}><button type="button" className={on ? 'on' : ''} onClick={() => { set({ area: { kind: 'region', sido, sigungu: d } }); setStep('main') }}>{d || shortProvince(sido) + ' 전체'}{on && <MIcon name="check" size={16} />}</button></li> })}</ul>
  </Sheet>

  return <Sheet title="상세 필터" className="m-filter-sheet" onClose={onClose}
    headAction={<button type="button" className="m-text-btn sm" onClick={() => { setDraft(defaults); setRangeOpen(false); setSido('') }}><MIcon name="refresh" size={16} />초기화</button>}
    footer={<button type="button" className="m-btn" disabled={Boolean(rangeError) || counting} onClick={apply}>
      {counting ? '세는 중…' : count != null ? `${count}개 활동 보기` : '조건에 맞는 활동 보기'}</button>}>
    <section className="m-fsec" aria-labelledby="f-area"><h3 id="f-area"><MIcon name="pin" size={18} />지역</h3>
      <div className="m-chips wrap">
        <button type="button" className={'m-chip' + (draft.area.kind === 'all' ? ' on' : '')} aria-pressed={draft.area.kind === 'all'} onClick={() => set({ area: { kind: 'all' } })}>전체 지역</button>
        {([2, 5, 10] as const).map(km => { const on = draft.area.kind === 'near' && draft.area.km === km
          return <button key={km} type="button" className={'m-chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => set({ area: { kind: 'near', km } })}>내 주변 {km}km</button> })}
      </div>
      {locationDenied && draft.area.kind === 'near' && <p className="m-err">위치 권한이 꺼져 있어요. 휴대폰 설정에서 켜거나 아래에서 지역을 직접 골라 주세요.</p>}
      <button type="button" className={'m-input m-pick' + (draft.area.kind === 'region' ? ' on' : '')} onClick={() => setStep('sido')}>
        <MIcon name="map" size={19} /><span className={draft.area.kind === 'region' ? '' : 'ph'}>{draft.area.kind === 'region' ? `${draft.area.sido} ${draft.area.sigungu || '전체'}` : '지역 직접 선택'}</span>
        {draft.area.kind === 'region' ? <span role="button" tabIndex={0} aria-label="지역 지우기" onClick={event => { event.stopPropagation(); set({ area: { kind: 'all' } }); setSido('') }}><MIcon name="close" size={16} /></span> : <MIcon name="chevron" size={17} />}</button>
    </section>
    <section className="m-fsec" aria-labelledby="f-when"><h3 id="f-when"><MIcon name="calendar" size={18} />활동 날짜</h3>
      <div className="m-chips wrap">
        {(['all', 'today', 'tomorrow', 'weekend'] as const).map(kind => { const on = !rangeOpen && draft.when.kind === kind
          return <button key={kind} type="button" className={'m-chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => { setRangeOpen(false); set({ when: { kind } }) }}>{kind === 'all' ? '전체' : whenLabel[kind]}</button> })}
        <button type="button" className={'m-chip' + (rangeOpen ? ' on' : '')} aria-pressed={rangeOpen} onClick={() => setRangeOpen(true)}>날짜 직접 선택</button>
      </div>
      {rangeOpen && <div className="m-range">
        <label><span>시작일</span><input type="date" className="m-input" value={from} min={seoulDay()} onChange={event => setFrom(event.target.value)} /></label>
        <span aria-hidden="true">~</span>
        <label><span>종료일</span><input type="date" className="m-input" value={to} min={from || seoulDay()} onChange={event => setTo(event.target.value)} /></label>
      </div>}
      {rangeError && <p className="m-err" role="alert">{rangeError}</p>}
    </section>
    <section className="m-fsec" aria-labelledby="f-cat"><h3 id="f-cat"><MIcon name="leaf" size={18} />활동 카테고리<small>여러 개 선택</small></h3>
      <div className="m-chips wrap">
        <button type="button" className={'m-chip' + (draft.categories.length === 0 ? ' on' : '')} aria-pressed={draft.categories.length === 0} onClick={() => set({ categories: [] })}>전체</button>
        {categories.map(c => { const on = draft.categories.includes(c)
          return <button key={c} type="button" className={'m-chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggleCategory(c)}><MIcon name={fieldIcon[c] ?? 'sprout'} size={15} />{c}</button> })}
      </div>
    </section>
    <section className="m-fsec" aria-labelledby="f-status"><h3 id="f-status"><MIcon name="users" size={18} />모집 상태</h3>
      <div className="m-radios" role="radiogroup" aria-labelledby="f-status">
        {(['OPEN', 'WAITLIST', 'ALL'] as Status[]).map(s => <label key={s} className={draft.status === s ? 'on' : ''}>
          <input type="radio" name="f-status" checked={draft.status === s} onChange={() => set({ status: s })} /><i aria-hidden="true" />{statusLabel[s]}</label>)}
      </div>
    </section>
    <section className="m-fsec" aria-labelledby="f-source"><h3 id="f-source"><MIcon name="list" size={18} />모집 출처</h3>
      <div className="m-seg wide" role="radiogroup" aria-labelledby="f-source">
        {(['ALL', 'VOLINK', '1365'] as Source[]).map(s => <button key={s} type="button" role="radio" aria-checked={draft.source === s} className={draft.source === s ? 'on' : ''} onClick={() => set({ source: s })}>{sourceLabel[s]}</button>)}
      </div>
    </section>
  </Sheet>
}
