import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { DisplayCatalog as Catalog } from './data'
import { signupRules, validateSignup } from './rules'
import type { Errors } from './rules'
import { api, ApiError, login, logout, preview, refresh } from './api'
import type { Applicant, AppNotification, LiveActivity, MyParticipation, Participation, PlaceInfo, User, ViewerInfo } from './api'
import { kakaoEnabled, PlaceMap } from './map'
import CreateActivity from './create'
import { SupplyChips } from './icons'
import type { Supply } from './icons'
import Explore from './explore'
import Home from './home'

type IconName = 'home' | 'leaf' | 'compass' | 'plus' | 'list' | 'arrow' | 'pin' | 'clock' | 'users' | 'building' | 'shield' | 'bell'

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    leaf: <><path d="M19 3c-11 0-16 7-12 12s13 1 12-12Z" /><path d="m4 21 10-12" /></>,
    compass: <><circle cx="12" cy="12" r="9" /><path d="m16 8-3 5-5 3 3-5 5-3Z" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    list: <path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1" />,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5" /></>,
    building: <><path d="M5 21V3h14v18M3 21h18M10 21v-4h4v4M9 7h1m4 0h1M9 11h1m4 0h1" /></>,
    home: <><path d="m3 11 9-7 9 7" /><path d="M5 10v10h14V10M10 20v-5h4v5" /></>,
    shield: <><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6Z" /><path d="m9 12 2 2 4-4" /></>,
    bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4Z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export function ParkArt({ variant = 0 }: { variant?: number }) {
  const colors = [['#e1ebdc', '#69917d', '#395f47'], ['#e8e2cd', '#a2ac72', '#677449'], ['#e0e8e8', '#89aaa2', '#4b716a']][variant % 3]
  return <svg viewBox="0 0 520 240" role="img" aria-label="공공장소에서 함께하는 봉사활동 일러스트">
    <rect width="520" height="240" fill={colors[0]} /><circle cx="418" cy="56" r="28" fill="#f7edb9" />
    <path d="M0 153Q110 84 245 145T520 132V240H0Z" fill={colors[1]} opacity=".3" /><path d="M0 195Q100 152 220 183T520 167V240H0Z" fill={colors[1]} opacity=".4" />
    <path d="M280 240Q205 207 278 177T290 118" fill="none" stroke="#f4f1e1" strokeWidth="29" />
    {[70, 145, 399, 462].map((x, i) => <g key={x} transform={`translate(${x} ${i % 2 ? 64 : 88})`}><path d="M0 45v69" stroke={colors[2]} strokeWidth="5" /><ellipse cy="25" rx={i % 2 ? 29 : 36} ry="41" fill={colors[2]} /><path d="M0 20v35M0 36l-13-12m13 23 13-12" stroke={colors[1]} strokeWidth="2" /></g>)}
    <g transform="translate(223 133)"><circle cx="0" cy="0" r="8" fill="#d39c78" /><path d="M-7 11 6 10 14 42h-24Z" fill="#e7ad69" /><path d="m-3 42-5 28m18-28 9 25M7 16l17 17" stroke="#345c4c" strokeWidth="6" strokeLinecap="round" /><path d="m24 33 13 23" stroke="#395f47" strokeWidth="2" /><path d="m25 54 15-3-1 17-11 2Z" fill="#faf7ed" /></g>
    <g transform="translate(325 156)"><circle r="8" fill="#dfb08c" /><path d="M-8 10H7l5 32h-22Z" fill="#426956" /><path d="m-5 42-3 23m17-23 7 23M-7 15l-15 17" stroke="#365446" strokeWidth="6" strokeLinecap="round" /></g>
    <g stroke={colors[2]} strokeWidth="2" opacity=".7"><path d="m25 218 4-8 5 8m73 11 3-9 4 9m337-12 4-8 5 8" /></g>
  </svg>
}


type Page = 'home' | 'explore' | 'detail' | 'live' | 'edit' | 'create' | 'mine' | 'login' | 'signup' | 'admin' | 'notifications'
type Route = { page: Page; activityId?: number }
type MemberType = 'general' | 'institution'
const embeddedCatalog = window.__VOLINK_UI_DEMO__?.catalog
export const categories = ['환경 정화', '생활 지원', '지역 돌봄']

function getRoute(): Route {
  const path = window.location.hash.replace(/^#\/?/, '')
  const example = /^activities\/(\d+)$/.exec(path)
  if (example) return { page: 'detail', activityId: Number(example[1]) }
  const live = /^activity\/(\d+)$/.exec(path)
  if (live) return { page: 'live', activityId: Number(live[1]) }
  const edit = /^activity\/(\d+)\/edit$/.exec(path)
  if (edit) return { page: 'edit', activityId: Number(edit[1]) }
  return { page: ['explore', 'create', 'mine', 'login', 'signup', 'admin', 'notifications'].includes(path) ? path as Page : 'home' }
}

// One card shape for example templates and real (saved) activities.
export type CardItem = {
  key: string; kind: 'example' | 'live'; id: number; title: string; category: string; activityType: string
  placeId: number | null; placeName: string; date: string; startTime: string; durationMinutes: number
  confirmed: number; capacity: number; href: string; organizationName?: string | null; distanceKm?: number
}

export function fromLive(activity: LiveActivity): CardItem {
  return { ...activity, key: 'live-' + activity.id, kind: 'live', placeName: (activity.placeName ?? '장소 미정') + (activity.meetingPoint ? ' · ' + activity.meetingPoint : ''), href: '#/activity/' + activity.id }
}

export default function App() {
  const [route, setRoute] = useState<Route>(getRoute)
  const [catalog, setCatalog] = useState<Catalog | null>(embeddedCatalog ?? null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(preview)
  const [serverPlaces, setServerPlaces] = useState<PlaceInfo[] | null>(null)
  const places = useMemo<PlaceInfo[]>(() => serverPlaces ?? (catalog?.places ?? []).map(place => ({ ...place, latitude: null, longitude: null })), [serverPlaces, catalog])
  const reloadPlaces = useCallback(() => { if (!preview) api<PlaceInfo[]>('/api/places').then(setServerPlaces).catch(() => setServerPlaces(null)) }, [])
  useEffect(reloadPlaces, [reloadPlaces])

  useEffect(() => {
    const navigate = () => { setRoute(getRoute()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])

  // Restore the login after a reload through the HttpOnly refresh cookie.
  useEffect(() => {
    if (preview) return
    refresh().then(setUser).catch(() => setUser(null)).finally(() => setReady(true))
  }, [])

  useEffect(() => {
    if (embeddedCatalog) return
    const controller = new AbortController()
    setError('')
    fetch('/api/demo/catalog', { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Catalog unavailable')
        return response.json()
      })
      .then(setCatalog)
      .catch((cause: Error) => {
        if (cause.name !== 'AbortError') { setCatalog(null); setError('활동 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.') }
      })
    return () => controller.abort()
  }, [reload])

  // In-app notifications only: the unread count is polled every 30 seconds while logged in (no push).
  const [unread, setUnread] = useState(0)
  const pollUnread = useCallback(() => { if (user) api<{ unread: number }>('/api/me/notifications?unread=true').then(data => setUnread(data.unread)).catch(() => {}) }, [user])
  useEffect(() => {
    if (!user) { setUnread(0); return }
    pollUnread()
    const timer = window.setInterval(pollUnread, 30_000)
    return () => window.clearInterval(timer)
  }, [user, pollUnread, route])

  async function signOut() {
    await logout()
    setUser(null)
    window.location.hash = '#/home'
  }

  const navigation: { id: Page; title: string; icon: IconName }[] = [
    { id: 'home', title: '홈', icon: 'home' },
    { id: 'explore', title: '활동 찾기', icon: 'compass' },
    { id: 'create', title: '활동 만들기', icon: 'plus' },
    { id: 'mine', title: '내 활동', icon: 'users' },
    ...(user?.role === 'ADMIN' ? [{ id: 'admin' as Page, title: '관리', icon: 'shield' as IconName }] : []),
  ]
  const titles: Record<Page, string> = { home: '홈', explore: '활동 찾기', detail: '활동 상세', live: '활동 상세', edit: '활동 수정', create: '활동 만들기', mine: '내 활동', login: '로그인', signup: '회원가입', admin: '관리', notifications: '알림' }
  const example = catalog?.activities.find(item => item.id === route.activityId)

  const accountNav = user
    ? <nav className="account-links" aria-label="계정 메뉴">
      <a href="#/notifications" className="bell-link" aria-current={route.page === 'notifications' ? 'page' : undefined} aria-label={'알림' + (unread ? ' ' + unread + '개 안 읽음' : '')}><Icon name="bell" size={21} />{unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}</a>
      <a href="#/mine" className="user-name">{user.name}님</a>
      <button className="secondary-button" onClick={signOut}>로그아웃</button></nav>
    : <nav className="account-links" aria-label="계정 메뉴"><a href="#/login" aria-current={route.page === 'login' ? 'page' : undefined}>로그인</a><a href="#/signup" className="secondary-button" aria-current={route.page === 'signup' ? 'page' : undefined}>회원가입</a></nav>

  return <div className="app-shell">
    <header className="site-header">
      <div className="header-inner">
        <a href="#/home" className="brand" aria-label="Volink 홈"><span className="brand-mark"><Icon name="leaf" size={19} /></span>volink<span className="brand-dot">.</span></a>
        {/* One menu: a top bar on wide screens, a bottom tab bar on phones (CSS only). */}
        <nav aria-label="주요 메뉴" className="main-nav">{navigation.map(item => {
          const active = route.page === item.id || ((route.page === 'detail' || route.page === 'live') && item.id === 'explore') || (route.page === 'edit' && item.id === 'create')
          return <a href={'#/' + item.id} key={item.id} className={'nav-item' + (active ? ' active' : '')} aria-current={active ? 'page' : undefined}><Icon name={item.icon} />{item.title}</a>
        })}</nav>
        {accountNav}
      </div>
    </header>
    <main id="main-content" aria-label={titles[route.page]}>
      {error && <div className="error-banner" role="alert">{error}<button className="text-button" onClick={() => setReload(value => value + 1)}>다시 시도</button></div>}
      {route.page === 'home' && <Home user={user} catalog={catalog} />}
      {route.page === 'explore' && <Explore catalog={catalog} />}
      {route.page === 'detail' && (example && catalog ? <ExampleDetail activity={fromExample(example, catalog.baseDate)} description={example.description} /> : catalog ? <NotFound /> : <div className="loading-state" role="status">활동 정보를 불러오는 중입니다.</div>)}
      {route.page === 'live' && route.activityId && <LiveDetail key={route.activityId} id={route.activityId} ready={ready} user={user} onChange={pollUnread} />}
      {route.page === 'notifications' && <Notifications user={user} ready={ready} onChange={pollUnread} />}
      {route.page === 'create' && <CreateActivity user={user} ready={ready} />}
      {route.page === 'edit' && route.activityId && <CreateActivity key={'edit-' + route.activityId} user={user} ready={ready} editId={route.activityId} />}
      {route.page === 'mine' && <MyActivities user={user} ready={ready} />}
      {route.page === 'admin' && <AdminPage user={user} ready={ready} places={places} onPlacesChanged={reloadPlaces} />}
      {(route.page === 'login' || route.page === 'signup') && <AccountForm key={route.page} signup={route.page === 'signup'} onSession={setUser} />}
    </main>
    <footer className="footer"><div className="footer-inner"><span><strong>Volink</strong> · 우리 동네의 작은 변화</span><p>{preview ? '화면 미리보기 · 예시 활동이며 실제 신청·로그인은 제공하지 않습니다.' : '예시 활동은 실제 모집이 아닙니다. 신청·확정 안내는 화면 안 알림으로만 드리며 연락처는 공개하지 않습니다.'}<br />활동 기록은 공식 봉사실적으로 인정되지 않으며 자원봉사 종합보험이 적용되지 않습니다.</p></div></footer>
  </div>
}

function NotFound() {
  return <section className="empty-state"><span className="empty-icon"><Icon name="compass" size={28} /></span><h1>활동을 찾을 수 없습니다</h1><p>삭제되었거나 아직 공개되지 않은 활동일 수 있어요.</p><a className="secondary-button" href="#/explore">활동 목록으로</a></section>
}

export function PageHeading({ title, description }: { title: string; description: string }) {
  return <div className="page-heading"><h1>{title}</h1><p>{description}</p></div>
}

export function fromExample(activity: Catalog['activities'][number], baseDate: string): CardItem {
  return { ...activity, key: 'example-' + activity.id, kind: 'example', date: baseDate, href: '#/activities/' + activity.id }
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value + 'T12:00:00+09:00'))
}

function typeLabel(activity: { activityType: string }) {
  return activity.activityType === 'INSTITUTION' ? '기관 주관 활동' : '자율 활동'
}

// Errors sit inside the label for layout; aria-hidden keeps them out of the field name, aria-describedby still reads them.
function FieldError({ name, errors }: { name: string; errors: Errors }) {
  return errors[name] ? <span id={name + '-error'} className="field-error" aria-hidden="true">{errors[name]}</span> : null
}

function invalid(name: string, errors: Errors) {
  return errors[name] ? { 'aria-invalid': true, 'aria-describedby': name + '-error' } : {}
}

function focusFirstError(form: HTMLFormElement, errors: Errors) {
  const first = Object.keys(errors)[0]
  if (first) (form.querySelector(`[name="${first}"]`) as HTMLElement | null)?.focus()
}

export function ActivityCard({ item }: { item: CardItem }) {
  return <article className="activity-card" data-kind={item.kind}>
    <div className="card-art"><ParkArt variant={item.id - 1} /><span className={'card-label' + (item.kind === 'live' ? ' live' : '')}>{item.kind === 'live' ? '모집 중' : '예시 활동'}</span><span className="duration-tag"><Icon name="clock" size={13} />{item.durationMinutes}분</span></div>
    <div className="card-body"><span className="category-label">{item.category} · {typeLabel(item)}</span><h3>{item.title}</h3><p className="card-location"><Icon name="pin" size={15} />{item.placeName}{item.distanceKm != null && <span className="distance">{item.distanceKm}km</span>}</p><p className="card-date"><Icon name="clock" size={15} />{dateLabel(item.date)} · {item.startTime}</p><div className="card-divider" /><div className="card-bottom"><div className="participant-count"><Icon name="users" size={16} /><strong>{item.confirmed}</strong><span>/ {item.capacity}명</span><SeatBar confirmed={item.confirmed} capacity={item.capacity} /></div><a className="card-detail" href={item.href} aria-label={item.title + ' 상세 보기'}>상세 보기 <Icon name="arrow" size={15} /></a></div></div>
  </article>
}

/** Filled share of the seats (real confirmed / capacity). */
function SeatBar({ confirmed, capacity }: { confirmed: number; capacity: number }) {
  const share = capacity > 0 ? Math.min(100, Math.round(confirmed / capacity * 100)) : 0
  return <span className={'seat-bar' + (share >= 100 ? ' full' : '')} aria-hidden="true"><i style={{ width: share + '%' }} /></span>
}

function DetailView({ item, description, badge, note, supplies = [], children, action, extra }: { item: CardItem; description: string; badge: string; note: string; supplies?: Supply[]; children?: ReactNode; action?: ReactNode; extra?: ReactNode }) {
  // With a live application box the seats are shown there (확정 · 대기 · 제안), so they are not repeated in the facts.
  const seatsInAction = action != null && item.kind === 'live'
  return <>
    <a href="#/explore" className="back-link">← 활동 목록으로</a>
    <div className="detail-layout">
      <article className="detail-content">
        <header className="detail-head">
          <div className="detail-tags"><span className="outline-badge">{badge}</span><span>{item.category} · {typeLabel(item)}{item.organizationName ? ' · ' + item.organizationName : ''}</span></div>
          <h1>{item.title}</h1>
          <p className="detail-facts"><span><Icon name="clock" size={17} />{dateLabel(item.date)} · {item.startTime} · {item.durationMinutes}분</span><span><Icon name="pin" size={17} />{item.placeName}</span></p>
        </header>
        {children}
        <div className="detail-art"><ParkArt variant={item.id - 1} /></div>
        <h2>활동 소개</h2>
        <p className="detail-description">{description}</p>
        <h2>참여 순서</h2>
        <ol className="participation-steps"><li>참가 신청</li><li>승인 또는 대기</li><li>현장 출석</li><li>활동 완료</li></ol>
        <p className="small-print detail-note">{note}</p>
      </article>
      <aside className="panel detail-booking" aria-label="활동 정보와 신청">
        <h2>활동 정보</h2>
        <dl><div><dt><Icon name="pin" size={16} />장소</dt><dd>{item.placeName}</dd></div><div><dt><Icon name="clock" size={16} />일시</dt><dd>{dateLabel(item.date)} · {item.startTime}</dd></div><div><dt><Icon name="clock" size={16} />활동 시간</dt><dd>{item.durationMinutes}분</dd></div>{!seatsInAction && <div><dt><Icon name="users" size={16} />참여 인원</dt><dd>{item.confirmed} / {item.capacity}명</dd></div>}</dl>
        {supplies.length > 0 && <div className="supply-block">{supplies.some(s => !s.provided) && <><h3>챙겨 올 것</h3><SupplyChips supplies={supplies.filter(s => !s.provided)} /></>}{supplies.some(s => s.provided) && <><h3>모집자가 준비해요</h3><SupplyChips supplies={supplies.filter(s => s.provided)} /></>}</div>}
        {action ?? <button disabled className="primary-button">참가 신청 · 준비 중</button>}
        <p className="small-print">위험한 물건은 직접 처리하지 않습니다. 사고가 나면 먼저 119에 신고해 주세요.</p>
      </aside>
    </div>
    {extra}
  </>
}

function ExampleDetail({ activity, description }: { activity: CardItem; description: string }) {
  return <DetailView item={activity} description={description} badge="예시 활동" note="예시 활동은 참가 신청을 받지 않습니다. 장소와 일정은 예시입니다." action={<button disabled className="primary-button">예시 활동은 신청을 받지 않습니다</button>} />
}

function LiveDetail({ id, ready, user, onChange }: { id: number; ready: boolean; user: User | null; onChange: () => void }) {
  const [activity, setActivity] = useState<LiveActivity | null>(null)
  const [missing, setMissing] = useState(false)
  const [viewer, setViewer] = useState<ViewerInfo | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const loadViewer = useCallback(() => api<ViewerInfo>('/api/activities/' + id + '/my-participation').then(setViewer).catch(() => setViewer(null)), [id])
  useEffect(() => {
    if (!ready) return
    api<LiveActivity>('/api/activities/' + id).then(setActivity).catch(() => setMissing(true))
    loadViewer()
  }, [id, ready, user, loadViewer])
  if (missing || preview) return <NotFound />
  if (!activity) return <div className="loading-state" role="status">활동 정보를 불러오는 중입니다.</div>

  async function act(path: string, done: string) {
    setBusy(true)
    try {
      const next = await api<ViewerInfo>(path, 'POST', {})
      setViewer(next)
      setMessage(done)
      onChange()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '처리하지 못했습니다.')
      loadViewer()
    } finally {
      setBusy(false)
    }
  }

  const hidden = activity.status !== 'RECRUITING'
  const organizer = user != null && activity.organizerId === user.id
  const seats = viewer ?? { confirmed: activity.confirmed, offered: 0, waiting: 0, pending: 0, participation: null }
  const full = seats.confirmed + seats.offered >= activity.capacity
  const mine = seats.participation
  const item = { ...fromLive(activity), confirmed: seats.confirmed }
  const share = (n: number) => activity.capacity > 0 ? Math.min(100, n / activity.capacity * 100) + '%' : '0%'
  const help = statusHelp(mine, full, seats.waiting, user != null && !organizer && user.role !== 'ADMIN' && !hidden)
  const action = <div className="apply-box">
    <div className="seat-meter">
      <p className="seat-line">확정 {seats.confirmed} / {activity.capacity}명{seats.offered ? ' · 제안 중 ' + seats.offered : ''}{seats.waiting ? ' · 대기 ' + seats.waiting + '명' : ''}</p>
      <span className="bar" aria-hidden="true"><i style={{ width: share(seats.confirmed) }} /><i className="offer" style={{ width: share(seats.offered) }} /></span>
      <small>{full ? (mine || organizer ? '정원이 찼어요.' : '정원이 찼어요. 지금 신청하면 대기 순번을 받아요.') : `${Math.max(0, activity.capacity - seats.confirmed - seats.offered)}자리 남았어요`}</small>
    </div>
    {mine && <p className={'my-status ' + mine.status.toLowerCase()}>{participationLabel(mine)}</p>}
    {mine?.status === 'OFFERED' && mine.offerExpiresAt && <p className="status-help urgent">{offerDeadline(mine.offerExpiresAt)}까지 수락하지 않으면 다음 대기자에게 넘어갑니다.</p>}
    {help && <p className="status-help">{help}</p>}
    <ApplyButtons activity={activity} user={user} ready={ready} organizer={organizer} full={full} mine={mine} busy={busy || hidden} act={act} />
    {message && <p className="inline-notice" role="status">{message}</p>}
  </div>
  return <DetailView item={item} description={activity.description} badge={hidden ? statusLabel(activity.status) : '모집 중'} supplies={activity.supplies}
    note={'개설: ' + activity.organizerName + ' · 신청·확정 안내는 화면 안 알림으로 드립니다. 연락처는 공개하지 않습니다.'} action={action}
    extra={organizer && <Applicants activityId={activity.id} onChange={() => { loadViewer(); onChange() }} />}>
    {hidden && <p className="inline-notice">아직 공개되지 않은 활동입니다. 개설한 사람과 관리자만 볼 수 있습니다.</p>}
    {activity.applicants !== undefined && ['RECRUITING', 'DRAFT'].includes(activity.status) && <OwnerTools activity={activity} />}
  </DetailView>
}

/** What happens next for the viewer, from the real application state only. */
function statusHelp(mine: Participation | null, full: boolean, waiting: number, canApply: boolean) {
  switch (mine?.status) {
    case 'APPLIED': return '모집자가 확인하면 화면 안 알림으로 알려 드려요.'
    case 'CONFIRMED': return '참가가 확정됐어요. 시작 시각에 만나는 곳으로 와 주세요. 못 오게 되면 미리 취소해 주세요.'
    case 'WAITLISTED': return '빈자리가 생기면 순서대로 자리를 제안해요. 제안이 오면 알림으로 알려 드려요.'
    case 'REJECTED': return '이번 활동에는 함께하지 못해요. 다른 활동을 찾아보세요.'
    case 'EXPIRED': return '응답 시간이 지나 자리가 다음 대기자에게 넘어갔어요.'
    case 'CANCELLED': return (mine.cancelCount ?? 0) >= 2 ? '이 활동은 다시 신청할 수 없어요.' : '취소한 활동은 한 번 더 신청할 수 있어요.'
    case 'OFFERED': return null
  }
  if (!canApply) return null
  return full ? `정원이 차서 대기 신청돼요${waiting ? ` (현재 대기 ${waiting}명)` : ''}. 빈자리가 생기면 순서대로 제안해요.` : '신청하면 모집자가 확인한 뒤 참가가 확정돼요.'
}

function ApplyButtons({ activity, user, ready, organizer, full, mine, busy, act }: { activity: LiveActivity; user: User | null; ready: boolean; organizer: boolean; full: boolean; mine: Participation | null; busy: boolean; act: (path: string, done: string) => void }) {
  if (!user) return ready ? <a className="primary-button" href="#/login">로그인하고 신청하기 <Icon name="arrow" size={17} /></a> : null
  if (organizer) return <p className="small-print">내가 만든 활동입니다. 아래에서 신청자를 확인하세요.</p>
  if (user.role === 'ADMIN') return <button disabled className="primary-button">관리자는 신청할 수 없습니다</button>
  const base = '/api/participations/' + mine?.id
  switch (mine?.status) {
    case 'APPLIED': case 'WAITLISTED': case 'CONFIRMED':
      return <button className="secondary-button" disabled={busy} onClick={() => { if (window.confirm('신청을 취소할까요?' + (mine.status === 'CONFIRMED' ? ' 자리는 대기자에게 넘어갑니다.' : ''))) act(base + '/cancel', '신청을 취소했습니다.') }}>{busy ? '처리 중…' : '신청 취소'}</button>
    case 'OFFERED':
      return <div className="button-row"><button className="primary-button" disabled={busy} onClick={() => act(base + '/accept-offer', '참가가 확정되었습니다.')}>{busy ? '처리 중…' : '자리 수락'}</button><button className="secondary-button" disabled={busy} onClick={() => act(base + '/decline-offer', '자리 제안을 거절했습니다.')}>거절</button></div>
    case 'REJECTED': return null
    case 'CANCELLED': if ((mine.cancelCount ?? 0) >= 2) return null
  }
  return <button className="primary-button" disabled={busy} onClick={() => act('/api/activities/' + activity.id + '/participations', full ? '대기 명단에 올렸습니다.' : '신청했습니다. 모집자가 승인하면 알려 드립니다.')}>{busy ? '처리 중…' : full ? '대기 신청' : '참가 신청'} <Icon name="arrow" size={17} /></button>
}

function participationLabel(item: Pick<Participation, 'status' | 'waitOrder'>) {
  return ({ APPLIED: '승인 대기 중', CONFIRMED: '참가 확정', WAITLISTED: '대기 ' + (item.waitOrder ?? '') + '번', OFFERED: '빈자리 제안 받음', EXPIRED: '제안·대기 만료', CANCELLED: '신청 취소함', REJECTED: '이번에는 함께하지 못해요', CHECKED_IN: '출석 완료', COMPLETED: '활동 완료', NO_SHOW: '불참', HELD: '보류', INVALIDATED: '무효' } as Record<string, string>)[item.status] ?? item.status
}

/** Chip colour for an application state: green done, amber waiting / act now, grey closed. */
function chipTone(status: string) {
  if (status === 'CONFIRMED' || status === 'COMPLETED' || status === 'CHECKED_IN') return 'ok'
  if (status === 'OFFERED') return 'act'
  if (status === 'APPLIED' || status === 'WAITLISTED') return 'wait'
  return 'muted'
}

function offerDeadline(value: string) {
  const [date, time] = value.split('T')
  return dateLabel(date) + ' ' + time
}

function Applicants({ activityId, onChange }: { activityId: number; onChange: () => void }) {
  const [data, setData] = useState<{ capacity: number; confirmed: number; items: Applicant[] } | null>(null)
  const [notice, setNotice] = useState('')
  const [working, setWorking] = useState<number | null>(null)
  const load = useCallback(() => api<{ capacity: number; confirmed: number; items: Applicant[] }>('/api/activities/' + activityId + '/participations').then(setData).catch(() => setData(null)), [activityId])
  useEffect(() => { load() }, [load])
  async function decide(item: Applicant, approve: boolean) {
    setWorking(item.id)
    try {
      await api('/api/participations/' + item.id + (approve ? '/approve' : '/reject'), 'POST', {})
      setNotice(item.name + (approve ? ' 님 참가를 확정했습니다.' : ' 님 신청을 거절했습니다.'))
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '처리하지 못했습니다.')
    }
    setWorking(null)
    load()
    onChange()
  }
  if (!data) return null
  const counts = (status: string) => data.items.filter(item => item.status === status).length
  return <section className="panel applicants" aria-label="신청자 관리">
    <h2>신청자 <span className="count">{data.items.length}</span></h2>
    <div className="applicant-summary"><span className="status-chip ok">확정 {data.confirmed} / {data.capacity}명</span>{counts('APPLIED') > 0 && <span className="status-chip act">승인 대기 {counts('APPLIED')}</span>}{counts('WAITLISTED') > 0 && <span className="status-chip wait">대기 {counts('WAITLISTED')}</span>}{counts('OFFERED') > 0 && <span className="status-chip wait">제안 중 {counts('OFFERED')}</span>}</div>
    <p className="small-print">확정 {data.confirmed} / {data.capacity}명 · 정원이 차면 승인할 수 없고, 확정자가 취소하면 대기 1번에게 자동으로 자리를 제안합니다. 이름 일부만 보이며 연락처는 공개하지 않습니다.</p>
    {notice && <p className="inline-notice" role="status">{notice}</p>}
    {data.items.length === 0 ? <p className="small-print">아직 신청자가 없습니다. 신청이 들어오면 알림으로 알려 드려요.</p> : <ul className="review-list">{data.items.map(item => <li key={item.id} className="applicant-row">
      <div><span className="who"><strong>{item.name}</strong><span className={'status-chip ' + chipTone(item.status)}>{participationLabel(item)}</span></span><span>신청 {item.appliedAt}{item.offerExpiresAt ? ' · ' + offerDeadline(item.offerExpiresAt) + '까지 응답' : ''}</span></div>
      <span />
      <div className="button-row">{item.status === 'APPLIED' && <button className="primary-button small" disabled={working != null} onClick={() => decide(item, true)}>승인</button>}{(item.status === 'APPLIED' || item.status === 'WAITLISTED') && <button className="secondary-button small" disabled={working != null} onClick={() => decide(item, false)}>거절</button>}</div>
    </li>)}</ul>}
  </section>
}

/** Icon and urgency per notification type (types come from the server: APPLICATION_RESULT, WAITLIST_OFFER, ACTIVITY_CHANGED). */
function noticeLook(item: AppNotification): { icon: IconName; urgent: boolean } {
  if (item.type === 'WAITLIST_OFFER') return { icon: 'clock', urgent: item.title.includes('빈자리') }
  if (item.type === 'ACTIVITY_CHANGED') return { icon: 'users', urgent: false }
  return { icon: 'bell', urgent: false }
}

function Notifications({ user, ready, onChange }: { user: User | null; ready: boolean; onChange: () => void }) {
  const [items, setItems] = useState<AppNotification[] | null>(null)
  const [failed, setFailed] = useState(false)
  const load = useCallback(() => api<{ items: AppNotification[] }>('/api/me/notifications').then(data => { setItems(data.items); setFailed(false) }).catch(() => { setItems([]); setFailed(true) }), [])
  useEffect(() => { if (user) load() }, [user, load])
  if (!user) return <><PageHeading title="알림" description="신청 결과와 빈자리 제안을 알려 드립니다." /><LoginRequired ready={ready} text="알림을 보려면 로그인해 주세요." /></>
  async function open(item: AppNotification) {
    if (!item.read) await api('/api/notifications/' + item.id + '/read', 'POST').catch(() => {})
    onChange()
    if (item.link) window.location.hash = item.link
    else load()
  }
  const unread = (items ?? []).filter(item => !item.read)
  const read = (items ?? []).filter(item => item.read)
  const row = (item: AppNotification) => {
    const look = noticeLook(item)
    return <li key={item.id} className={(item.read ? 'read' : 'unread') + (look.urgent ? ' urgent' : '')}><button onClick={() => open(item)}><span className="notice-icon" aria-hidden="true"><Icon name={look.icon} size={19} /></span><strong>{item.title}</strong><span>{item.body}</span><small>{item.createdAt}</small></button></li>
  }
  return <>
    <PageHeading title="알림" description="신청 결과와 빈자리 제안을 화면 안 알림으로 알려 드립니다. 문자·메일은 보내지 않습니다." />
    <section className="panel">
      <div className="button-row notice-actions"><span className="small-print" style={{ margin: 0 }}>{items === null ? '' : unread.length ? `안 읽은 알림 ${unread.length}개` : '모두 읽었어요'}</span>
        <button className="text-button" disabled={!unread.length} onClick={async () => { await api('/api/notifications/read-all', 'POST'); onChange(); load() }}>모두 읽음</button></div>
      {items === null ? <div className="loading-state" role="status">알림을 불러오는 중입니다.</div>
        : failed ? <div className="error-banner" role="alert">알림을 불러오지 못했습니다.<button className="text-button" onClick={load}>다시 시도</button></div>
        : items.length === 0 ? <div className="account-empty"><span className="empty-icon"><Icon name="bell" size={26} /></span><h2>아직 알림이 없어요</h2><p>활동에 신청하면 승인·대기·빈자리 제안을 여기서 알려 드려요.</p><a className="secondary-button" href="#/explore">활동 찾기</a></div>
        : <ul className="notice-list" aria-label="알림 목록">{unread.length > 0 && <li className="notice-group" aria-hidden="true">새 알림</li>}{unread.map(row)}{read.length > 0 && unread.length > 0 && <li className="notice-group" aria-hidden="true">지난 알림</li>}{read.map(row)}</ul>}
    </section>
  </>
}

/** Organizer only: edit, and delete while nobody has applied (the server checks the same). */
function OwnerTools({ activity }: { activity: LiveActivity }) {
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState('')
  const applied = (activity.applicants ?? 0) > 0
  async function remove() {
    try {
      await api('/api/activities/' + activity.id, 'DELETE')
      window.location.hash = '#/mine'
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '삭제하지 못했습니다.')
    }
  }
  return <div className="owner-tools" aria-label="내 활동 관리" role="group">
    <a className="secondary-button small" href={`#/activity/${activity.id}/edit`}>{applied ? '소개·만나는 곳 고치기' : '수정하기'}</a>
    {!applied && (confirming
      ? <><span className="small-print">정말 삭제할까요? 되돌릴 수 없어요.</span><button className="danger-button small" onClick={remove}>삭제</button><button className="text-button" onClick={() => setConfirming(false)}>취소</button></>
      : <button className="secondary-button small" onClick={() => setConfirming(true)}>삭제</button>)}
    {applied && <span className="small-print">신청한 사람이 {activity.applicants}명 있어 일정·장소는 바꿀 수 없고 삭제도 할 수 없어요.</span>}
    {message && <p className="field-error" role="alert">{message}</p>}
  </div>
}

function statusLabel(status: string) {
  return ({ RECRUITING: '공개됨', DRAFT: '관리자 검토 중', CANCELLED: '반려됨', IN_PROGRESS: '진행 중', FINISHED: '종료', HELD: '보류' } as Record<string, string>)[status] ?? status
}

export function LoginRequired({ ready, text }: { ready: boolean; text: string }) {
  if (!ready) return <div className="loading-state" role="status">로그인 상태를 확인하는 중입니다.</div>
  return <section className="panel account-empty"><div className="empty-icon"><Icon name="users" size={31} /></div><h2>로그인이 필요합니다</h2><p>{text}</p><div className="button-row"><a href="#/login" className="primary-button">로그인 <Icon name="arrow" size={17} /></a><a href="#/signup" className="secondary-button">회원가입</a></div></section>
}

const applicationStates = [
  ['신청함', '모집자가 확인하고 있어요'],
  ['참여 확정', '정원 안에서 승인됐어요'],
  ['대기 중', '정원이 차서 순서를 기다려요'],
  ['자리 제안', '빈자리가 생겼어요. 제한 시간 안에 수락해요'],
  ['거절됨', '이번 활동에는 함께하지 못해요'],
]

function MyActivities({ user, ready }: { user: User | null; ready: boolean }) {
  const [tab, setTab] = useState('신청한 활동')
  const [mine, setMine] = useState<LiveActivity[] | null>(null)
  const [applied, setApplied] = useState<MyParticipation[] | null>(null)
  const descriptions: Record<string, string> = { '신청한 활동': '신청한 활동의 승인·대기 상태와 참여 일정을 확인하는 공간입니다.', '개설한 활동': '내가 만든 활동과 공개 상태를 확인하는 공간입니다.', '활동 기록': '출석과 완료가 확인된 활동을 모아 보는 공간입니다. 완료 기록은 7일 안에 이의를 신청할 수 있습니다.' }
  useEffect(() => {
    if (user) api<LiveActivity[]>('/api/me/activities').then(setMine).catch(() => setMine([]))
    if (user) api<MyParticipation[]>('/api/me/participations').then(setApplied).catch(() => setApplied([]))
  }, [user])
  const tabs = <div className="activity-tabs" role="tablist" aria-label="내 활동 구분">{Object.keys(descriptions).map(value => <button key={value} role="tab" id={'tab-' + value} aria-controls="my-activity-panel" aria-selected={tab === value} onClick={() => setTab(value)}>{value}</button>)}</div>
  const states = tab === '신청한 활동' && <section className="panel"><h2>신청 상태 안내</h2><ul className="state-list" aria-label="신청 상태 안내">{applicationStates.map(([name, text]) => <li key={name}><strong>{name}</strong><span>{text}</span></li>)}</ul></section>

  if (preview || !user) return <>
    <PageHeading title="내 활동" description="신청부터 참여, 내가 만든 활동까지 한곳에서." />
    {tabs}
    <section className="panel account-empty" id="my-activity-panel" role="tabpanel" aria-labelledby={'tab-' + tab}><div className="empty-icon"><Icon name="users" size={31} /></div><h2>내 활동을 한곳에서 확인해요</h2><p>{descriptions[tab]}</p><a href="#/login" className="primary-button">로그인 화면으로 <Icon name="arrow" size={17} /></a><p className="small-print">{preview ? '로그인과 개인 활동 내역은 준비 중입니다.' : ready ? '로그인하면 내 활동을 볼 수 있습니다.' : '로그인 상태를 확인하는 중입니다.'}</p></section>
    {states}
  </>

  const organization = user.organization
  // Groups from the real application states: what needs an answer first, then upcoming, in progress, and closed.
  const group = (statuses: string[]) => (applied ?? []).filter(item => statuses.includes(item.status))
  const offers = group(['OFFERED'])
  const upcoming = group(['CONFIRMED', 'CHECKED_IN'])
  const pending = group(['APPLIED', 'WAITLISTED'])
  const closed = group(['REJECTED', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'NO_SHOW', 'HELD', 'INVALIDATED'])
  const row = (item: MyParticipation) => <li key={item.id}>
    <span className={'risk-badge ' + (item.status === 'CONFIRMED' ? 'low' : ['REJECTED', 'CANCELLED', 'EXPIRED'].includes(item.status) ? 'blocked' : 'review')}>{participationLabel(item)}</span>
    <a href={'#/activity/' + item.activityId}><strong>{item.title}</strong></a>
    <span>{dateLabel(item.date)} · {item.startTime} · {item.placeName ?? '장소 미정'}</span>
    {item.status === 'OFFERED' && item.offerExpiresAt && <small>{offerDeadline(item.offerExpiresAt)}까지 수락해 주세요</small>}
    {item.status === 'OFFERED' && <a className="primary-button small go" href={'#/activity/' + item.activityId}>응답하기</a>}
  </li>
  const listGroup = (title: string, items: MyParticipation[]) => items.length > 0 && <div className="list-group"><h3>{title} <span className="count">{items.length}</span></h3><ul className="my-list">{items.map(row)}</ul></div>
  return <>
    <PageHeading title="내 활동" description="신청부터 참여, 내가 만든 활동까지 한곳에서." />
    <section className="panel member-card" aria-label="내 정보">
      <div><strong>{user.name}</strong><span>{user.role === 'ADMIN' ? '관리자' : user.memberType === 'INSTITUTION' ? '기관회원' : '일반회원'} · {user.email}</span></div>
      {user.interests.length > 0 && <div className="tags">{user.interests.map(value => <span key={value}>{value}</span>)}</div>}
      {organization && <p className={'org-status ' + organization.status.toLowerCase()}>{organization.name} · {organization.status === 'APPROVED' ? '기관 확인 완료' : organization.status === 'PENDING' ? '기관 확인 대기 중' : '기관 확인 반려' + (organization.rejectReason ? ' · ' + organization.rejectReason : '')}</p>}
    </section>
    {offers.length > 0 && <section className="panel todo-panel" aria-label="지금 확인할 일"><h2>지금 확인할 일 <span className="count">{offers.length}</span></h2><p className="small-print" style={{ marginTop: 0 }}>빈자리 제안은 정해진 시간 안에 수락해야 참가가 확정돼요.</p><ul className="my-list">{offers.map(row)}</ul></section>}
    {applied && applied.length > 0 && <div className="summary-row" aria-label="신청 현황">
      <div><span>참가 확정</span><strong>{upcoming.length}</strong></div><div><span>승인·대기 중</span><strong>{pending.length}</strong></div><div><span>응답 필요</span><strong>{offers.length}</strong></div><div><span>지난 신청</span><strong>{closed.length}</strong></div></div>}
    {tabs}
    <section className="panel" id="my-activity-panel" role="tabpanel" aria-labelledby={'tab-' + tab}>
      {tab === '개설한 활동'
        ? mine === null ? <div className="loading-state" role="status">만든 활동을 불러오는 중입니다.</div> : mine.length === 0 ? <div className="account-empty"><span className="empty-icon"><Icon name="plus" size={26} /></span><h2>아직 만든 활동이 없어요</h2><p>동네에서 함께하고 싶은 일이 있다면 직접 열어 보세요.</p><a href="#/create" className="primary-button">활동 만들기 <Icon name="arrow" size={17} /></a></div>
          : <ul className="my-list">{mine.map(activity => <li key={activity.id}>
            <span className={'risk-badge ' + (activity.status === 'RECRUITING' ? 'low' : activity.status === 'DRAFT' ? 'review' : 'blocked')}>{statusLabel(activity.status)}</span>
            <a href={'#/activity/' + activity.id}><strong>{activity.title}</strong></a>
            <span>{dateLabel(activity.date)} · {activity.startTime} · {activity.placeName ?? '장소 미정'}</span>
            {activity.status === 'DRAFT' && activity.riskReasons && <small>검토 이유: {activity.riskReasons}</small>}
            {activity.status === 'CANCELLED' && activity.reviewNote && <small>반려 사유: {activity.reviewNote}</small>}
          </li>)}</ul>
        : tab === '신청한 활동'
          ? applied === null ? <div className="loading-state" role="status">신청한 활동을 불러오는 중입니다.</div> : applied.length === 0 ? <div className="account-empty"><span className="empty-icon"><Icon name="compass" size={26} /></span><h2>아직 신청한 활동이 없어요</h2><p>가까운 활동을 찾아 신청하면 승인·대기 상태를 여기서 볼 수 있어요.</p><a href="#/explore" className="primary-button">활동 찾기 <Icon name="arrow" size={17} /></a></div>
            : applied.length === offers.length ? <p className="empty-text">빈자리 제안만 있어요. 위 ‘지금 확인할 일’에서 응답해 주세요.</p>
            : <>{listGroup('다가오는 활동', upcoming)}{listGroup('승인·대기 중', pending)}{listGroup('지난 신청', closed)}</>
          : <div className="account-empty"><span className="empty-icon"><Icon name="leaf" size={26} /></span><h2>활동 기록은 준비 중입니다</h2><p>{descriptions[tab]}</p></div>}
    </section>
    {states}
  </>
}

type PendingOrganization = { id: number; name: string; contact: string; managerName: string; managerEmail: string; requestedAt: string }

function AdminPage({ user, ready, places, onPlacesChanged }: { user: User | null; ready: boolean; places: PlaceInfo[]; onPlacesChanged: () => void }) {
  const [organizations, setOrganizations] = useState<PendingOrganization[]>([])
  const [activities, setActivities] = useState<LiveActivity[]>([])
  const [notice, setNotice] = useState('')
  const load = useCallback(() => {
    api<PendingOrganization[]>('/api/admin/organizations').then(setOrganizations).catch(() => setOrganizations([]))
    api<LiveActivity[]>('/api/admin/activities').then(setActivities).catch(() => setActivities([]))
  }, [])
  useEffect(() => { if (user?.role === 'ADMIN') load() }, [user, load])

  if (!user) return <><PageHeading title="관리" description="기관 확인과 검토가 필요한 활동을 처리합니다." /><LoginRequired ready={ready} text="관리자 계정으로 로그인해 주세요." /></>
  if (user.role !== 'ADMIN') return <section className="empty-state"><span className="empty-icon"><Icon name="shield" size={28} /></span><h1>관리자만 볼 수 있습니다</h1><a className="secondary-button" href="#/explore">활동 목록으로</a></section>

  async function decide(path: string, approve: boolean, reason: string) {
    try {
      await api(path + (approve ? '/approve' : '/reject'), 'POST', { reason })
      setNotice(approve ? '승인했습니다.' : '반려했습니다.')
      load()
    } catch (cause) {
      setNotice(cause instanceof ApiError ? (cause.fieldErrors.reason ?? cause.message) : '처리하지 못했습니다.')
    }
  }

  return <>
    <PageHeading title="관리" description="기관 확인과 검토가 필요한 활동을 처리합니다. 반려할 때는 사유를 꼭 적어 주세요." />
    <nav className="admin-nav" aria-label="관리 바로가기"><a href="#admin-orgs">기관 확인 대기 <span className="count">{organizations.length}</span></a><a href="#admin-activities">검토 대기 활동 <span className="count">{activities.length}</span></a><a href="#admin-places">장소 좌표</a></nav>
    {notice && <p className="inline-notice" role="status">{notice}</p>}
    <section className="panel" aria-label="기관 확인 대기" id="admin-orgs">
      <h2>기관 확인 대기 <span className="count">{organizations.length}</span></h2>
      {organizations.length === 0 ? <p className="small-print">확인을 기다리는 기관이 없습니다.</p>
        : <ul className="review-list">{organizations.map(item => <ReviewItem key={item.id} title={item.name} detail={`담당 ${item.managerName} · ${item.managerEmail} · ${item.contact} · 신청 ${item.requestedAt}`}
          onDecide={(approve, reason) => decide('/api/admin/organizations/' + item.id, approve, reason)} />)}</ul>}
    </section>
    <section className="panel" aria-label="검토 대기 활동" id="admin-activities">
      <h2>검토 대기 활동 <span className="count">{activities.length}</span></h2>
      {activities.length === 0 ? <p className="small-print">검토를 기다리는 활동이 없습니다.</p>
        : <ul className="review-list">{activities.map(item => <ReviewItem key={item.id} title={item.title} href={'#/activity/' + item.id}
          detail={`${item.organizerName} · ${dateLabel(item.date)} ${item.startTime} · ${item.placeName ?? '장소 미정'}`} reasons={item.riskReasons ?? ''}
          onDecide={(approve, reason) => decide('/api/admin/activities/' + item.id, approve, reason)} />)}</ul>}
    </section>
    <section className="panel" aria-label="장소 좌표" id="admin-places">
      <h2>장소 좌표</h2>
      <p className="small-print">카카오맵·네이버 지도에서 만날 지점의 좌표(위도, 경도)를 복사해 붙여넣거나, 지도가 보이면 지도를 눌러 고릅니다. 좌표를 넣어야 거리 검색과 지도에 나옵니다. 현장 이용 허가는 따로 확인해야 합니다.</p>
      <ul className="place-list">{places.map(place => <PlaceEditor key={place.id + ':' + place.latitude + ':' + place.longitude} place={place} onSaved={message => { setNotice(message); onPlacesChanged() }} />)}</ul>
    </section>
  </>
}

function PlaceEditor({ place, onSaved }: { place: PlaceInfo; onSaved: (message: string) => void }) {
  const [coordinate, setCoordinate] = useState(place.latitude != null ? place.latitude + ', ' + place.longitude : '')
  const [meetingPoint, setMeetingPoint] = useState(place.meetingPoint ?? '')
  const [error, setError] = useState('')
  const [picking, setPicking] = useState(false)
  const pick = useCallback((lat: number, lng: number) => setCoordinate(lat.toFixed(6) + ', ' + lng.toFixed(6)), [])

  async function save() {
    const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(coordinate)
    if (!match) { setError('위도, 경도 순서로 붙여넣어 주세요. 예: 37.8, 127.1'); return }
    try {
      await api('/api/admin/places/' + place.id, 'PUT', { latitude: Number(match[1]), longitude: Number(match[2]), meetingPoint })
      setError('')
      onSaved(place.name + ' 좌표를 저장했습니다.')
    } catch (cause) {
      setError(cause instanceof ApiError ? Object.values(cause.fieldErrors).join(' ') || cause.message : '저장하지 못했습니다.')
    }
  }
  const pinned = useMemo(() => {
    const [lat, lng] = coordinate.split(/[,\s]+/).map(Number)
    return Number.isFinite(lat) && Number.isFinite(lng) && coordinate ? [{ id: place.id, name: place.name, latitude: lat, longitude: lng }] : []
  }, [coordinate, place.id, place.name])

  return <li>
    <div><strong>{place.name}</strong><span>{place.area} · {place.latitude != null ? '좌표 입력됨' : '좌표 없음'}</span></div>
    <label className="reason-field">좌표 (위도, 경도)<input aria-label={place.name + ' 좌표'} value={coordinate} onChange={event => setCoordinate(event.target.value)} placeholder="위도, 경도 붙여넣기" aria-invalid={error ? true : undefined} /></label>
    <label className="reason-field">만남 지점<input aria-label={place.name + ' 만남 지점'} value={meetingPoint} maxLength={255} onChange={event => setMeetingPoint(event.target.value)} placeholder="예: 정문 안내판 앞" /></label>
    <div className="button-row">{kakaoEnabled && <button className="secondary-button small" type="button" onClick={() => setPicking(value => !value)}>{picking ? '지도 닫기' : '지도에서 고르기'}</button>}<button className="primary-button small" type="button" onClick={save}>저장</button></div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {picking && <div className="place-picker"><PlaceMap places={pinned} onPick={pick} label={place.name + ' 위치 고르기'} /></div>}
  </li>
}

function ReviewItem({ title, detail, reasons, href, onDecide }: { title: string; detail: string; reasons?: string; href?: string; onDecide: (approve: boolean, reason: string) => Promise<void> | void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const decide = async (approve: boolean) => { setBusy(true); try { await onDecide(approve, reason) } finally { setBusy(false) } }
  return <li>
    <div>{href ? <a href={href}><strong>{title}</strong></a> : <strong>{title}</strong>}<span>{detail}</span>{reasons && <small>검토 이유: {reasons}</small>}</div>
    <label className="reason-field">처리 사유<input aria-label={title + ' 처리 사유'} value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="반려 시 필수" /></label>
    <div className="button-row"><button className="primary-button small" disabled={busy} onClick={() => decide(true)}>승인</button><button className="secondary-button small" disabled={busy} onClick={() => decide(false)}>반려</button></div>
  </li>
}

function AccountForm({ signup, onSession }: { signup: boolean; onSession: (user: User) => void }) {
  const [memberType, setMemberType] = useState<MemberType>('general')
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const found: Errors = signup ? validateSignup(data, memberType === 'institution') : {}
    if (!signup) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.get('email') ?? '').trim())) found.email = '이메일 형식을 확인해 주세요.'
      if (!String(data.get('password') ?? '')) found.password = '비밀번호를 입력해 주세요.'
    }
    setErrors(found)
    if (Object.keys(found).length) { setMessage(''); focusFirstError(form, found); return }
    if (preview) {
      setMessage(signup ? '회원가입은 아직 제공하지 않습니다. 입력한 정보는 전송하거나 저장하지 않았습니다.' : '로그인은 아직 제공하지 않습니다. 입력한 정보는 전송하거나 저장하지 않았습니다.')
      return
    }
    setBusy(true)
    const email = String(data.get('email')).trim()
    const password = String(data.get('password'))
    try {
      if (signup) await api('/api/auth/signup', 'POST', {
        memberType: memberType === 'institution' ? 'INSTITUTION' : 'GENERAL', name: data.get('name'), email, password,
        birthDate: data.get('birthDate'), interests: data.getAll('interests'), organizationName: data.get('organization'),
        organizationContact: data.get('organizationContact'), agreedNotice: Boolean(data.get('notice')),
      })
      onSession(await login(email, password))
      window.location.hash = '#/mine'
    } catch (cause) {
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length) { setErrors(cause.fieldErrors); focusFirstError(form, cause.fieldErrors) }
      else setMessage(cause instanceof Error ? cause.message : '요청을 처리하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  const count = Object.keys(errors).length
  const label = preview ? (signup ? '회원가입 · 준비 중' : '로그인 · 준비 중') : busy ? (signup ? '가입하는 중…' : '로그인하는 중…') : signup ? '가입하기' : '로그인'
  return <div className="account-layout">
    <section className="account-intro"><span className="eyebrow"><span className="tiny-dot" />우리 동네의 작은 변화</span><h1>작은 실천의 시작,<br />함께하는 Volink.</h1><p>가까운 곳에서 이웃과 만나<br />우리 동네에 작은 변화를 더해요.</p><ul className="intro-points"><li><Icon name="pin" size={18} />걸어서 갈 수 있는 동네 활동</li><li><Icon name="clock" size={18} />30분부터, 3시간 이내</li><li><Icon name="shield" size={18} />연락처는 다른 회원에게 공개하지 않아요</li></ul><ParkArt /></section>
    <form className="panel activity-form account-form" noValidate onSubmit={submit} onChange={() => setMessage('')}>
      <h2>{signup ? '회원가입' : '로그인'}</h2><p className="form-description">{signup ? '어떤 모습으로 함께하시겠어요?' : '다시 만나 반가워요.'}</p>
      {signup && <><fieldset className="member-picker"><legend>회원 유형</legend><label className={memberType === 'general' ? 'selected' : ''}><input type="radio" name="memberType" value="general" checked={memberType === 'general'} onChange={() => setMemberType('general')} /><Icon name="users" /><strong>일반회원</strong><span>이웃과 함께 자율 활동</span></label><label className={memberType === 'institution' ? 'selected' : ''}><input type="radio" name="memberType" value="institution" checked={memberType === 'institution'} onChange={() => setMemberType('institution')} /><Icon name="building" /><strong>기관회원</strong><span>기관 확인 후 주관 활동</span></label></fieldset>
        <label>이름<input name="name" autoComplete="name" maxLength={signupRules.nameMax} placeholder="이름을 입력해 주세요" {...invalid('name', errors)} /><FieldError name="name" errors={errors} /></label>
        <label>생년월일 <span className="field-hint">만 {signupRules.minimumAge}세 이상 가입 가능</span><input name="birthDate" type="date" autoComplete="bday" {...invalid('birthDate', errors)} /><FieldError name="birthDate" errors={errors} /></label>
        <fieldset className="interest-picker" {...invalid('interests', errors)}><legend>관심 분야 <span className="field-hint">1–{signupRules.maxInterests}개</span></legend>{categories.map(value => <label key={value}><input type="checkbox" name="interests" value={value} />{value}</label>)}<FieldError name="interests" errors={errors} /></fieldset></>}
      {signup && memberType === 'institution' && <><label>기관명<input name="organization" maxLength={100} placeholder="기관 이름을 입력해 주세요" {...invalid('organization', errors)} /><FieldError name="organization" errors={errors} /></label><label>기관 연락처<input name="organizationContact" type="tel" autoComplete="tel" maxLength={20} placeholder="담당자 연락처" {...invalid('organizationContact', errors)} /><FieldError name="organizationContact" errors={errors} /></label>
        <ol className="org-steps" aria-label="기관 확인 절차"><li><strong>가입 신청</strong><span>기관 정보 제출</span></li><li><strong>확인 대기</strong><span>관리자가 기관을 확인해요</span></li><li><strong>확인 완료</strong><span>기관 주관 활동 개설</span></li></ol>
        <p className="inline-notice">확인 전에는 자율 활동만 열 수 있고, 확인이 반려되면 사유를 알려 드립니다. 기관 연락처는 다른 회원에게 공개하지 않습니다.</p></>}
      <label>이메일<input name="email" type="email" autoComplete={signup ? 'email' : 'username'} maxLength={254} placeholder="이메일을 입력해 주세요" {...invalid('email', errors)} /><FieldError name="email" errors={errors} /></label>
      <label>비밀번호{signup && <span className="field-hint">영문·숫자 포함 {signupRules.passwordMin}–{signupRules.passwordMax}자</span>}<input name="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} maxLength={signupRules.passwordMax} placeholder={signup ? '8자 이상 입력해 주세요' : '비밀번호를 입력해 주세요'} {...invalid('password', errors)} /><FieldError name="password" errors={errors} /></label>
      {signup && <><label>비밀번호 확인<input name="passwordConfirm" type="password" autoComplete="new-password" maxLength={signupRules.passwordMax} placeholder="비밀번호를 다시 입력해 주세요" {...invalid('passwordConfirm', errors)} /><FieldError name="passwordConfirm" errors={errors} /></label><fieldset className="safety-checks" {...invalid('notice', errors)}><legend>이용 안내</legend><label><input type="checkbox" name="notice" value="agreed" />활동 기록은 공식 봉사실적으로 인정되지 않으며 종합보험이 적용되지 않음을 확인합니다.</label><FieldError name="notice" errors={errors} /></fieldset></>}
      {count > 0 && <p className="form-alert" role="alert">입력 내용을 확인해 주세요. 고칠 항목 {count}개</p>}
      <button type="submit" className="primary-button" disabled={busy}>{label}<Icon name="arrow" size={17} /></button>
      {message && <p role="status" className="inline-notice">{message}</p>}
      <p className="small-print">{preview ? '현재는 화면만 확인할 수 있습니다. 실제 개인정보를 입력하지 마세요.' : '비밀번호는 암호화해 저장하며, 연락처는 다른 회원에게 공개하지 않습니다.'}</p>
      <p className="account-switch">{signup ? '이미 계정이 있으신가요?' : '처음 오셨나요?'} <a href={signup ? '#/login' : '#/signup'}>{signup ? '로그인' : '회원가입'}</a></p>
    </form>
  </div>
}
