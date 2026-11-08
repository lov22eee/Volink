// Home (Volink 2.0, 2026-10-28): big type and a category visual with the real next activity, browse by field, this week's activities and a
// short guide. Activities come from the server (or the bundled examples in the offline preview); nothing here is
// made up, and when the list cannot be loaded the section says so instead of showing placeholders.
import { useEffect, useState } from 'react'
import { api, preview } from './api'
import type { LiveActivity, MyParticipation, User, ViewerInfo } from './api'
import { categories, fromExample, fromLive, Icon, waitOpen } from './App'
import type { CardItem } from './App'
import { CategoryCover, HeroCover } from './covers'
import type { DisplayCatalog as Catalog } from './data'
import { Glyph } from './icons'
import type { GlyphName } from './icons'
import { when1365 } from './explore'
import type { Program } from './explore'
import { currentPosition, remember, remembered } from './location'
import { hhmm, phaseOf, useNow } from './checkin'

const categoryIcon: Record<string, GlyphName> = { 환경: 'leaf', 교육: 'book', 복지: 'hand', '문화·예술': 'palette', 동물: 'paw', 지역사회: 'users', 기타: 'target' }

function seoulToday(days = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + days * 86_400_000))
}

function shortDate(value: string) {
  const day = new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value + 'T12:00:00+09:00'))
  return `${value.slice(5, 7)}.${value.slice(8, 10)}(${day})`
}

export function ActivityTile({ item, mine }: { item: CardItem; mine?: MyParticipation }) {
  const left = Math.max(0, item.capacity - item.confirmed)
  const status = item.kind === 'example' ? { text: '예시 활동', tone: 'muted' } : left > 0 ? { text: '모집 중', tone: 'open' } : { text: waitOpen(item) ? '대기 가능' : '정원 마감', tone: 'wait' }
  return <a className="tile" href={item.href} data-kind={item.kind}>
    <span className="tile-cover"><CategoryCover category={item.category} seed={item.id} />{mine && <span className={'tile-mine ' + mine.status.toLowerCase()}>{myLabel(mine)}</span>}</span>
    <span className="tile-meta"><span className="tile-cat">{item.category}</span><span aria-hidden="true">·</span><span className={'tile-status ' + status.tone}>{status.text}</span></span>
    <strong className="tile-title">{item.title}</strong>
    <span className="tile-info">{shortDate(item.date)} {item.startTime} · {item.placeName} · {left > 0 ? `${left}자리 남음` : '정원 마감'}</span>
  </a>
}

export default function Home({ user, catalog }: { user: User | null; catalog: Catalog | null }) {
  const [all, setAll] = useState<LiveActivity[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (preview) return
    setFailed(false)
    api<LiveActivity[]>('/api/activities').then(setAll).catch(() => setFailed(true))
  }, [attempt])

  const today = seoulToday()
  const weekEnd = seoulToday(6)
  const items: CardItem[] | null = preview
    ? (catalog ? catalog.activities.map(e => fromExample(e, catalog.baseDate)) : null)
    : all && all.filter(a => a.date >= today).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime)).map(fromLive)
  const mine = useMine(user)
  const cancelled = new Set((mine ?? []).filter(p => p.status === 'CANCELLED').map(p => p.activityId))
  const statusOf = new Map((mine ?? []).filter(p => ACTIVE.includes(p.status)).map(p => [p.activityId, p]))
  // Activities the viewer cancelled are not offered again here; they get their own row at the bottom.
  const thisWeek = items?.filter(item => item.date <= weekEnd && !(item.kind === 'live' && cancelled.has(item.id))) ?? []
  const shown = (thisWeek.length ? thisWeek : (items ?? []).filter(item => !(item.kind === 'live' && cancelled.has(item.id)))).slice(0, 3)
  const next = items?.[0]
  const heading = preview ? '이런 활동을 함께해요' : thisWeek.length || !items?.length ? '이번 주, 함께할 활동' : '곧 열리는 활동'

  return <div className="home">
    <section className="home-hero">
      <div className="home-hero-copy">
        <span className="home-eyebrow"><Glyph name="pin" size={16} />우리 동네에서 시작하는 좋은 일</span>
        <h1>가까운 곳에서,<br />함께 만드는 변화.</h1>
        <p>봉사활동, 거창하지 않아도 괜찮아요. 오늘 우리 동네에서 할 수 있는 작은 일을 찾아보세요.</p>
        <div className="home-actions"><a className="pill-button dark" href="#/explore">내 주변 활동 찾기 <Icon name="outward" size={17} /></a><a className="pill-button line" href="#/create">활동 만들기</a></div>
        <small>찾기부터 참여까지, 한곳에서 간편하게.</small>
      </div>
      <div className="home-hero-visual">
        <div className="hero-art" aria-hidden="true"><HeroCover categories={categories} /></div>
        {/* The real next activity (or example in the preview), so the first screen already shows something to join. */}
        {next && <a className="next-card" href={next.href}>
          <span className="next-label">{next.kind === 'example' ? '예시 활동' : '곧 열리는 활동'}</span>
          <strong>{next.title}</strong>
          <span className="next-info"><Glyph name="calendar" size={15} />{shortDate(next.date)} {next.startTime}</span>
          <span className="next-info"><Glyph name="pin" size={15} />{next.placeName}</span>
          <span className="next-seats"><span className="bar" aria-hidden="true"><i style={{ width: Math.min(100, next.confirmed / Math.max(1, next.capacity) * 100) + '%' }} /></span>{next.confirmed}/{next.capacity}명</span>
        </a>}
      </div>
    </section>

    {user && user.role !== 'ADMIN' && mine && <MyStatus items={mine} name={user.name} />}

    <section className="home-block" aria-labelledby="home-fields">
      <div className="home-block-head"><h2 id="home-fields">어떤 봉사에 관심 있나요?</h2><span className="home-aside">관심 분야부터 시작해요</span></div>
      <div className="field-chips">{categories.map(name => <a key={name} className="field-chip" href={'#/explore?category=' + encodeURIComponent(name)}><Glyph name={categoryIcon[name] ?? 'leaf'} size={18} />{name}</a>)}</div>
    </section>

    <section className="home-block" aria-labelledby="home-week">
      <div className="home-block-head"><div><h2 id="home-week">{heading}</h2><p>우리 동네에서 기다리는 봉사활동</p></div><a className="home-more" href="#/explore">전체 보기 <Icon name="outward" size={15} /></a></div>
      {shown.length ? <div className="tile-row">{shown.map(item => <ActivityTile key={item.key} item={item} mine={item.kind === 'live' ? statusOf.get(item.id) : undefined} />)}</div>
        : failed ? <div className="home-empty" role="alert"><p>활동을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p><button className="pill-button line small" onClick={() => setAttempt(n => n + 1)}>다시 불러오기</button></div>
          : items ? <div className="home-empty"><Glyph name="leaf" size={26} /><p>아직 모집 중인 활동이 없어요. 우리 동네 첫 활동을 열어 보세요.</p><a className="pill-button dark small" href="#/create">활동 만들기</a></div>
            : <div className="home-empty" role="status">활동을 불러오는 중입니다.</div>}
    </section>

    {!preview && <Nearby1365 />}

    {user && mine && <Cancelled items={mine.filter(p => p.status === 'CANCELLED' && p.date >= today)} />}

    {user ? <section className="home-guide short" aria-label="참여 방법"><div><strong>처음이어도 괜찮아요</strong><span>내 주변 활동 찾기 → 신청하기 → 함께 참여하기</span></div><a className="pill-button line small" href="#/explore">활동 찾기</a></section>
      : <section className="home-guide" aria-label="참여 방법">
      <span className="guide-label">VOLINK GUIDE</span>
      <h2>처음이어도 괜찮아요.</h2>
      <ol>
        <li><b>01</b><strong>내 주변 활동 찾기</strong><span>관심 있는 동네 봉사활동을 찾아요.</span></li>
        <li><b>02</b><strong>간편하게 신청하기</strong><span>신청하고 참여 상태를 확인해요.</span></li>
        <li><b>03</b><strong>함께 참여하기</strong><span>정해진 시간과 장소에서 만나요.</span></li>
      </ol>
      <p className="guide-note">공식 봉사실적·자원봉사 종합보험은 1365 활동에만 해당돼요.</p>
    </section>}
  </div>
}

const ACTIVE = ['APPLIED', 'CONFIRMED', 'WAITLISTED', 'OFFERED']

function myLabel(p: Pick<MyParticipation, 'status' | 'waitOrder'>) {
  return ({ APPLIED: '승인 대기 중', CONFIRMED: '참가 확정', WAITLISTED: `대기 ${p.waitOrder ?? ''}번`, OFFERED: '빈자리 제안' } as Record<string, string>)[p.status] ?? ''
}

/** The signed-in member's own applications (null while loading or for guests). */
function useMine(user: User | null) {
  const [items, setItems] = useState<MyParticipation[] | null>(null)
  useEffect(() => {
    setItems(null)
    if (!user || user.role === 'ADMIN' || preview) return
    api<MyParticipation[]>('/api/me/participations').then(setItems).catch(() => setItems(null))
  }, [user])
  return items
}

function dday(date: string) {
  const days = Math.round((new Date(date + 'T00:00:00+09:00').getTime() - new Date(seoulToday() + 'T00:00:00+09:00').getTime()) / 86_400_000)
  return days === 0 ? '오늘' : 'D-' + days
}

function DateChip({ date }: { date: string }) {
  const weekday = new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(date + 'T12:00:00+09:00'))
  return <span className="date-block" aria-hidden="true"><small>{Number(date.slice(5, 7))}월</small><b>{Number(date.slice(8, 10))}</b><small>{weekday}</small></span>
}

/** A slim summary under the hero: counts, the next confirmed date and, if one is waiting, the seat offer to answer. */
function MyStatus({ items, name }: { items: MyParticipation[]; name: string }) {
  const today = seoulToday()
  const upcoming = items.filter(p => p.date >= today)
  const count = (...statuses: string[]) => upcoming.filter(p => statuses.includes(p.status)).length
  const next = upcoming.filter(p => p.status === 'CONFIRMED').sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))[0]
  const offers = upcoming.filter(p => p.status === 'OFFERED')
  // Confirmed and on site now: the check-in window is open (30 min before to 30 min after the start).
  const now = useNow()
  const checkins = upcoming.filter(p => p.status === 'CONFIRMED').map(p => ({ p, day: phaseOf(p.date, p.startTime, p.durationMinutes ?? 60, now, Boolean(p.checkinOpen)) })).filter(({ day }) => day.phase === 'open')
  return <section className="home-me" aria-label="내 활동 현황">
    <div className="me-bar">
      <div className="me-hi"><strong>{name}님</strong><span>내 활동 현황</span></div>
      <dl className="me-nums">
        <div><dt>참가 확정</dt><dd>{count('CONFIRMED')}</dd></div>
        <div className="wait"><dt>승인 대기</dt><dd>{count('APPLIED')}</dd></div>
        <div className="wait"><dt>대기 중</dt><dd>{count('WAITLISTED', 'OFFERED')}</dd></div>
      </dl>
      {next ? <a className="me-next" href={'#/activity/' + next.activityId}><DateChip date={next.date} /><span><small>다음 일정 · {dday(next.date)}</small><strong>{next.title}</strong><small>{next.startTime}{next.placeName ? ' · ' + next.placeName : ''}</small></span></a>
        : <p className="me-next empty">확정된 일정이 아직 없어요.</p>}
      <a className="pill-button line small" href="#/mine">내 활동 <Icon name="arrow" size={15} /></a>
    </div>
    {checkins.map(({ p, day }) => <div key={'c' + p.id} className="me-offer checkin" role="note">
      <span className="me-offer-icon" aria-hidden="true"><Glyph name="check" size={18} /></span>
      <span><strong>체크인이 열렸어요 · {hhmm(day.closes)}까지</strong>{p.title} · 현장에서 모집자의 QR을 휴대폰 카메라로 찍어 주세요</span>
      <a className="pill-button green small" href={'#/activity/' + p.activityId}>체크인 방법</a>
    </div>)}
    {offers.map(p => <div key={p.id} className="me-offer" role="note">
      <span className="me-offer-icon" aria-hidden="true"><Glyph name="clock" size={18} /></span>
      <span><strong>빈자리가 생겼어요{p.offerExpiresAt ? ' · ' + deadline(p.offerExpiresAt) + '까지 응답' : ''}</strong>{p.title}</span>
      <a className="pill-button green small" href={'#/activity/' + p.activityId}>제안 확인</a>
    </div>)}
  </section>
}

function deadline(value: string) {
  const [date, time] = value.split('T')
  return (date === seoulToday() ? '오늘' : shortDate(date)) + ' ' + time
}

/** Nearby 1365 programs. Needs the viewer's position (asked once, never stored); hidden when 1365 is not connected. */
function Nearby1365() {
  const [state, setState] = useState<'ask' | 'locating' | 'off' | 'ready' | 'none' | 'failed'>(remembered() ? 'locating' : 'ask')
  const [programs, setPrograms] = useState<Program[]>([])
  async function load() {
    setState('locating')
    const at = await currentPosition()
    if (!at) { remember(false); setState('ask'); return }
    remember(true)
    const params = new URLSearchParams({ lat: at.lat.toFixed(6), lng: at.lng.toFixed(6), radiusKm: '20', recruiting: 'true' })
    api<{ enabled: boolean; items: Program[] }>('/api/volunteer-programs?' + params)
      .then(result => {
        if (!result.enabled) { setState('off'); return }
        const near = [...result.items].sort((a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99)).slice(0, 3)
        setPrograms(near)
        setState(near.length ? 'ready' : 'none')
      })
      .catch(() => setState('failed'))
  }
  useEffect(() => { if (remembered()) load() }, [])
  if (state === 'off') return null
  return <section className="home-block" aria-labelledby="home-1365">
    <div className="home-block-head"><div><h2 id="home-1365">1365와 함께하는 봉사활동</h2><p>내 근처 1365 공식 봉사활동 · 신청은 1365에서 해요</p></div><a className="home-more" href="#/explore">1365 활동 더 보기 <Icon name="outward" size={15} /></a></div>
    {state === 'ready' ? <div className="v1365-row">{programs.map(p => <a key={p.programNo} className="v1365" href={p.link} target="_blank" rel="noopener noreferrer">
      <span className="v1365-top"><span className="badge-1365">1365</span>{p.distanceKm != null && <span>{p.distanceKm < 1 ? Math.round(p.distanceKm * 1000) + 'm' : p.distanceKm.toFixed(1) + 'km'}</span>}</span>
      <strong>{p.title}</strong>
      <small>{when1365(p) || '일정은 1365에서 확인'}</small>
      <small>{[p.organization ?? p.place, p.capacity ? '모집 ' + p.capacity + '명' : null].filter(Boolean).join(' · ')}</small>
      <span className="v1365-go">1365에서 신청 <Glyph name="external" size={14} /></span>
    </a>)}</div>
      : state === 'ask' ? <div className="home-empty"><Glyph name="pin" size={24} /><p>위치를 허락하면 내 근처 1365 활동을 보여 드려요. 위치는 저장하지 않아요.</p><button className="pill-button dark small" onClick={load}>내 위치로 찾기</button></div>
        : state === 'locating' ? <div className="home-empty" role="status">근처 1365 활동을 찾는 중입니다.</div>
          : state === 'none' ? <div className="home-empty"><p>20km 안에 모집 중인 1365 활동이 없어요.</p></div>
            : <div className="home-empty" role="alert"><p>1365 활동을 불러오지 못했어요.</p><button className="pill-button line small" onClick={load}>다시 불러오기</button></div>}
  </section>
}

/** Activities the viewer cancelled, kept apart, with a way back in while that is still allowed. */
function Cancelled({ items }: { items: MyParticipation[] }) {
  const [rows, setRows] = useState<{ item: MyParticipation; full: boolean; again: boolean }[]>([])
  const ids = items.map(p => p.activityId).join(',')
  useEffect(() => {
    let current = true
    // Only a few rows; each detail answer says whether another try is allowed and whether it would join the waitlist.
    Promise.all(items.slice(0, 3).map(item => api<ViewerInfo & { capacity?: number }>('/api/activities/' + item.activityId + '/my-participation')
      .then(v => api<LiveActivity>('/api/activities/' + item.activityId).then(a => ({ item, full: v.confirmed + v.offered >= a.capacity, again: (v.participation?.cancelCount ?? 0) < 2 && a.status === 'RECRUITING' })))
      .catch(() => null)))
      .then(list => { if (current) setRows(list.filter((r): r is { item: MyParticipation; full: boolean; again: boolean } => r != null && r.again)) })
    return () => { current = false }
  }, [ids])
  if (!rows.length) return null
  return <section className="home-block" aria-labelledby="home-cancelled">
    <div className="home-block-head"><div><h2 id="home-cancelled">취소한 일정이 있어요</h2><p>마음이 바뀌었다면 한 번 더 신청할 수 있어요</p></div></div>
    <ul className="cancelled-list">{rows.map(({ item, full }) => <li key={item.id}>
      <DateChip date={item.date} />
      <span className="cancelled-main"><strong>{item.title}</strong><small>{item.startTime}{item.placeName ? ' · ' + item.placeName : ''}{full ? ' · 정원 마감' : ''}</small></span>
      <span className="status-chip muted">신청 취소함</span>
      <a className="pill-button line small" href={'#/activity/' + item.activityId}><Glyph name="refresh" size={15} />{full ? '다시 대기 신청' : '다시 신청'}</a>
    </li>)}</ul>
  </section>
}
