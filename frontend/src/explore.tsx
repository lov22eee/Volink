// Activity search (4주차 보완): ask for a location once, then one map + list of our activities and 1365 programs.
// Empty nearby results widen the radius by themselves (3 → 5 → 10 → 20 km). The position is used for the request only.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, preview } from './api'
import type { LiveActivity } from './api'
import { ActivityCard, categories, fromExample, fromLive, Icon, ParkArt } from './App'
import type { CardItem } from './App'
import type { DisplayCatalog as Catalog } from './data'
import { createPortal } from 'react-dom'
import { Glyph, SupplyChips } from './icons'
import { kakaoEnabled, loadKakao } from './map'
import type { Origin } from './map'
import { searchPlaces } from './placePicker'
import type { PlaceResult } from './placePicker'

export type Program = {
  programNo: string; title: string; organization: string | null; place: string | null; field: string | null
  periodStart: string | null; periodEnd: string | null; beginTime: string | null; endTime: string | null; weekdays: string | null
  recruitStatus: string | null; recruitEnd: string | null; capacity: number | null; youthOk: boolean | null
  latitude: number | null; longitude: number | null; distanceKm: number | null; link: string
}

type Source = 'all' | 'local' | '1365'
type When = 'all' | 'today' | 'week' | 'weekend'
type Hit = { key: string; source: 'local' | '1365'; title: string; lat: number | null; lng: number | null; distanceKm: number | null; local?: LiveActivity; program?: Program }

const rings = [1, 3, 5, 10, 20]
/** Remembers only that location was allowed (never the position), so the next visit opens on the map. */
const REMEMBER = 'volink.nearby'
const remembered = () => { try { return localStorage.getItem(REMEMBER) === '1' } catch { return false } }
const remember = (on: boolean) => { try { if (on) localStorage.setItem(REMEMBER, '1'); else localStorage.removeItem(REMEMBER) } catch { /* private mode */ } }

function km(a: Origin, lat: number, lng: number) {
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

function range(when: When): { from?: string; to?: string } {
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
  const [origin, setOrigin] = useState<Origin | null>(null)
  const [asking, setAsking] = useState(!preview && !remembered())
  const [locating, setLocating] = useState(false)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [source, setSource] = useState<Source>('all')
  const [radius, setRadius] = useState(3)
  const [when, setWhen] = useState<When>('all')
  const [part, setPart] = useState('')
  const [category, setCategory] = useState('전체')
  const [kind, setKind] = useState('all')
  const [youth, setYouth] = useState(false)
  const [live, setLive] = useState<LiveActivity[]>([])
  const [allLive, setAllLive] = useState<LiveActivity[]>([])
  const [programs, setPrograms] = useState<Program[]>([])
  const [programsOn, setProgramsOn] = useState(false)
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
    api<LiveActivity[]>('/api/activities?' + params).then(setAllLive).catch(() => setAllLive([]))
    if (!origin) return
    params.set('lat', origin.lat.toFixed(6)); params.set('lng', origin.lng.toFixed(6)); params.set('radiusKm', '20')
    api<LiveActivity[]>('/api/activities?' + params).then(setLive).catch(() => setLive([]))
  }, [origin, when, part, q, category, kind])
  useEffect(() => { if (!origin) setLive(allLive) }, [origin, allLive])

  // Location allowed before: go straight to the map.
  useEffect(() => { if (!preview && remembered()) locate() }, [])

  // 1365 programs need a position (they are looked up by region).
  useEffect(() => {
    if (preview || !origin) { setPrograms([]); return }
    const params = new URLSearchParams({ lat: origin.lat.toFixed(6), lng: origin.lng.toFixed(6), radiusKm: '20' })
    if (q) params.set('q', q)
    if (youth) params.set('youth', 'true')
    api<{ enabled: boolean; items: Program[] }>('/api/volunteer-programs?' + params)
      .then(result => { setProgramsOn(result.enabled); setPrograms(result.items) })
      .catch(() => { setProgramsOn(false); setPrograms([]) })
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

  const hits = useMemo<Hit[]>(() => {
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
      ...(source === '1365' ? [] : live.map(activity => ({ key: 'a' + activity.id, source: 'local' as const, title: activity.title, lat: activity.latitude ?? null, lng: activity.longitude ?? null, distanceKm: activity.distanceKm ?? null, local: activity }))),
      ...(source === 'local' ? [] : programs.filter(filterProgram).map(program => ({ key: 'p' + program.programNo, source: '1365' as const, title: program.title, lat: program.latitude, lng: program.longitude, distanceKm: program.distanceKm, program }))),
    ].sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999))
  }, [live, programs, source, category, kind, when, part])

  // Widen by itself when nothing is inside the chosen radius.
  const shownRadius = origin ? rings.find(ring => ring >= radius && hits.some(hit => hit.distanceKm != null && hit.distanceKm <= ring)) ?? radius : radius
  const inside = origin ? hits.filter(hit => hit.distanceKm == null || hit.distanceKm <= shownRadius) : hits
  const widened = origin && shownRadius > radius
  const examples = !origin && catalog ? catalog.activities.map(activity => fromExample(activity, catalog.baseDate)) : []
  const { from, to } = range(when)
  const filteredExamples = examples.filter(item => (category === '전체' || item.category === category) && (kind === 'all' || item.activityType === kind)
    && (item.title + item.placeName).includes(q) && (!from || item.date >= from) && (!to || item.date <= to) && (!part || (part === 'AM') === item.startTime < '12:00'))
  const chosen = inside.find(hit => hit.key === selected) ?? null
  // Bottom list: every recruiting activity (with distance when known) and the 1365 programs found, nearest first.
  const everything = !origin ? [] : [
    ...(source === '1365' ? [] : allLive.map(activity => {
      const distanceKm = activity.latitude != null && activity.longitude != null ? km(origin, activity.latitude, activity.longitude) : undefined
      return { key: 'a' + activity.id, distance: distanceKm ?? 999, card: { ...fromLive(activity), distanceKm } as CardItem, hit: undefined as Hit | undefined }
    })),
    ...hits.filter(hit => hit.source === '1365').map(hit => ({ key: hit.key, distance: hit.distanceKm ?? 999, card: undefined as CardItem | undefined, hit })),
  ].sort((a, b) => a.distance - b.distance)

  function search(event: FormEvent) {
    event.preventDefault()
    setQ(query.trim())
  }

  return <>
    <section className="hero compact-hero">
      <div className="hero-copy"><span className="eyebrow"><span className="tiny-dot" />작은 실천, 가까운 연결</span><h1>가까운 곳에서,<br />함께 만드는 <em>변화.</em></h1><p>잠깐의 시간으로 우리 동네를 조금 더 좋게.<br />동네 활동과 1365 봉사활동을 한 번에 찾아보세요.</p><button className="primary-button" onClick={() => document.getElementById('activities')?.scrollIntoView()}>주변 활동 살펴보기 <Icon name="arrow" size={18} /></button><span className="hero-note">2–10명 함께 · 3시간 이내</span></div>
      <div className="hero-art"><ParkArt /><div className="floating-note"><span className="floating-icon"><Icon name="leaf" /></span><div><strong>혼자보다, 함께.</strong><span>우리 동네에 변화를 남겨요</span></div></div></div>
    </section>
    <section id="activities" className="activity-section">
      <div className="section-heading"><div><span className="eyebrow">NEAR YOU</span><h2>우리 동네의 작은 실천</h2></div>
        {!preview && <span className="location-tag"><Glyph name="pin" size={16} />{origin ? origin.label + ' 기준 ' + shownRadius + 'km' : '위치 미정'}{origin && <button className="text-button" onClick={() => { setAsking(true); setOrigin(null) }}>바꾸기</button>}</span>}
      </div>

      {asking && !origin && <LocationAsk locating={locating} notice={notice} onLocate={locate} onPick={picked => { setAsking(false); setNotice(''); setOrigin(picked) }} onSkip={() => setAsking(false)} />}

      <div className="finder panel">
        <div className="finder-top">
          <form className="finder-search" role="search" onSubmit={search}><Glyph name="search" /><input aria-label="활동 검색" value={query} maxLength={50} onChange={event => setQuery(event.target.value)} placeholder="플로깅, 도서관, 어르신… 검색" /><button className="primary-button small" type="submit">찾기</button></form>
          {origin && programsOn && <div className="segmented" role="group" aria-label="활동 출처">{([['all', '전체'], ['local', '동네 활동'], ['1365', '1365 활동']] as [Source, string][]).map(([value, text]) =>
            <button key={value} aria-pressed={source === value} onClick={() => setSource(value)}>{text} <small>{value === 'all' ? inside.length : inside.filter(hit => hit.source === value).length}</small></button>)}</div>}
        </div>
        <div className="finder-filters">
          {origin && <label className="chip-select"><Glyph name="pin" size={15} /><select aria-label="검색 반경" value={radius} onChange={event => setRadius(Number(event.target.value))}>{rings.map(value => <option key={value} value={value}>{value}km</option>)}</select></label>}
          <label className="chip-select"><Glyph name="calendar" size={15} /><select aria-label="날짜" value={when} onChange={event => setWhen(event.target.value as When)}><option value="all">모든 날짜</option><option value="today">오늘</option><option value="week">이번 주</option><option value="weekend">주말만</option></select></label>
          <label className="chip-select"><Glyph name="clock" size={15} /><select aria-label="시간대" value={part} onChange={event => setPart(event.target.value)}><option value="">모든 시간</option><option value="AM">오전</option><option value="PM">오후</option></select></label>
          <label className="chip-select"><Glyph name="leaf" size={15} /><select aria-label="활동 분야" value={category} onChange={event => setCategory(event.target.value)}><option>전체</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="chip-select"><Glyph name="hand" size={15} /><select aria-label="활동 유형" value={kind} onChange={event => setKind(event.target.value)}><option value="all">모든 활동</option><option value="GENERAL">자율 활동</option><option value="INSTITUTION">기관 주관 활동</option></select></label>
          {origin && programsOn && <label className={'chip-check' + (youth ? ' on' : '')}><input type="checkbox" checked={youth} onChange={event => setYouth(event.target.checked)} /><Glyph name="users" size={15} />청소년 가능만</label>}
          {(q || when !== 'all' || part || category !== '전체' || kind !== 'all' || youth) && <button className="text-button" onClick={() => { setQuery(''); setQ(''); setWhen('all'); setPart(''); setCategory('전체'); setKind('all'); setYouth(false) }}>필터 초기화</button>}
          {!origin && !preview && !asking && <button className="secondary-button nearby-button" onClick={() => setAsking(true)}><Glyph name="target" size={15} />내 주변 찾기</button>}
        </div>
      </div>
      {origin && <p className="small-print location-note">위치는 이번 검색에만 쓰고 저장하지 않습니다.{programsOn ? ' 1365 활동은 행정안전부 공공데이터를 몇 시간마다 받아와 보여주며, 신청과 최신 모집 상태는 1365에서 확인해 주세요.' : ''}</p>}

      {origin ? <>
        <section className="panel nearby-panel" aria-label="내 주변">
          <div className="nearby-head"><h3>내 주변 {shownRadius}km</h3><span className="list-count">{origin.label} 기준 · 가까운 순 {Math.min(5, inside.length)}개 · <button className="text-button" onClick={() => document.getElementById('all-list')?.scrollIntoView()}>모든 모집글 보기 ↓</button></span></div>
          {programsOn && programs.length === 0 && <p className="small-print">근처 20km에서 지금 모집 중인 1365 활동을 찾지 못했어요. 지역을 바꾸거나 잠시 뒤 다시 확인해 주세요.</p>}
          {widened && <div className="widen-callout" role="status"><strong>{radius}km 안에는 없어서 {shownRadius}km까지 넓혔어요</strong>
            <span className="ring-steps">{rings.filter(ring => ring >= radius && ring <= shownRadius).map(ring => <span key={ring} className={ring === shownRadius ? 'on' : ''}>{ring}km · {hits.filter(hit => hit.distanceKm != null && hit.distanceKm <= ring).length}개</span>)}</span>
            <small>최대 20km까지만 넓혀요</small></div>}
          <div className="explore-split">
            <div className="explore-map">
              <ExploreMap origin={origin} radiusKm={shownRadius} hits={inside} selected={hovered ?? selected} onSelect={setSelected}
                onHome={myPosition ? () => setOrigin(myPosition) : undefined}
                onMoved={centre => setOrigin({ ...centre, label: '지도 중심' })} />
              {chosen && <PreviewSheet hit={chosen} onClose={() => setSelected(null)} onDetail={setProgramDetail} />}
              <span className="map-legend"><i className="dot local" />동네 활동{programsOn && <><i className="dot program" />1365 활동</>}</span>
            </div>
            <div className="explore-list">
              {inside.length ? <ul className="hit-list">{inside.slice(0, 5).map(hit => <li key={hit.key}><HitCard hit={hit} active={hit.key === (hovered ?? selected)} onHover={on => setHovered(on ? hit.key : null)} onDetail={setProgramDetail} /></li>)}</ul>
                : <div className="empty-state"><p>20km 안에도 조건에 맞는 활동이 없어요.</p><a className="secondary-button" href="#/create">이 동네에 활동 만들기 <Glyph name="arrow" size={15} /></a></div>}
            </div>
          </div>
        </section>
        <div className="all-head" id="all-list"><h3>모든 모집글</h3><span className="list-count">가까운 순 · {everything.length}개</span></div>
        {everything.length ? <div className="activity-grid">{everything.map(entry => entry.card ? <ActivityCard key={entry.key} item={entry.card} />
          : <div key={entry.key} className="program-tile"><HitCard hit={entry.hit!} active={false} onDetail={setProgramDetail} /></div>)}</div>
          : <div className="empty-state">조건에 맞는 모집글이 없습니다. 다른 조건으로 찾아보세요.</div>}
      </>
        : <>{(!catalog && !live.length) ? <div className="empty-state">활동 정보를 불러오는 중입니다.</div>
          : (live.length + filteredExamples.length) ? <div className="activity-grid">{[...live.map(fromLive), ...filteredExamples].map((item: CardItem) => <ActivityCard key={item.key} item={item} />)}</div>
            : <div className="empty-state">조건에 맞는 활동이 없습니다. 다른 조건으로 찾아보세요.</div>}</>}
    </section>
    {programDetail && <ProgramDialog program={programDetail} onClose={() => setProgramDetail(null)}
      onShowOnMap={() => { setSelected('p' + programDetail.programNo); setProgramDetail(null); document.querySelector('.explore-map')?.scrollIntoView({ block: 'center' }) }} />}
    <section className="bottom-callout"><div className="callout-icon"><Icon name="plus" size={26} /></div><div><h3>내가 먼저, 작은 변화를 시작해 볼까요?</h3><p>이웃과 함께할 작은 활동을 생각해 보세요.</p></div><a href="#/create" className="secondary-button">활동 만들기 <Icon name="arrow" size={17} /></a></section>
  </>
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
      <div className="hit-tags"><span className="source local">동네 활동</span><span className="tag">{a.category}</span>{Number(a.startTime.slice(0, 2)) < 12 ? <span className="tag">오전</span> : <span className="tag">오후</span>}</div>
      <h3>{a.title}</h3>
      <p><Glyph name="pin" size={14} />{card.placeName} {distance}</p>
      <p><Glyph name="calendar" size={14} />{card.date.slice(5).replace('-', '/')} {a.startTime} · {a.durationMinutes}분 · <Glyph name="users" size={14} />{a.confirmed} / {a.capacity}명</p>
      {a.supplies && a.supplies.length > 0 && <SupplyChips supplies={a.supplies} limit={2} />}
      <div className="hit-foot"><small>공식 봉사실적·보험 없음</small><a className="primary-button small" href={card.href}>자세히 보기 <Glyph name="arrow" size={14} /></a></div>
    </article>
  }
  const p = hit.program!
  return <article className={'hit-card' + (active ? ' active' : '')} {...hover}>
    <div className="hit-tags"><span className="source program">1365 활동</span>{p.youthOk && <span className="tag">청소년 가능</span>}{p.recruitStatus && <span className="tag">{p.recruitStatus}</span>}</div>
    <h3>{p.title}</h3>
    <p><Glyph name="pin" size={14} />{p.place ?? '장소 정보 없음'} {distance}</p>
    <p><Glyph name="calendar" size={14} />{when1365(p) || '일정은 1365에서 확인'}</p>
    <div className="hit-foot"><small>모집: {p.organization ?? '1365'} · 실적 인정은 1365 기준</small><span className="hit-actions">{onDetail && <button className="secondary-button small" onClick={() => onDetail(p)}>자세히</button>}<a className="link-out" href={p.link} target="_blank" rel="noopener noreferrer">1365에서 신청 <Glyph name="external" size={14} /></a></span></div>
  </article>
}

function PreviewSheet({ hit, onClose, onDetail }: { hit: Hit; onClose: () => void; onDetail: (program: Program) => void }) {
  return <div className="preview-sheet" role="dialog" aria-label={hit.title + ' 미리보기'}>
    <button className="icon-button" onClick={onClose} aria-label="미리보기 닫기"><Glyph name="close" size={16} /></button>
    <HitCard hit={hit} active={false} onDetail={onDetail} />
  </div>
}

/** 1365 program summary inside Volink. Applying, approval and hours all happen on 1365; nothing is sent from here. */
function ProgramDialog({ program: p, onClose, onShowOnMap }: { program: Program; onClose: () => void; onShowOnMap: () => void }) {
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
        {p.latitude != null && <button type="button" className="secondary-button" onClick={onShowOnMap}><Glyph name="map" size={16} />지도에서 보기</button>}
        <button type="button" className="secondary-button" onClick={() => navigator.clipboard?.writeText(p.link).then(() => setCopied('링크를 복사했어요.'), () => setCopied('복사하지 못했어요. 신청 버튼을 눌러 주세요.'))}><Glyph name="link" size={16} />링크 복사</button>
      </div>
      {copied && <p className="small-print" role="status">{copied}</p>}
      <p className="small-print">정보 출처: 행정안전부 공공데이터(1365) · 몇 시간마다 갱신 · 최신 모집 상태는 1365에서 확인해 주세요.</p>
    </div>
  </div>, document.body)
}

/** "You are here": a dot with a white ring, a soft pulse and a label (drawn by Kakao as an overlay). */
function meMarker(label: string) {
  const box = document.createElement('div')
  box.className = 'me-marker'
  box.innerHTML = '<span class="me-pulse"></span><span class="me-dot"></span><span class="me-label"></span>'
  box.querySelector('.me-label')!.textContent = label
  return box
}

const pinSvg = (colour: string, big: boolean) => `<svg width="${big ? 36 : 28}" height="${big ? 36 : 28}" viewBox="0 0 24 24" fill="${colour}" stroke="#fff" stroke-width="1.6"><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11Z"/><circle cx="12" cy="10" r="2.3" fill="#fff"/></svg>`

/** Kakao map with coloured pins (green = ours, blue = 1365); dragging shows "이 지역에서 다시 찾기". Without a key: a position sketch. */
function ExploreMap({ origin, radiusKm, hits, selected, onSelect, onMoved, onHome }: { origin: Origin; radiusKm: number; hits: Hit[]; selected: string | null; onSelect: (key: string) => void; onMoved: (centre: { lat: number; lng: number }) => void; onHome?: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<any>(null)
  const drawn = useRef<any[]>([])
  const area = useRef<any[]>([])
  const [moved, setMoved] = useState(false)
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
      setReady(true)
    }).catch(() => setFailed(true))
    return () => { cancelled = true }
    // The map is created once; later origin changes only move it (below).
  }, [])
  useEffect(() => setMoved(false), [origin])

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
    {moved && <button className="map-pill" onClick={() => { const c = map.current?.getCenter(); if (c) onMoved({ lat: c.getLat(), lng: c.getLng() }) }}><Glyph name="refresh" size={14} />이 지역에서 다시 찾기</button>}
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
