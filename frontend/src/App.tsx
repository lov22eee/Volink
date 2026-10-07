import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Activity, DisplayCatalog as Catalog } from './data'

type IconName = 'leaf' | 'compass' | 'plus' | 'list' | 'arrow' | 'pin' | 'clock' | 'users' | 'building'

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
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
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function ParkArt({ variant = 0 }: { variant?: number }) {
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

type Page = 'explore' | 'detail' | 'create' | 'mine' | 'login' | 'signup'
type Route = { page: Page; activityId?: number }
type MemberType = 'general' | 'institution'
const embeddedCatalog = window.__VOLINK_UI_DEMO__?.catalog

function getRoute(): Route {
  const path = window.location.hash.replace(/^#\/?/, '')
  const detail = /^activities\/(\d+)$/.exec(path)
  if (detail) return { page: 'detail', activityId: Number(detail[1]) }
  return { page: ['create', 'mine', 'login', 'signup'].includes(path) ? path as Page : 'explore' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(getRoute)
  const [catalog, setCatalog] = useState<Catalog | null>(embeddedCatalog ?? null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const navigate = () => { setRoute(getRoute()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
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

  const navigation: { id: Page; title: string; icon: IconName }[] = [
    { id: 'explore', title: '활동 찾기', icon: 'compass' },
    { id: 'create', title: '활동 만들기', icon: 'plus' },
    { id: 'mine', title: '내 활동', icon: 'users' },
  ]
  const titles: Record<Page, string> = { explore: '활동 찾기', detail: '활동 상세', create: '활동 만들기', mine: '내 활동', login: '로그인', signup: '회원가입' }
  const activity = catalog?.activities.find(item => item.id === route.activityId)

  return <div className="app-shell">
    <aside className="sidebar">
      <a href="#/explore" className="brand" aria-label="Volink 홈"><span className="brand-mark"><Icon name="leaf" size={25} /></span>volink<span className="brand-dot">.</span></a>
      <p className="brand-caption">우리 동네의 작은 변화</p>
      <nav aria-label="주요 메뉴">{navigation.map(item => {
        const active = route.page === item.id || (route.page === 'detail' && item.id === 'explore')
        return <a href={'#/' + item.id} key={item.id} className={'nav-item' + (active ? ' active' : '')} aria-current={active ? 'page' : undefined}><Icon name={item.icon} />{item.title}{active && <span className="nav-dot" />}</a>
      })}</nav>
      <div className="sidebar-bottom"><Icon name="leaf" size={23} /><p>작은 실천이 모여<br />우리 동네를 바꿉니다.</p></div>
    </aside>
    <div className="main-shell">
      <header className="topbar">
        <div className="breadcrumb">Volink <span>/</span> {titles[route.page]}</div>
        <nav className="account-links" aria-label="계정 메뉴"><a href="#/login" aria-current={route.page === 'login' ? 'page' : undefined}>로그인</a><a href="#/signup" className="secondary-button" aria-current={route.page === 'signup' ? 'page' : undefined}>회원가입</a></nav>
      </header>
      <main id="main-content">
        {error && <div className="error-banner" role="alert">{error}<button className="text-button" onClick={() => setReload(value => value + 1)}>다시 시도</button></div>}
        {route.page === 'explore' && <Explore catalog={catalog} />}
        {route.page === 'detail' && (activity && catalog ? <ActivityDetail activity={activity} catalog={catalog} /> : <section className="empty-state"><h1>활동을 찾을 수 없습니다</h1><a className="secondary-button" href="#/explore">활동 목록으로</a></section>)}
        {route.page === 'create' && <CreateActivity catalog={catalog} />}
        {route.page === 'mine' && <MyActivities />}
        {(route.page === 'login' || route.page === 'signup') && <AccountForm key={route.page} signup={route.page === 'signup'} />}
      </main>
      <footer className="footer"><span>© Volink</span><p>화면 미리보기 · 예시 활동이며 실제 신청·로그인은 제공하지 않습니다.<br />활동 기록은 공식 봉사실적으로 인정되지 않으며 자원봉사 종합보험이 적용되지 않습니다.</p></footer>
    </div>
  </div>
}

function PageHeading({ title, description }: { title: string; description: string }) {
  return <div className="page-heading"><h1>{title}</h1><p>{description}</p></div>
}

function Explore({ catalog }: { catalog: Catalog | null }) {
  const [category, setCategory] = useState('전체')
  const [query, setQuery] = useState('')
  const [date, setDate] = useState('')
  const [kind, setKind] = useState('all')
  const [view, setView] = useState('list')
  const activities = catalog?.activities.filter(activity =>
    (category === '전체' || activity.category === category) &&
    (activity.title + ' ' + activity.placeName).includes(query.trim()) &&
    (!date || date === catalog.baseDate) && kind !== 'institution',
  ) ?? []

  return <>
    <section className="hero">
      <div className="hero-copy"><span className="eyebrow"><span className="tiny-dot" />작은 실천, 가까운 연결</span><h1>가까운 곳에서,<br />함께 만드는 <em>변화.</em></h1><p>잠깐의 시간으로 우리 동네를 조금 더 좋게.<br />나와 이웃이 함께할 작은 봉사활동을 만나보세요.</p><button className="primary-button" onClick={() => document.getElementById('activities')?.scrollIntoView()}>주변 활동 살펴보기 <Icon name="arrow" size={18} /></button><span className="hero-note">2–10명 함께 · 3시간 이내</span></div>
      <div className="hero-art"><ParkArt /><div className="floating-note"><span className="floating-icon"><Icon name="leaf" /></span><div><strong>혼자보다, 함께.</strong><span>우리 동네에 변화를 남겨요</span></div></div></div>
    </section>
    <section id="activities" className="activity-section">
      <div className="section-heading"><div><span className="eyebrow">NEAR YOU</span><h2>우리 동네의 작은 실천</h2></div><span className="location-tag"><Icon name="pin" size={16} />양주</span></div>
      <div className="filter-row"><div className="category-tabs" aria-label="활동 분야">{['전체', '환경 정화', '생활 지원', '지역 돌봄'].map(value => <button className={category === value ? 'selected' : ''} key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div><label className="search-box"><Icon name="compass" size={17} /><input aria-label="활동 또는 장소 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="활동이나 장소를 찾아보세요" /></label></div>
      <div className="secondary-filters">
        <label>날짜<input aria-label="활동 날짜로 검색" type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
        <label>활동 유형<select aria-label="활동 유형" value={kind} onChange={event => setKind(event.target.value)}><option value="all">모든 활동</option><option value="general">자율 활동</option><option value="institution">기관 주관 활동</option></select></label>
        {(date || query || category !== '전체' || kind !== 'all') && <button className="text-button" onClick={() => { setDate(''); setQuery(''); setCategory('전체'); setKind('all') }}>필터 초기화</button>}
        <div className="view-toggle"><button aria-label="목록으로 보기" aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name="list" size={17} /></button><button aria-label="지도로 보기" aria-pressed={view === 'map'} onClick={() => setView('map')}><Icon name="pin" size={17} /></button></div>
      </div>
      <div className={view === 'map' ? 'map-list-layout' : undefined}>
        {view === 'map' && <aside className="map-placeholder" aria-label="지도 영역"><Icon name="pin" size={38} /><h3>지도로 만날 우리 동네</h3><p>지도는 준비 중입니다.<br />목록에서 예시 활동을 확인해 주세요.</p></aside>}
        {!catalog ? <div className="empty-state">활동 정보를 불러오는 중입니다.</div> : activities.length ? <div className="activity-grid">{activities.map(activity => <ActivityCard key={activity.id} activity={activity} baseDate={catalog.baseDate} />)}</div> : <div className="empty-state">조건에 맞는 활동이 없습니다. 다른 조건으로 찾아보세요.</div>}
      </div>
    </section>
    <section className="bottom-callout"><div className="callout-icon"><Icon name="plus" size={26} /></div><div><h3>내가 먼저, 작은 변화를 시작해 볼까요?</h3><p>이웃과 함께할 작은 활동을 생각해 보세요.</p></div><a href="#/create" className="secondary-button">활동 만들기 <Icon name="arrow" size={17} /></a></section>
  </>
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value + 'T12:00:00+09:00'))
}

function ActivityCard({ activity, baseDate }: { activity: Activity; baseDate: string }) {
  return <article className="activity-card">
    <div className="card-art"><ParkArt variant={activity.id - 1} /><span className="card-label">예시 활동</span><span className="duration-tag"><Icon name="clock" size={13} />{activity.durationMinutes}분</span></div>
    <div className="card-body"><span className="category-label">{activity.category} · 자율 활동</span><h3>{activity.title}</h3><p className="card-location"><Icon name="pin" size={15} />{activity.placeName}</p><p className="card-date"><Icon name="clock" size={15} />{dateLabel(baseDate)} · {activity.startTime}</p><div className="card-divider" /><div className="card-bottom"><div className="participant-count"><Icon name="users" size={16} /><strong>{activity.confirmed}</strong><span>/ {activity.capacity}명</span></div><a className="card-detail" href={'#/activities/' + activity.id} aria-label={activity.title + ' 상세 보기'}>상세 보기 <Icon name="arrow" size={15} /></a></div></div>
  </article>
}

function ActivityDetail({ activity, catalog }: { activity: Activity; catalog: Catalog }) {
  return <>
    <a href="#/explore" className="back-link">← 활동 목록으로</a>
    <div className="detail-layout">
      <article className="panel detail-content"><div className="detail-art"><ParkArt variant={activity.id - 1} /></div><div className="detail-tags"><span className="outline-badge">예시 활동</span><span>{activity.category} · 자율 활동</span></div><h1>{activity.title}</h1><p>{activity.description}</p><h2>함께할 활동</h2><p>짧게 걷고 주변의 가벼운 쓰레기를 정리합니다. 편한 신발과 물을 준비해 주세요. 위험한 물건은 직접 처리하지 않습니다.</p><h2>참여 순서</h2><ol className="participation-steps"><li>참가 신청</li><li>승인 또는 대기</li><li>현장 출석</li><li>활동 완료</li></ol><p className="small-print">예시 활동은 참가 신청을 받지 않습니다.</p></article>
      <aside className="panel detail-booking"><h2>활동 정보</h2><dl><div><dt><Icon name="pin" size={17} />장소</dt><dd>{activity.placeName}</dd></div><div><dt><Icon name="clock" size={17} />일시</dt><dd>{dateLabel(catalog.baseDate)} · {activity.startTime}</dd></div><div><dt><Icon name="clock" size={17} />활동 시간</dt><dd>{activity.durationMinutes}분</dd></div><div><dt><Icon name="users" size={17} />참여 인원</dt><dd>{activity.confirmed} / {activity.capacity}명</dd></div></dl><button disabled className="primary-button">참가 신청 · 준비 중</button><p className="small-print">장소와 일정은 예시입니다. 실제 모집 중인 활동이 아닙니다.</p></aside>
    </div>
  </>
}

function CreateActivity({ catalog }: { catalog: Catalog | null }) {
  const [kind, setKind] = useState<MemberType>('general')
  const [message, setMessage] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('입력 내용을 확인했습니다. 현재는 활동을 등록하거나 저장하지 않습니다.')
  }
  return <>
    <PageHeading title="활동 만들기" description="이웃과 함께할 일과 시간·장소를 알려주세요." />
    <div className="two-column">
      <form className="panel activity-form" onSubmit={submit} onChange={() => setMessage('')}>
        <h2>활동 정보</h2>
        <fieldset className="type-picker"><legend>활동 유형</legend><label><input type="radio" name="kind" checked={kind === 'general'} onChange={() => setKind('general')} />자율 활동</label><label><input type="radio" name="kind" checked={kind === 'institution'} onChange={() => setKind('institution')} />기관 주관 활동</label></fieldset>
        {kind === 'institution' && <p className="inline-notice">기관 주관 활동은 기관 확인이 완료된 기관회원만 개설할 수 있습니다. 현재는 기관 확인과 활동 등록을 제공하지 않습니다.</p>}
        <label>활동 이름<input name="title" required maxLength={100} placeholder="예: 공원에서 함께하는 가벼운 플로깅" /></label>
        <div className="form-row"><label>분야<select name="category"><option>환경 정화</option><option>생활 지원</option><option>지역 돌봄</option></select></label><label>장소<select aria-label="장소" name="place" required defaultValue=""><option value="" disabled>장소를 선택해 주세요</option>{catalog?.places.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label></div>
        <div className="form-row"><label>활동 날짜<input type="date" name="date" required /></label><label>시작 시간<input type="time" name="time" required /></label></div>
        <div className="form-row"><label>모집 정원 <span className="field-hint">2–10명</span><input type="number" name="capacity" min="2" max="10" required defaultValue={6} /></label><label>활동 시간 <span className="field-hint">최대 180분</span><input type="number" name="duration" min="1" max="180" required defaultValue={90} /></label></div>
        <label>활동 소개<textarea name="description" required maxLength={2000} rows={4} placeholder="함께할 일과 준비물을 알려주세요." /></label>
        <fieldset className="safety-checks"><legend>안전 안내 확인</legend><label><input type="checkbox" required />공공장소의 주간 저위험 활동으로 기획합니다.</label><label><input type="checkbox" required />공식 봉사실적과 종합보험이 적용되지 않음을 이해합니다.</label></fieldset>
        <button className="primary-button" type="submit" disabled={kind === 'institution'}>입력 내용 확인 <Icon name="arrow" size={17} /></button>
        {message && <p role="status" className="success-message">{message}</p>}
        <p className="small-print">현재는 입력 항목을 확인할 수 있으며 실제 활동 등록은 준비 중입니다.</p>
      </form>
      <aside className="form-aside"><div className="panel"><h2>함께하기 좋은<br />작은 활동의 기준</h2><ul className="feature-list"><li><Icon name="users" />2–10명의 작은 모임</li><li><Icon name="clock" />3시간 이내의 짧은 활동</li><li><Icon name="pin" />확인 가능한 공공장소</li><li><Icon name="leaf" />주간·저위험 활동 우선</li></ul></div><div className="help-card"><h3>안전하게 함께해요</h3><p>위험한 도구나 작업을 피하고 누구나 부담 없이 함께할 수 있는 활동을 계획해 주세요.</p></div></aside>
    </div>
  </>
}

function MyActivities() {
  const [tab, setTab] = useState('신청한 활동')
  const descriptions: Record<string, string> = { '신청한 활동': '신청한 활동의 승인·대기 상태와 참여 일정을 확인하는 공간입니다.', '개설한 활동': '내가 만든 활동과 참가자 현황을 확인하는 공간입니다.', '활동 기록': '출석과 완료가 확인된 활동을 모아 보는 공간입니다.' }
  return <>
    <PageHeading title="내 활동" description="신청부터 참여, 내가 만든 활동까지 한곳에서." />
    <div className="activity-tabs" role="tablist" aria-label="내 활동 구분">{Object.keys(descriptions).map(value => <button key={value} role="tab" id={'tab-' + value} aria-controls="my-activity-panel" aria-selected={tab === value} onClick={() => setTab(value)}>{value}</button>)}</div>
    <section className="panel account-empty" id="my-activity-panel" role="tabpanel" aria-labelledby={'tab-' + tab}><div className="empty-icon"><Icon name="users" size={31} /></div><h2>내 활동을 한곳에서 확인해요</h2><p>{descriptions[tab]}</p><a href="#/login" className="primary-button">로그인 화면으로 <Icon name="arrow" size={17} /></a><p className="small-print">로그인과 개인 활동 내역은 준비 중입니다.</p></section>
  </>
}

function AccountForm({ signup }: { signup: boolean }) {
  const [memberType, setMemberType] = useState<MemberType>('general')
  const [message, setMessage] = useState('')
  const [fieldError, setFieldError] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    if (signup && data.get('password') !== data.get('passwordConfirm')) {
      setFieldError('비밀번호가 일치하지 않습니다.')
      setMessage('')
      return
    }
    setFieldError('')
    setMessage(signup ? '회원가입은 아직 제공하지 않습니다. 입력한 정보는 전송하거나 저장하지 않았습니다.' : '로그인은 아직 제공하지 않습니다. 입력한 정보는 전송하거나 저장하지 않았습니다.')
  }
  return <div className="account-layout">
    <section className="account-intro"><span className="eyebrow">VOLUNTEER TOGETHER</span><h1>작은 실천의 시작,<br />함께하는 Volink.</h1><p>가까운 곳에서 이웃과 만나<br />우리 동네에 작은 변화를 더해요.</p><ParkArt /></section>
    <form className="panel activity-form account-form" onSubmit={submit} onChange={() => { setMessage(''); setFieldError('') }}>
      <h2>{signup ? '회원가입' : '로그인'}</h2><p className="form-description">{signup ? '어떤 모습으로 함께하시겠어요?' : '다시 만나 반가워요.'}</p>
      {signup && <><fieldset className="member-picker"><legend>회원 유형</legend><label className={memberType === 'general' ? 'selected' : ''}><input type="radio" name="memberType" value="general" checked={memberType === 'general'} onChange={() => setMemberType('general')} /><Icon name="users" /><strong>일반회원</strong><span>이웃과 함께 자율 활동</span></label><label className={memberType === 'institution' ? 'selected' : ''}><input type="radio" name="memberType" value="institution" checked={memberType === 'institution'} onChange={() => setMemberType('institution')} /><Icon name="building" /><strong>기관회원</strong><span>기관 확인 후 주관 활동</span></label></fieldset><label>이름<input name="name" autoComplete="name" required maxLength={50} placeholder="이름을 입력해 주세요" /></label></>}
      {signup && memberType === 'institution' && <><label>기관명<input name="organization" required maxLength={100} placeholder="기관 이름을 입력해 주세요" /></label><label>기관 연락처<input name="organizationContact" type="tel" autoComplete="tel" required maxLength={30} placeholder="담당자 연락처" /></label><p className="inline-notice">기관회원은 관리자 확인 후 기관 주관 활동을 개설할 수 있습니다. 기관 가입·확인 기능은 준비 중입니다.</p></>}
      <label>이메일<input name="email" type="email" autoComplete={signup ? 'email' : 'username'} required maxLength={254} placeholder="이메일을 입력해 주세요" /></label>
      <label>비밀번호<input name="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} minLength={signup ? 8 : undefined} maxLength={72} required placeholder={signup ? '8자 이상 입력해 주세요' : '비밀번호를 입력해 주세요'} /></label>
      {signup && <><label>비밀번호 확인<input name="passwordConfirm" type="password" autoComplete="new-password" required maxLength={72} placeholder="비밀번호를 다시 입력해 주세요" aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? 'password-error' : undefined} /></label><fieldset className="safety-checks"><legend>이용 안내</legend><label><input type="checkbox" required />활동 기록은 공식 봉사실적으로 인정되지 않으며 종합보험이 적용되지 않음을 확인합니다.</label></fieldset></>}
      {fieldError && <p id="password-error" className="field-error" role="alert">{fieldError}</p>}
      <button type="submit" className="primary-button">{signup ? '회원가입 · 준비 중' : '로그인 · 준비 중'}<Icon name="arrow" size={17} /></button>
      {message && <p role="status" className="inline-notice">{message}</p>}
      <p className="small-print">현재는 화면만 확인할 수 있습니다. 실제 개인정보를 입력하지 마세요.</p>
      <p className="account-switch">{signup ? '이미 계정이 있으신가요?' : '처음 오셨나요?'} <a href={signup ? '#/login' : '#/signup'}>{signup ? '로그인' : '회원가입'}</a></p>
    </form>
  </div>
}
