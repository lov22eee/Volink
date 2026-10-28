// Activity search (4주차 보완): ask for a location once, then one map + list of our activities and 1365 programs.
// Empty nearby results widen the radius by themselves (3 → 5 → 10 → 20 km). The position is used for the request only.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, preview } from './api'
import type { LiveActivity } from './api'
import { ActivityCard, categories, fromExample, fromLive } from './App'
import type { CardItem } from './App'
import type { DisplayCatalog as Catalog } from './data'
import { createPortal } from 'react-dom'
import { CategoryCover } from './covers'
import { Glyph, SupplyChips } from './icons'
import { kakaoEnabled, loadKakao, pinSvg } from './map'
import type { Origin } from './map'
import { searchPlaces } from './placePicker'
import { remember, remembered } from './location'
import type { PlaceResult } from './placePicker'

export type Program = {
  programNo: string; title: string; organization: string | null; place: string | null; field: string | null
  periodStart: string | null; periodEnd: string | null; beginTime: string | null; endTime: string | null; weekdays: string | null
  recruitStatus: string | null; recruitEnd: string | null; capacity: number | null; youthOk: boolean | null
  latitude: number | null; longitude: number | null; distanceKm: number | null; link: string
}

type Source = 'all' | 'local' | '1365'
export type When = 'all' | 'today' | 'week' | 'weekend'
type Hit = { key: string; source: 'local' | '1365'; title: string; lat: number | null; lng: number | null; distanceKm: number | null; local?: LiveActivity; program?: Program }

const rings = [1, 3, 5, 10, 20]
// Remembers only that location was allowed (never the position), so the next visit opens on the map.
export { remembered } from './location'

export function km(a: Origin, lat: number, lng: number) {
  const r = 6371, dLat = (lat - a.lat) * Math.PI / 180, dLng = (lng - a.lng) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * r * Math.asin(Math.sqrt(h)) * 10) / 10
}
const seoulDay = (offset = 0) => { const day = new Date(Date.now() + offset * 86_400_000); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(day) }

/** Rough travel time from straight-line distance: walking up to 1.5 km, otherwise driving. Not a route. */
export function travel(km: number) {
  if (km <= 1.5) return '걸어서 ' + Math.max(1, Math.round(km / 4.5 * 60)) + '분'
  return '차로 ' + Math.round(km / 25 * 60 + 3) + '분'
}

export function range(when: When): { from?: string; to?: string } {
  const today = seoulDay()
  if (when === 'today') return { from: today, to: today }
  if (when === 'week') return { from: today, to: seoulDay(6) }
  if (when === 'weekend') {
    const weekday = new Date(today + 'T12:00:00+09:00').getUTCDay()
    const saturday = seoulDay(weekday === 0 ? -1 : 6 - weekday)
    return { from: weekday === 0 ? today : saturday, to: seoulDay(weekday === 0 ? 0 : 7 - weekday) }
  }
  return {}
}

export default function Explore({ catalog }: { catalog: Catalog | null }) {
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list')
  const [origin, setOrigin] = useState<Origin | null>(null)
  const [asking, setAsking] = useState(!preview && !remembered())
  const [locating, setLocating] = useState(false)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [filtering, setFiltering] = useState(false)
  const filterBox = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!filtering) return
    const close = (event: MouseEvent) => { if (!filterBox.current?.contains(event.target as Node)) setFiltering(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [filtering])
  const [pageSize, setPageSize] = useState(9)
  const [page, setPage] = useState(1)
  // Search as you type (a short pause first so every key is not a request).
  useEffect(() => { const timer = setTimeout(() => setQ(query.trim()), 300); return () => clearTimeout(timer) }, [query])
  const [q, setQ] = useState('')
  const [source, setSource] = useState<Source>('all')
  const [radius, setRadius] = useState(3)
  const [when, setWhen] = useState<When>('all')
  const [part, setPart] = useState('')
  // Home category chips open #/explore?category=…; anything else starts with every category.
  const [category, setCategory] = useState(() => { const value = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('category'); return value && categories.includes(value) ? value : '전체' })
  const [kind, setKind] = useState('all')
  const [youth, setYouth] = useState(false)
  const [live, setLive] = useState<LiveActivity[]>([])
  const [allLive, setAllLive] = useState<LiveActivity[]>([])
  const [programs, setPrograms] = useState<Program[]>([])
  const [programsOn, setProgramsOn] = useState(false)
  const [programsLoading, setProgramsLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  // Hovering a card only highlights its pin; the preview opens when a pin is clicked.
  const [hovered, setHovered] = useState<string | null>(null)
  const [myPosition, setMyPosition] = useState<Origin | null>(null)
  const [programDetail, setProgramDetail] = useState<Program | null>(null)

  // Our activities: within 20 km (the widest ring) so the radius can widen without another request.
  // With a position there are two lists: nearby (top) and every recruiting activity (bottom, nearest first).
  useEffect(() => {
    if (preview) return
    const params = new URLSearchParams()
    const { from, to } = range(when)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (part) params.set('part', part)
    if (q) params.set('q', q)
    if (category !== '전체') params.set('category', category)
    if (kind !== 'all') params.set('type', kind)
    let current = true
    api<LiveActivity[]>('/api/activities?' + params).then(list => current && setAllLive(list)).catch(() => current && setAllLive([]))
    if (origin) {
      const near = new URLSearchParams(params)
      near.set('lat', origin.lat.toFixed(6)); near.set('lng', origin.lng.toFixed(6)); near.set('radiusKm', '20')
      api<LiveActivity[]>('/api/activities?' + near).then(list => current && setLive(list)).catch(() => current && setLive([]))
    }
    return () => { current = false }
  }, [origin, when, part, q, category, kind])
  useEffect(() => { if (!origin) setLive(allLive) }, [origin, allLive])

  // Location allowed before: go straight to the map.
  useEffect(() => { if (!preview && remembered()) locate() }, [])

  // 1365 programs need a position (they are looked up by region).
  useEffect(() => {
    // A new centre drops the old list at once, and a late answer for an old centre is ignored.
    setPrograms([])
    if (preview || !origin) { setProgramsLoading(false); return }
    let current = true
    setProgramsLoading(true)
    const params = new URLSearchParams({ lat: origin.lat.toFixed(6), lng: origin.lng.toFixed(6), radiusKm: '20' })
    if (q) params.set('q', q)
    if (youth) params.set('youth', 'true')
    api<{ enabled: boolean; items: Program[] }>('/api/volunteer-programs?' + params)
      .then(result => { if (current) { setProgramsOn(result.enabled); setPrograms(result.items) } })
      .catch(() => { if (current) { setProgramsOn(false); setPrograms([]) } })
      .finally(() => { if (current) setProgramsLoading(false) })
    return () => { current = false }
  }, [origin, q, youth])

  function locate() {
    if (!navigator.geolocation) { setNotice('이 브라우저는 위치 확인을 지원하지 않습니다. 지역을 직접 골라 주세요.'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(position => {
      setLocating(false)
      setNotice('')
      setAsking(false)
      remember(true)
      const mine = { lat: position.coords.latitude, lng: position.coords.longitude, label: '내 위치' }
      setMyPosition(mine)
      setOrigin(mine)
    }, () => { setLocating(false); remember(false); setAsking(true); setNotice('위치를 확인하지 못했습니다. 지역을 직접 골라 주세요.') }, { timeout: 8000, maximumAge: 60000 })
  }

  // Every hit for the current filters; the source tabs only narrow what is shown, so their counts never hide each other.
  const allHits = useMemo<Hit[]>(() => {
    const filterProgram = (program: Program) => {
      if (category !== '전체' || kind === 'INSTITUTION' || kind === 'GENERAL') return false
      if (when !== 'all' || part) {
        const { from, to } = range(when)
        if (from && program.periodEnd && program.periodEnd < from) return false
        if (to && program.periodStart && program.periodStart > to) return false
        if (part && program.beginTime && (part === 'AM') !== program.beginTime < '12:00') return false
      }
      return true
    }
    return [
      ...live.map(activity => ({ key: 'a' + activity.id, source: 'local' as const, title: activity.title, lat: activity.latitude ?? null, lng: activity.longitude ?? null, distanceKm: activity.distanceKm ?? null, local: activity })),
      ...programs.filter(filterProgram).map(program => ({ key: 'p' + program.programNo, source: '1365' as const, title: program.title, lat: program.latitude, lng: program.longitude, distanceKm: program.distanceKm, program })),
    ].sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999))
  }, [live, programs, category, kind, when, part])
  const hits = source === 'all' ? allHits : allHits.filter(hit => hit.source === source)

  // Widen by itself when nothing is inside the chosen radius.
  const radiusFor = (list: Hit[]) => origin ? rings.find(ring => ring >= radius && list.some(hit => hit.distanceKm != null && hit.distanceKm <= ring)) ?? radius : radius
  const near = (list: Hit[]) => { const ring = radiusFor(list); return origin ? list.filter(hit => hit.distanceKm == null || hit.distanceKm <= ring) : list }
  const shownRadius = radiusFor(hits)
  const inside = near(hits)
  const widened = origin && shownRadius > radius
  const examples = !origin && catalog ? catalog.activities.map(activity => fromExample(activity, catalog.baseDate)) : []
  const { from, to } = range(when)
  const filteredExamples = examples.filter(item => (category === '전체' || item.category === category) && (kind === 'all' || item.activityType === kind)
    && (item.title + item.placeName).includes(q) && (!from || item.date >= from) && (!to || item.date <= to) && (!part || (part === 'AM') === item.startTime < '12:00'))
  const activeFilters = [when !== 'all', part !== '', category !== '전체', kind !== 'all', youth, origin != null && radius !== 3].filter(Boolean).length
  useEffect(() => setPage(1), [q, when, part, category, kind, youth, source, origin, pageSize])
  const chosen = inside.find(hit => hit.key === selected) ?? null
  // Bottom list: every recruiting activity (with distance when known) and the 1365 programs found, nearest first.
  const everything = !origin ? [] : [
    ...(source === '1365' ? [] : allLive.map(activity => {
      const distanceKm = activity.latitude != null && activity.longitude != null ? km(origin, activity.latitude, activity.longitude) : undefined
      return { key: 'a' + activity.id, distance: distanceKm ?? 999, card: { ...fromLive(activity), distanceKm } as CardItem, hit: undefined as Hit | undefined }
    })),
    ...hits.filter(hit => hit.source === '1365').map(hit => ({ key: hit.key, distance: hit.distanceKm ?? 999, card: undefined as CardItem | undefined, hit })),
  ].sort((a, b) => a.distance - b.distance)


  const resetFilters = () => { setWhen('all'); setPart(''); setCategory('전체'); setKind('all'); setYouth(false); setRadius(3) }
  const searchBox = useRef<HTMLInputElement>(null)

  return <>
    <section id="activities" className="activity-section explore-v2">
      <div className="page-head explore-head"><div><span className="page-eyebrow">FIND YOUR VOLUNTEER ACTIVITY</span><h1>우리 동네 활동 찾기</h1><p>가까운 곳에서 나에게 맞는 봉사활동을 발견하세요.</p></div>
        {!preview && <span className="location-tag"><Glyph name="pin" size={16} />{origin ? origin.label + ' 기준 ' + shownRadius + 'km' : '위치 미정'}{origin && <button className="text-button" onClick={() => { setAsking(true); setOrigin(null) }}>바꾸기</button>}</span>}
      </div>

      <div className="finder">
        {/* Search as you type; the round button only puts the cursor in the box. */}
        <div className="search-row" role="search">
          <label className="search-pill"><input ref={searchBox} aria-label="활동 검색" value={query} maxLength={50} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery('') }} placeholder="활동명이나 장소 검색" />
            {query && <button type="button" className="icon-button" aria-label="검색어 지우기" onClick={() => setQuery('')}><Glyph name="close" size={16} /></button>}</label>
          <button type="button" className="search-go" aria-label="검색" onClick={() => searchBox.current?.focus()}><Glyph name="search" size={20} /></button>
          <span className="filter-anchor" ref={filterBox}>
            <button type="button" className={'tool-button' + (filtering || activeFilters ? ' on' : '')} aria-label={'필터' + (activeFilters ? ` ${activeFilters}개 켜짐` : '')} aria-expanded={filtering} onClick={() => setFiltering(!filtering)}>
              <Glyph name="filter" size={18} />{activeFilters > 0 && <span className="tool-count">{activeFilters}</span>}</button>
            {filtering && <div className="filter-pop" role="dialog" aria-label="필터">
              {origin && <label className="chip-select"><Glyph name="pin" size={15} /><select aria-label="검색 반경" value={radius} onChange={event => setRadius(Number(event.target.value))}>{rings.map(value => <option key={value} value={value}>{value}km</option>)}</select></label>}
              <label className="chip-select"><Glyph name="calendar" size={15} /><select aria-label="날짜" value={when} onChange={event => setWhen(event.target.value as When)}><option value="all">모든 날짜</option><option value="today">오늘</option><option value="week">이번 주</option><option value="weekend">주말만</option></select></label>
              <label className="chip-select"><Glyph name="clock" size={15} /><select aria-label="시간대" value={part} onChange={event => setPart(event.target.value)}><option value="">모든 시간</option><option value="AM">오전</option><option value="PM">오후</option></select></label>
              <label className="chip-select"><Glyph name="leaf" size={15} /><select aria-label="활동 분야" value={category} onChange={event => setCategory(event.target.value)}><option>전체</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
              <label className="chip-select"><Glyph name="hand" size={15} /><select aria-label="활동 유형" value={kind} onChange={event => setKind(event.target.value)}><option value="all">모든 활동</option><option value="GENERAL">자율 활동</option><option value="INSTITUTION">기관 주관 활동</option></select></label>
              {origin && programsOn && <label className={'chip-check' + (youth ? ' on' : '')}><input type="checkbox" checked={youth} onChange={event => setYouth(event.target.checked)} /><Glyph name="users" size={15} />청소년 가능만</label>}
              <div className="filter-foot"><button type="button" className="text-button" onClick={resetFilters}>필터 초기화</button>
                <button type="button" className="primary-button small" onClick={() => setFiltering(false)}>닫기</button></div>
            </div>}
          </span>
        </div>
        <div className="cat-chips" role="group" aria-label="분야로 거르기">{['전체', ...categories].map(value => <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div>
        <div className="finder-bar">
          {origin && programsOn ? <div className="segmented" role="group" aria-label="활동 출처">{([['all', '전체'], ['local', '동네 활동'], ['1365', '1365 활동']] as [Source, string][]).map(([value, text]) =>
            <button key={value} aria-pressed={source === value} onClick={() => setSource(value)}>{text} <small>{near(value === 'all' ? allHits : allHits.filter(hit => hit.source === value)).length}</small></button>)}</div>
            : <span className="finder-title">{q ? `‘${q}’ 검색 결과` : '활동 목록'}<small>{origin ? '' : ` · ${live.length + filteredExamples.length}건`}</small></span>}
          {!origin && !preview && !asking && <button className="secondary-button small nearby-button" onClick={() => setAsking(true)}><Glyph name="target" size={15} />내 주변 찾기</button>}
        </div>
      </div>

      {origin ? <>
        <section className="panel nearby-panel" aria-label="내 주변">
          <div className="nearby-head"><h3>내 주변 {shownRadius}km</h3><span className="list-count">{origin.label} 기준 · 가까운 순 {Math.min(5, inside.length)}개 · <button className="text-button" onClick={() => document.getElementById('all-list')?.scrollIntoView()}>모든 모집글 보기 ↓</button></span></div>
          {programsLoading && <p className="small-print" role="status">이 지역의 1365 활동을 불러오는 중이에요…</p>}
          {programsOn && !programsLoading && programs.length === 0 && <p className="small-print">근처 20km에서 지금 모집 중인 1365 활동을 찾지 못했어요. 지역을 바꾸거나 잠시 뒤 다시 확인해 주세요.</p>}
          {widened && <div className="widen-callout" role="status"><strong>{radius}km 안에는 없어서 {shownRadius}km까지 넓혔어요</strong>
            <span className="ring-steps">{rings.filter(ring => ring >= radius && ring <= shownRadius).map(ring => <span key={ring} className={ring === shownRadius ? 'on' : ''}>{ring}km · {hits.filter(hit => hit.distanceKm != null && hit.distanceKm <= ring).length}개</span>)}</span>
            <small>최대 20km까지만 넓혀요</small></div>}
          {/* Phones show either the map or the five nearest; wide screens show both side by side. */}
          <div className="view-switch segmented" role="group" aria-label="보기 방식"><button type="button" aria-pressed={mobileView === 'list'} onClick={() => setMobileView('list')}>목록</button><button type="button" aria-pressed={mobileView === 'map'} onClick={() => setMobileView('map')}>지도</button></div>
          <div className={'explore-split show-' + mobileView}>
            <div className="explore-map">
              <ExploreMap origin={origin} radiusKm={shownRadius} hits={inside} selected={hovered ?? selected} onSelect={setSelected}
                onHome={myPosition ? () => setOrigin(myPosition) : undefined}
                onMoved={(centre, label) => setOrigin({ ...centre, label })} />
              {chosen && <PreviewSheet hit={chosen} onClose={() => setSelected(null)} onDetail={setProgramDetail} />}
              <span className="map-legend"><i className="dot local" />동네 활동{programsOn && <><i className="dot program" />1365 활동</>}</span>
            </div>
            <div className="explore-list">
              {inside.length ? <ul className="hit-list">{inside.slice(0, 5).map(hit => <li key={hit.key}><HitCard hit={hit} active={hit.key === (hovered ?? selected)} onHover={on => setHovered(on ? hit.key : null)} onDetail={setProgramDetail} /></li>)}</ul>
                : <div className="empty-state"><p>20km 안에도 조건에 맞는 활동이 없어요.</p><a className="secondary-button" href="#/create">이 동네에 활동 만들기 <Glyph name="arrow" size={15} /></a></div>}
            </div>
          </div>
        </section>
        <div className="all-head" id="all-list"><h3>모든 모집글</h3><span className="list-count">가까운 순 · {everything.length}개 ·
          <select aria-label="한 쪽에 보일 개수" value={pageSize} onChange={event => setPageSize(Number(event.target.value))}>{[9, 18, 30].map(n => <option key={n} value={n}>{n}개씩</option>)}</select></span></div>
        {everything.length ? <div className="activity-grid">{everything.slice((page - 1) * pageSize, page * pageSize).map(entry => entry.card ? <ActivityCard key={entry.key} item={entry.card} />
          : <div key={entry.key} className="program-tile"><HitCard hit={entry.hit!} active={false} onDetail={setProgramDetail} /></div>)}</div>
          : <div className="empty-state"><p>조건에 맞는 모집글이 없습니다. 다른 조건으로 찾아보세요.</p>{activeFilters > 0 && <button type="button" className="secondary-button" onClick={resetFilters}>조건 모두 지우기</button>}</div>}
        <Pages total={everything.length} size={pageSize} page={page} onPage={next => { setPage(next); document.getElementById('all-list')?.scrollIntoView() }} />
      </>
        : <div className="explore-split browse">
          <div className="explore-list">
            {(!catalog && !live.length) ? <div className="loading-state" role="status">활동 정보를 불러오는 중입니다.</div>
              : (live.length + filteredExamples.length) ? <>
                {live.length > 0 && <><div className="activity-grid">{live.map(fromLive).slice((page - 1) * pageSize, page * pageSize).map((item: CardItem) => <ActivityCard key={item.key} item={item} />)}</div>
                  <Pages total={live.length} size={pageSize} page={page} onPage={next => { setPage(next); document.getElementById('activities')?.scrollIntoView() }} /></>}
                {/* Examples are not real posts: kept apart from the real list and its pages. */}
                {filteredExamples.length > 0 && <><div className="all-head"><h3>참고용 예시</h3><span className="list-count">실제 모집이 아니에요</span></div>
                  <div className="activity-grid">{filteredExamples.map((item: CardItem) => <ActivityCard key={item.key} item={item} />)}</div></>}</>
                : <div className="empty-state"><p>조건에 맞는 활동이 없습니다. 다른 조건으로 찾아보세요.</p>{activeFilters > 0 && <button type="button" className="secondary-button" onClick={resetFilters}>조건 모두 지우기</button>}</div>}
          </div>
          <aside className="explore-map map-wait" aria-label="지도">
            {asking ? <LocationAsk locating={locating} notice={notice} onLocate={locate} onPick={picked => { setAsking(false); setNotice(''); setOrigin(picked) }} onSkip={() => setAsking(false)} />
              : <div className="map-wait-copy"><Glyph name="map" size={30} /><strong>지도로 가까운 활동 보기</strong>
                <p>{preview ? '미리보기에서는 지도를 쓰지 않아요.' : '위치를 정하면 내 주변 활동과 1365 봉사가 지도에 보여요.'}</p>
                {!preview && <button className="pill-button dark small" onClick={() => setAsking(true)}><Glyph name="target" size={15} />위치 정하기</button>}</div>}
          </aside>
        </div>}
    </section>
    {programDetail && <ProgramDialog program={programDetail} onClose={() => setProgramDetail(null)} />}
  </>
}

/** Page numbers under a list: ‹ 1 2 3 ›, at most 5 numbers around the current page. */
function Pages({ total, size, page, onPage }: { total: number; size: number; page: number; onPage: (page: number) => void }) {
  const count = Math.ceil(total / size)
  if (count <= 1) return null
  const from = Math.max(1, Math.min(page - 2, count - 4)), to = Math.min(count, from + 4)
  return <nav className="pages" aria-label="쪽 이동">
    <button type="button" aria-label="이전 쪽" disabled={page === 1} onClick={() => onPage(page - 1)}>‹</button>
    {Array.from({ length: to - from + 1 }, (_, i) => from + i).map(n => <button type="button" key={n} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button>)}
    <button type="button" aria-label="다음 쪽" disabled={page === count} onClick={() => onPage(page + 1)}>›</button>
  </nav>
}

function LocationAsk({ locating, notice, onLocate, onPick, onSkip }: { locating: boolean; notice: string; onLocate: () => void; onPick: (origin: Origin) => void; onSkip: () => void }) {
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const [found, setFound] = useState<PlaceResult[] | null>(null)
  const [error, setError] = useState('')
  async function find(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) return
    try {
      const result = await searchPlaces(text.trim())
      setFound(result.items.filter(item => item.latitude != null))
      setError('')
    } catch { setError('지역을 찾지 못했습니다. 잠시 후 다시 시도해 주세요.') }
  }
  return <section className="panel location-ask" aria-label="위치 고르기">
    <span className="ask-icon"><Glyph name="pin" size={22} /></span>
    <div><h3>내 주변 활동을 찾을까요?</h3><p>위치는 찾을 때만 쓰고 저장하지 않아요. 위치를 허용하지 않아도 지역을 골라 찾을 수 있어요.</p>
      {notice && <p className="inline-notice" role="status">{notice}</p>}
      <div className="button-row"><button className="primary-button" onClick={onLocate} disabled={locating}><Glyph name="target" size={16} />{locating ? '위치 확인 중…' : '내 위치로 찾기'}</button>
        <button className="secondary-button" onClick={() => setTyping(!typing)}>지역 직접 고르기</button><button className="text-button" onClick={onSkip}>그냥 둘러보기</button></div>
      {typing && <form className="area-search" onSubmit={find}><input aria-label="동네·역·건물 이름" value={text} maxLength={50} onChange={event => setText(event.target.value)} placeholder="동네·역·건물 이름 (예: 옥정동, 덕정역)" /><button className="secondary-button" type="submit">찾기</button></form>}
      {error && <p className="field-error">{error}</p>}
      {found && (found.length ? <ul className="area-results">{found.slice(0, 6).map(item => <li key={(item.kakaoId ?? item.placeId) + item.name}><button onClick={() => onPick({ lat: Number(item.latitude), lng: Number(item.longitude), label: item.name })}><strong>{item.name}</strong><small>{item.address}</small></button></li>)}</ul>
        : <p className="small-print">위치를 알 수 있는 결과가 없어요. 다른 이름으로 찾아보세요.</p>)}
    </div>
  </section>
}

function when1365(program: Program) {
  const period = program.periodStart && program.periodEnd ? (program.periodStart === program.periodEnd ? program.periodStart.slice(5).replace('-', '/') : program.periodStart.slice(5).replace('-', '/') + ' ~ ' + program.periodEnd.slice(5).replace('-', '/')) : ''
  return [period, program.weekdays, program.beginTime && program.endTime ? program.beginTime + ' ~ ' + program.endTime : null].filter(Boolean).join(' · ')
}

function HitCard({ hit, active, onHover, onDetail }: { hit: Hit; active: boolean; onHover?: (on: boolean) => void; onDetail?: (program: Program) => void }) {
  const hover = onHover ? { onMouseEnter: () => onHover(true), onMouseLeave: () => onHover(false), onFocus: () => onHover(true), onBlur: () => onHover(false) } : {}
  const distance = hit.distanceKm != null && <span className="distance">{hit.distanceKm}km · {travel(hit.distanceKm)}</span>
  if (hit.local) {
    const a = hit.local
    const card = fromLive(a)
    return <article className={'hit-card' + (active ? ' active' : '')} {...hover}>
      <span className="hit-cover"><CategoryCover category={a.category} seed={a.id} /></span><div className="hit-main">
      <div className="hit-tags"><span className="source local">동네 활동</span><span className="tag">{a.category}</span>{Number(a.startTime.slice(0, 2)) < 12 ? <span className="tag">오전</span> : <span className="tag">오후</span>}</div>
      <h3 title={a.title}>{a.title}</h3>
      <p><Glyph name="pin" size={14} /><span className="clip">{card.placeName}</span>{distance}</p>
      <p><Glyph name="calendar" size={14} /><span className="clip">{card.date.slice(5).replace('-', '/')} {a.startTime} · {a.durationMinutes}분 · {a.confirmed} / {a.capacity}명</span></p>
      {a.supplies && a.supplies.length > 0 && <SupplyChips supplies={a.supplies} limit={2} />}
      <div className="hit-foot"><small>공식 봉사실적·보험 없음</small><a className="primary-button small" href={card.href}>자세히 보기 <Glyph name="arrow" size={14} /></a></div>
    </div></article>
  }
  const p = hit.program!
  return <article className={'hit-card' + (active ? ' active' : '')} {...hover}>
    <span className="hit-cover"><CategoryCover category="1365" seed={p.programNo.length + p.title.length} /></span><div className="hit-main">
    <div className="hit-tags"><span className="source program">1365 활동</span>{p.youthOk && <span className="tag">청소년 가능</span>}{p.recruitStatus && <span className="tag">{p.recruitStatus}</span>}</div>
    <h3 title={p.title}>{p.title}</h3>
    <p><Glyph name="pin" size={14} /><span className="clip">{p.place ?? '장소 정보 없음'}</span>{distance}</p>
    <p><Glyph name="calendar" size={14} /><span className="clip">{when1365(p) || '일정은 1365에서 확인'}</span></p>
    <div className="hit-foot"><small>모집: {p.organization ?? '1365'} · 실적 인정은 1365 기준</small><span className="hit-actions">{onDetail && <button className="secondary-button small" onClick={() => onDetail(p)}>자세히</button>}<a className="link-out" href={p.link} target="_blank" rel="noopener noreferrer">1365에서 신청 <Glyph name="external" size={14} /></a></span></div>
  </div></article>
}

function PreviewSheet({ hit, onClose, onDetail }: { hit: Hit; onClose: () => void; onDetail: (program: Program) => void }) {
  return <div className="preview-sheet" role="dialog" aria-label={hit.title + ' 미리보기'}>
    <button className="icon-button" onClick={onClose} aria-label="미리보기 닫기"><Glyph name="close" size={16} /></button>
    <HitCard hit={hit} active={false} onDetail={onDetail} />
  </div>
}

/** 1365 program summary inside Volink. Applying, approval and hours all happen on 1365; nothing is sent from here. */
function ProgramDialog({ program: p, onClose }: { program: Program; onClose: () => void }) {
  const [mapOpen, setMapOpen] = useState(false)
  const [copied, setCopied] = useState('')
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  const rows: [string, string | null][] = [
    ['모집 기관', p.organization], ['장소', p.place ? p.place + (p.distanceKm != null ? ` (${p.distanceKm}km)` : '') : null], ['기간', when1365(p) || null],
    ['모집', [p.capacity != null ? p.capacity + '명' : null, p.recruitStatus, p.youthOk ? '청소년 가능' : p.youthOk === false ? '청소년 불가' : null].filter(Boolean).join(' · ') || null],
    ['분야', p.field], ['모집 마감', p.recruitEnd],
  ]
  return createPortal(<div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="place-dialog program-dialog" role="dialog" aria-modal="true" aria-labelledby="program-title">
      <div className="dialog-head"><span className="source program">1365 활동</span><button type="button" className="icon-button" onClick={onClose} aria-label="닫기"><Glyph name="close" /></button></div>
      <h2 id="program-title">{p.title}</h2>
      <dl className="program-facts">{rows.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="program-note"><Glyph name="info" size={16} />신청·승인·봉사시간 인정은 1365에서 해요. 1365 로그인이 필요하고, Volink는 내 정보를 1365에 보내지 않아요.</p>
      <div className="button-row program-actions">
        <a className="apply-1365" href={p.link} target="_blank" rel="noopener noreferrer">1365에서 신청하기 <Glyph name="external" size={16} /></a>
        {p.latitude != null && <button type="button" className="secondary-button" aria-expanded={mapOpen} onClick={() => setMapOpen(!mapOpen)}><Glyph name="map" size={16} />약도</button>}
        <button type="button" className="secondary-button" onClick={() => navigator.clipboard?.writeText(p.link).then(() => setCopied('링크를 복사했어요.'), () => setCopied('복사하지 못했어요. 신청 버튼을 눌러 주세요.'))}><Glyph name="link" size={16} />링크 복사</button>
      </div>
      {mapOpen && p.latitude != null && <section className="sketch-map" aria-label="약도">
        <p className="sketch-address"><Glyph name="pin" size={16} /><span><strong>{p.place ?? '장소'}</strong>{p.organization ? <small>모집 기관: {p.organization}</small> : null}</span>
          <a className="secondary-button small" href={`https://map.kakao.com/link/to/${encodeURIComponent(p.place ?? p.title)},${p.latitude},${p.longitude}`} target="_blank" rel="noopener noreferrer">길찾기 <Glyph name="external" size={14} /></a></p>
        <MiniMap lat={Number(p.latitude)} lng={Number(p.longitude)} label={p.place ?? p.title} />
        <p className="small-print">위치는 장소 이름으로 찾은 대략적인 위치예요. 정확한 만남 장소는 1365 상세에서 확인해 주세요.</p>
      </section>}
      {copied && <p className="small-print" role="status">{copied}</p>}
      <p className="small-print">정보 출처: 행정안전부 공공데이터(1365) · 몇 시간마다 갱신 · 최신 모집 상태는 1365에서 확인해 주세요.</p>
    </div>
  </div>, document.body)
}

/** Small fixed map with one marker for the 1365 dialog. Without a map key: a note instead of a fake map. */
function MiniMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(!kakaoEnabled)
  useEffect(() => {
    if (!kakaoEnabled) return
    let cancelled = false
    loadKakao().then(kakao => {
      if (cancelled || !box.current) return
      const position = new kakao.maps.LatLng(lat, lng)
      const map = new kakao.maps.Map(box.current, { center: position, level: 3 })
      new kakao.maps.Marker({ map, position, title: label })
    }).catch(() => setFailed(true))
    return () => { cancelled = true }
  }, [lat, lng, label])
  if (failed) return <div className="mini-map empty"><Glyph name="map" size={24} /><span>지도 키가 없어 약도를 그릴 수 없어요. 길찾기로 확인해 주세요.</span></div>
  return <div ref={box} className="mini-map" role="img" aria-label={label + ' 약도'} />
}

/** "You are here": a dot with a white ring, a soft pulse and a label (drawn by Kakao as an overlay). */
function meMarker(label: string) {
  const box = document.createElement('div')
  box.className = 'me-marker'
  box.innerHTML = '<span class="me-pulse"></span><span class="me-dot"></span><span class="me-label"></span>'
  box.querySelector('.me-label')!.textContent = label
  return box
}


/** Kakao map with coloured pins (green = ours, blue = 1365); dragging shows "이 지역에서 다시 찾기". Without a key: a position sketch. */
function ExploreMap({ origin, radiusKm, hits, selected, onSelect, onMoved, onHome }: { origin: Origin; radiusKm: number; hits: Hit[]; selected: string | null; onSelect: (key: string) => void; onMoved: (centre: { lat: number; lng: number }, label: string) => void; onHome?: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<any>(null)
  const drawn = useRef<any[]>([])
  const area = useRef<any[]>([])
  const [moved, setMoved] = useState(false)
  // A spot the user clicked: a red dot, and "이 위치에서 다시 찾기" searches around it instead of the map centre.
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null)
  const dot = useRef<any>(null)
  const [failed, setFailed] = useState(!kakaoEnabled)
  const select = useRef(onSelect)
  select.current = onSelect

  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!kakaoEnabled) return
    let cancelled = false
    loadKakao().then(kakao => {
      if (cancelled || !box.current) return
      map.current = new kakao.maps.Map(box.current, { center: new kakao.maps.LatLng(origin.lat, origin.lng), level: 6 })
      kakao.maps.event.addListener(map.current, 'dragend', () => setMoved(true))
      // One click drops the dot (after a short wait, so a double-click stays Kakao's zoom).
      let timer: ReturnType<typeof setTimeout> | undefined
      kakao.maps.event.addListener(map.current, 'click', (event: any) => {
        clearTimeout(timer)
        timer = setTimeout(() => { setPicked({ lat: event.latLng.getLat(), lng: event.latLng.getLng() }); setMoved(true) }, 250)
      })
      kakao.maps.event.addListener(map.current, 'dblclick', () => clearTimeout(timer))
      setReady(true)
    }).catch(() => setFailed(true))
    return () => { cancelled = true }
    // The map is created once; later origin changes only move it (below).
  }, [])
  useEffect(() => { setMoved(false); setPicked(null) }, [origin])
  useEffect(() => {
    const kakao = window.kakao
    dot.current?.setMap(null)
    dot.current = null
    if (!picked || !map.current || !kakao?.maps) return
    dot.current = new kakao.maps.CustomOverlay({ map: map.current, position: new kakao.maps.LatLng(picked.lat, picked.lng), content: '<span class="picked-dot" aria-hidden="true"></span>', yAnchor: 0.5, zIndex: 6 })
  }, [picked, ready])

  // Search area: the radius circle and "my position", then zoom so the whole circle fits (changes with origin/radius only).
  useEffect(() => {
    const kakao = window.kakao
    if (!map.current || !kakao?.maps) return
    area.current.forEach(item => item.setMap(null))
    const centre = new kakao.maps.LatLng(origin.lat, origin.lng)
    const circle = new kakao.maps.Circle({ map: map.current, center: centre, radius: radiusKm * 1000, strokeWeight: 3, strokeColor: '#245e48', strokeOpacity: 0.85,
      strokeStyle: 'shortdash', fillColor: '#245e48', fillOpacity: 0.08 })
    const me = new kakao.maps.CustomOverlay({ map: map.current, position: centre, content: meMarker(origin.label), yAnchor: 0.5, zIndex: 5 })
    area.current = [circle, me]
    map.current.setBounds(circle.getBounds(), 16, 16, 16, 16)
  }, [radiusKm, origin, ready])

  // Pins: green = ours, blue = 1365; the hovered or selected one is drawn larger and on top.
  useEffect(() => {
    const kakao = window.kakao
    if (!map.current || !kakao?.maps) return
    drawn.current.forEach(item => item.setMap(null))
    drawn.current = []
    for (const hit of hits) {
      if (hit.lat == null || hit.lng == null) continue
      const content = document.createElement('button')
      content.type = 'button'
      content.className = 'kakao-pin' + (hit.key === selected ? ' on' : '')
      content.setAttribute('aria-label', hit.title)
      content.innerHTML = pinSvg(hit.source === 'local' ? '#245e48' : '#2f62a8', hit.key === selected)
      content.onclick = () => select.current(hit.key)
      drawn.current.push(new kakao.maps.CustomOverlay({ map: map.current, position: new kakao.maps.LatLng(hit.lat, hit.lng), content, yAnchor: 1, clickable: true, zIndex: hit.key === selected ? 4 : 1 }))
    }
  }, [hits, selected, ready])

  if (failed) return <SketchHits origin={origin} hits={hits} selected={selected} onSelect={onSelect} />
  return <div className="pin-map explore">
    <div ref={box} className="kakao-map" role="img" aria-label="활동 지도" />
    {moved && <button className="map-pill" onClick={() => {
      if (picked) { onMoved(picked, '찍은 위치'); return }
      const c = map.current?.getCenter()
      if (c) onMoved({ lat: c.getLat(), lng: c.getLng() }, '지도 중심')
    }}><Glyph name="refresh" size={14} />{picked ? '이 위치에서 다시 찾기' : '이 지역에서 다시 찾기'}</button>}
    <button type="button" className="map-home" aria-label="내 위치로" title="내 위치로" onClick={() => {
      if (onHome && origin.label !== '내 위치') onHome()
      else { const circle = area.current[0]; if (circle) map.current?.setBounds(circle.getBounds(), 16, 16, 16, 16); setMoved(false) }
    }}><Glyph name="target" size={18} /></button>
  </div>
}

function SketchHits({ origin, hits, selected, onSelect }: { origin: Origin; hits: Hit[]; selected: string | null; onSelect: (key: string) => void }) {
  const points = hits.filter(hit => hit.lat != null && hit.lng != null)
  const lats = [origin.lat, ...points.map(p => Number(p.lat))], lngs = [origin.lng, ...points.map(p => Number(p.lng))]
  const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
  const x = (lng: number) => east === west ? 50 : 10 + (lng - west) / (east - west) * 80
  const y = (lat: number) => north === south ? 50 : 10 + (north - lat) / (north - south) * 80
  return <div className="map-canvas explore-sketch" role="img" aria-label="활동 위치 그림 (지도 아님)">
    <span className="me-marker sketch" style={{ left: x(origin.lng) + '%', top: y(origin.lat) + '%' }}><span className="me-pulse" /><span className="me-dot" /><span className="me-label">{origin.label}</span></span>
    {points.map(hit => <button key={hit.key} type="button" className={'sketch-pin ' + (hit.source === '1365' ? 'program' : 'local') + (selected === hit.key ? ' selected' : '')} style={{ left: x(Number(hit.lng)) + '%', top: y(Number(hit.lat)) + '%' }} aria-label={hit.title + ' 위치'} onClick={() => onSelect(hit.key)}><Glyph name="pin" size={selected === hit.key ? 30 : 24} /></button>)}
    <span className="sketch-note">지도 키가 없어 위치만 그린 그림입니다.</span>
  </div>
}
