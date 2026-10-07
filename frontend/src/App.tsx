import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { roadmap, roleFlows, weekOne } from './data'
import type { Activity, Catalog, ProjectStatus } from './data'

type Page = 'explore' | 'create' | 'flows' | 'progress' | 'presentation'
type IconName = 'leaf' | 'compass' | 'plus' | 'flow' | 'chart' | 'arrow' | 'pin' | 'clock' | 'users' | 'check' | 'close' | 'screen'

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    leaf: <><path d="M19 3c-11 0-16 7-12 12s13 1 12-12Z" /><path d="m4 21 10-12" /></>,
    compass: <><circle cx="12" cy="12" r="9" /><path d="m16 8-3 5-5 3 3-5 5-3Z" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    flow: <><rect x="3" y="3" width="7" height="6" rx="1" /><rect x="14" y="15" width="7" height="6" rx="1" /><path d="M6 9v9h8M10 6h8v9" /></>,
    chart: <><path d="M4 3v17h17M8 15v-4m5 4V6m5 9V9" /></>,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    screen: <><rect x="3" y="3" width="18" height="13" rx="2" /><path d="M12 16v5m-5 0h10" /></>,
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

function getPage(): Page {
  const value = window.location.hash.replace('#/', '')
  return ['explore', 'create', 'flows', 'progress', 'presentation'].includes(value) ? value as Page : 'explore'
}

export default function App() {
  const [page, setPage] = useState<Page>(getPage)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [status, setStatus] = useState<ProjectStatus | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Activity | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const navigate = () => { setPage(getPage()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    const request = async (path: string) => {
      const response = await fetch(path, { signal: controller.signal })
      if (!response.ok) throw new Error(`API 응답 ${response.status}`)
      return response.json()
    }
    Promise.all([request('/api/demo/catalog'), request('/api/project/status')])
      .then(([data, health]) => { setCatalog(data); setStatus(health) })
      .catch((cause: Error) => {
        if (cause.name !== 'AbortError') { setCatalog(null); setStatus(null); setError('서버에 연결할 수 없습니다. 백엔드와 MySQL 실행 상태를 확인해 주세요.') }
      })
    return () => controller.abort()
  }, [reload])

  const navigation: { id: Page; title: string; icon: IconName }[] = [
    { id: 'explore', title: '활동 둘러보기', icon: 'compass' },
    { id: 'create', title: '활동 만들기', icon: 'plus' },
    { id: 'flows', title: '사용자 흐름', icon: 'flow' },
    { id: 'progress', title: '개발 진행 현황', icon: 'chart' },
  ]
  const isPresentation = page === 'presentation'

  return <div className={`app-shell ${isPresentation ? 'presenting' : ''}`}>
    {!isPresentation && <aside className="sidebar">
      <a href="#/explore" className="brand" aria-label="Volink 홈"><span className="brand-mark"><Icon name="leaf" size={25} /></span>volink<span className="brand-dot">.</span></a>
      <p className="brand-caption">우리 동네의 작은 변화</p>
      <div className="workspace-label">VOLUNTEER TOGETHER</div>
      <nav aria-label="주요 메뉴">{navigation.map(nav => <a href={`#/${nav.id}`} key={nav.id} className={`nav-item ${page === nav.id ? 'active' : ''}`} aria-current={page === nav.id ? 'page' : undefined}><Icon name={nav.icon} />{nav.title}{page === nav.id && <span className="nav-dot" />}</a>)}</nav>
      <div className="sidebar-bottom"><span className="mini-label">2026 졸업작품</span><strong>작은 실천을 연결합니다.</strong><p>경동대학교 · 팀 Volink<br />오준원 · 박용빈 · 김병수</p><a href="/presentations/report-20261006.html" className="presentation-link"><Icon name="screen" size={17} />제출 보고서 발표<Icon name="arrow" size={16} /></a><a href="#/presentation" className="presentation-link" style={{ marginTop: 16 }}><Icon name="screen" size={17} />1주차 실행 화면 발표<Icon name="arrow" size={16} /></a></div>
    </aside>}
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Volink <span>/</span> {isPresentation ? '1주차 발표' : navigation.find(n => n.id === page)?.title}</div><div className="topbar-right"><span className="week-pill">WEEK 01 · UI 초안</span><span className={`connection ${status ? 'online' : ''}`} role="status"><i />{status ? 'API · DB 연결됨' : error ? '연결 실패' : '서버 확인 중'}</span></div></header>
      <main id="main-content">
        {error && <div className="error-banner" role="alert">{error}<button className="text-button" onClick={() => setReload(value => value + 1)}>다시 연결</button></div>}
        {page === 'explore' && <Explore catalog={catalog} onSelect={setSelected} />}
        {page === 'create' && <CreateActivity catalog={catalog} />}
        {page === 'flows' && <Flows />}
        {page === 'progress' && <Progress catalog={catalog} />}
        {page === 'presentation' && <Presentation catalog={catalog} status={status} />}
      </main>
      <footer className="footer"><span>© 2026 Volink · 경동대학교 졸업작품</span><span>플랫폼 내부 활동 기록 · 공식 봉사실적 및 자원봉사 종합보험 비적용</span></footer>
    </div>
    {selected && <ActivityDialog activity={selected} baseDate={catalog?.baseDate ?? ''} close={() => setSelected(null)} />}
  </div>
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
}

function Explore({ catalog, onSelect }: { catalog: Catalog | null; onSelect: (activity: Activity) => void }) {
  const [category, setCategory] = useState('전체')
  const [query, setQuery] = useState('')
  const activities = catalog?.activities.filter(a => (category === '전체' || a.category === category) && `${a.title} ${a.placeName}`.includes(query.trim())) ?? []
  return <>
    <section className="hero"><div className="hero-copy"><span className="eyebrow"><span className="tiny-dot" /> 작은 실천, 가까운 연결</span><h1>가까운 곳에서,<br />함께 만드는 <em>변화.</em></h1><p>잠깐의 시간으로 우리 동네를 조금 더 좋게.<br />나와 이웃이 함께할 작은 봉사활동을 만나보세요.</p><a href="#activities" className="primary-button">주변 활동 살펴보기 <Icon name="arrow" size={18} /></a><span className="hero-note">2–10명 함께 · 3시간 이내 · 공공장소</span></div><div className="hero-art"><ParkArt /><div className="floating-note"><span className="floating-icon"><Icon name="leaf" /></span><div><strong>혼자보다, 함께.</strong><span>우리 동네에 변화를 남겨요</span></div></div><span className="art-caption">ILLUSTRATION · 지도 연동 전 UI 시안</span></div></section>
    <div className="demo-notice"><span className="outline-badge">1주차 시연</span><p>활동과 계정은 <strong>DB에서 읽은 시연용 예시</strong>입니다. 실제 신청·로그인·지도 연결은 이후 주차에 구현합니다.</p></div>
    <section className="metric-row" aria-label="시연 데이터 현황"><Metric value={catalog ? '03' : '—'} unit="곳" title="시연 장소 후보" text="경동대학교 · 양주 생활권" /><Metric value={catalog ? '09' : '—'} unit="명" title="시연 페르소나" text="모집자 2 · 참가자 6 · 관리자 1" /><Metric value="01" unit="주차" title="오늘의 개발 범위" text="환경 구축 · 화면 및 데이터 설계" /></section>
    <section id="activities" className="activity-section"><div className="section-heading"><div><span className="eyebrow">DISCOVER YOUR NEIGHBORHOOD</span><h2>우리 동네의 작은 실천</h2></div><span className="location-tag"><Icon name="pin" size={16} />양주 · 시연 장소 후보</span></div>
      <div className="filter-row"><div className="category-tabs" aria-label="활동 분야">{['전체', '환경 정화', '생활 지원', '지역 돌봄'].map(c => <button className={category === c ? 'selected' : ''} key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div><label className="search-box"><Icon name="compass" size={17} /><input aria-label="활동 또는 장소 검색" value={query} onChange={e => setQuery(e.target.value)} placeholder="활동이나 장소를 찾아보세요" /></label></div>
      {!catalog ? <div className="empty-state">API 데이터를 기다리고 있습니다. 서버 연결 상태를 확인해 주세요.</div> : activities.length ? <div className="activity-grid">{activities.map(activity => <ActivityCard key={activity.id} activity={activity} baseDate={catalog.baseDate} onSelect={onSelect} />)}</div> : <div className="empty-state">조건에 맞는 시연 활동이 없습니다. 다른 분야나 검색어를 선택해 주세요.</div>}
    </section>
    <section className="bottom-callout"><div className="callout-icon"><Icon name="plus" size={26} /></div><div><h3>내가 먼저, 작은 변화를 시작해 볼까요?</h3><p>활동 만들기 화면 초안에서 필요한 입력 항목을 확인해 보세요.</p></div><a href="#/create" className="secondary-button">활동 만들기 시안 <Icon name="arrow" size={17} /></a></section>
  </>
}

function Metric({ value, unit, title, text }: { value: string; unit: string; title: string; text: string }) {
  return <div className="metric"><div className="metric-value">{value}<span>{unit}</span></div><div><strong>{title}</strong><p>{text}</p></div></div>
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(`${value}T12:00:00+09:00`))
}

function ActivityCard({ activity, baseDate, onSelect }: { activity: Activity; baseDate: string; onSelect: (activity: Activity) => void }) {
  return <article className="activity-card"><div className="card-art"><ParkArt variant={activity.id - 1} /><span className="card-label">시연 예시</span><span className="duration-tag"><Icon name="clock" size={13} />{activity.durationMinutes}분</span></div><div className="card-body"><span className="category-label">{activity.category}</span><h3>{activity.title}</h3><p className="card-location"><Icon name="pin" size={15} />{activity.placeName}</p><p className="card-date"><Icon name="clock" size={15} />{dateLabel(baseDate)} · {activity.startTime}</p><div className="card-divider" /><div className="card-bottom"><div className="participant-count"><Icon name="users" size={16} /><strong>{activity.confirmed}</strong><span>/ {activity.capacity}명 · 예시</span></div><button className="card-detail" onClick={() => onSelect(activity)} aria-label={`${activity.title} 상세 보기`}>상세 보기 <Icon name="arrow" size={15} /></button></div></div></article>
}

function ActivityDialog({ activity, baseDate, close }: { activity: Activity; baseDate: string; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog className="activity-dialog" ref={ref} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close() }}><div className="dialog-header"><span className="eyebrow">ACTIVITY PREVIEW · UI 초안</span><button className="icon-button" onClick={close} aria-label="닫기"><Icon name="close" /></button></div><ParkArt variant={activity.id - 1} /><h2>{activity.title}</h2><p>{activity.description}</p><dl><div><dt>장소 후보</dt><dd>{activity.placeName} · 좌표 미확인</dd></div><div><dt>시연 일시</dt><dd>{dateLabel(baseDate)} {activity.startTime}</dd></div><div><dt>규모</dt><dd>{activity.capacity}명 · {activity.durationMinutes}분</dd></div></dl><p className="inline-notice">실제 모집글이 아닙니다. 참가 신청 기능은 5주차 예정입니다.</p><button disabled className="primary-button">참가 신청 · 준비 중</button><p className="small-print">공식 봉사실적 및 자원봉사 종합보험이 적용되지 않습니다.</p></dialog>
}

function CreateActivity({ catalog }: { catalog: Catalog | null }) {
  const [message, setMessage] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('화면 입력값 검증이 완료되었습니다. 서버 저장·위험도 검사는 3주차에 구현합니다. 활동은 등록되지 않았습니다.')
  }
  return <><PageHeading eyebrow="START A SMALL CHANGE" title="작은 실천을 시작해요" description="모집자에게 필요한 입력 항목을 정리한 1주차 화면 초안입니다." /><div className="two-column"><form className="panel activity-form" onSubmit={submit}><div className="panel-title"><h2>활동 정보</h2><span className="outline-badge">UI 초안 · 저장 없음</span></div><label>활동 이름<input name="title" required maxLength={100} placeholder="예: 공원에서 함께하는 가벼운 플로깅" /></label><div className="form-row"><label>분야<select name="category"><option>환경 정화</option><option>생활 지원</option><option>지역 돌봄</option></select></label><label>장소 후보<select name="place" required defaultValue=""><option value="" disabled>장소를 선택해 주세요</option>{catalog?.places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div><div className="form-row"><label>활동 날짜<input type="date" name="date" required /></label><label>시작 시간<input type="time" name="time" required /></label></div><div className="form-row"><label>모집 정원 <span className="field-hint">2–10명</span><input type="number" name="capacity" min="2" max="10" required defaultValue={6} /></label><label>활동 시간 <span className="field-hint">최대 180분</span><input type="number" name="duration" min="1" max="180" required defaultValue={90} /></label></div><label>활동 소개<textarea name="description" required maxLength={2000} rows={4} placeholder="함께할 일과 준비물을 알려주세요." /></label><fieldset className="safety-checks"><legend>안전 안내 확인</legend><label><input type="checkbox" required />공공장소의 주간 저위험 활동으로 기획합니다.</label><label><input type="checkbox" required />공식 봉사실적과 종합보험이 적용되지 않음을 이해합니다.</label></fieldset><button className="primary-button" type="submit">입력값 확인하기 <Icon name="arrow" size={17} /></button>{message && <p role="status" className="success-message">{message}</p>}</form><aside className="form-aside"><div className="panel"><span className="eyebrow">SMALL & SAFE</span><h2>함께하기 좋은<br />작은 활동의 기준</h2><ul className="feature-list"><li><Icon name="users" />2–10명의 작은 모임</li><li><Icon name="clock" />3시간 이내의 짧은 활동</li><li><Icon name="pin" />확인 가능한 공공장소</li><li><Icon name="leaf" />주간·저위험 활동 우선</li></ul></div><div className="risk-preview"><h3>위험도 처리 설계</h3><p><span className="risk low">LOW</span>규칙 통과 시 게시</p><p><span className="risk review">REVIEW</span>관리자 승인 전 비공개</p><p><span className="risk blocked">BLOCKED</span>게시 차단</p><small>설계 초안입니다. 서버 위험도 판정은 아직 구현되지 않았습니다.</small></div></aside></div></>
}

function Flows() {
  const [role, setRole] = useState<keyof typeof roleFlows>('참가자')
  return <><PageHeading eyebrow="DESIGNED FOR EVERYONE" title="사용자별 화면 흐름" description="역할과 활동 소유관계를 함께 확인하는 구조를 설계합니다. 아래 흐름은 구현 예정 명세입니다." /><div className="role-tabs">{Object.keys(roleFlows).map(r => <button key={r} aria-pressed={role === r} className={role === r ? 'selected' : ''} onClick={() => setRole(r as keyof typeof roleFlows)}>{r}</button>)}</div><section className="panel flow-panel"><div className="panel-title"><h2>{role}의 서비스 이용 흐름</h2><span className="outline-badge">설계 초안</span></div><div className="flow-grid">{roleFlows[role].map((step, index) => <div className="flow-step" key={step}><span>{String(index + 1).padStart(2, '0')}</span><h3>{step}</h3><small>구현 예정</small>{index < roleFlows[role].length - 1 && <Icon name="arrow" />}</div>)}</div></section><section className="panel permission-panel"><h2>역할과 권한의 기준</h2><div className="table-scroll"><table><thead><tr><th>구분</th><th>가능한 작업 · 설계</th><th>서버 확인 사항</th></tr></thead><tbody><tr><td>참가자</td><td>탐색, 본인 신청·취소, 체크인, 본인 기록</td><td>본인 여부 · 참가 상태 · 계정 상태</td></tr><tr><td>모집자</td><td>활동 개설, 본인 활동 승인·출석·완료 관리</td><td>USER 역할 + 해당 활동 organizer_id</td></tr><tr><td>관리자</td><td>위험 활동 검토, 신고·기록 조치</td><td>ADMIN 역할 · 조치 사유 · 감사 로그</td></tr></tbody></table></div><p className="inline-notice">모집자는 별도 시스템 권한이 아닌 활동의 소유자입니다. 페르소나 전환은 로그인이나 권한 부여가 아닙니다.</p></section></>
}

function Progress({ catalog }: { catalog: Catalog | null }) {
  return <><PageHeading eyebrow="BUILDING VOLINK, TOGETHER" title="개발 진행 현황" description="한 명이 한 주차의 화면·서버·데이터 작업을 맡고, 검증 결과와 다음 작업을 main에서 인수인계합니다." /><section className="progress-summary"><div><span className="eyebrow">CURRENT MILESTONE</span><h2>1주차 · 개발 기반 완성</h2><p>첫 기능을 연결하기 위한 환경과 설계를 준비했습니다.</p></div><span className="milestone-number">01<span>/ 08</span></span></section><div className="checklist-grid">{weekOne.map(group => <section className="panel" key={group.area}><span className="eyebrow">{group.area}</span><h3>1주차 완료 항목</h3><ul className="checklist">{group.items.map(item => <li key={item}><span className="check-icon"><Icon name="check" size={13} /></span>{item}</li>)}</ul></section>)}</div><section className="panel"><div className="panel-title"><h2>DB에서 확인한 시연 구성</h2><span className="outline-badge">API 실연동</span></div><div className="demo-data-grid"><div><h3>공공장소 후보 3곳</h3>{catalog?.places.map(p => <div className="place-item" key={p.id}><Icon name="pin" size={17} /><div><strong>{p.name}</strong><small>{p.area} · 좌표·이용 조건 확인 예정</small></div></div>) ?? <p>서버 연결 후 표시됩니다.</p>}</div><div><h3>시연 페르소나 9명</h3><div className="persona-grid">{catalog?.personas.map(p => <span key={p.code} className={`persona ${p.role.toLowerCase()}`}>{p.displayName}</span>)}</div><p className="small-print">로그인 계정은 아직 생성하지 않았습니다. 실제 비밀번호는 저장소에 포함되지 않습니다.</p></div></div></section><section className="roadmap-section"><h2>다음 변화의 순서</h2><div className="roadmap-grid">{roadmap.map(([week, title, desc]) => <div className={`roadmap-item ${week === '01' ? 'done' : ''}`} key={week}><span>WEEK {week}</span><h3>{title}</h3><p>{desc}</p><small>{week === '01' ? '기반 및 초안 완료' : '구현 예정'}</small></div>)}</div></section><div className="demo-notice"><span className="outline-badge">다음 담당자</span><p>2주차는 <strong>API 명세·ERD·권한표·상태 전이 확정</strong>입니다. Kakao 지도·로그인·신청·QR·S3·배포는 아직 미구현입니다.</p></div></>
}

function Presentation({ catalog, status }: { catalog: Catalog | null; status: ProjectStatus | null }) {
  const [slide, setSlide] = useState(0)
  const titles = ['작은 실천을 연결하는 첫걸음', '1주차에 준비한 것', '화면에서 DB까지 연결', '다음 담당자에게 전달']
  return <div className="presentation"><div className="presentation-top"><a href="#/progress" className="text-button">← 서비스 화면으로</a><span>WEEK 01 / 팀 Volink / 경동대학교</span></div><div className="slide"><span className="eyebrow">VOLINK · WEEKLY SHOWCASE</span><h1>{titles[slide]}</h1>{slide === 0 && <div className="presentation-intro"><div><p className="presentation-lead">가까운 곳에서, 짧은 시간 동안.<br />주민이 직접 열고 함께하는<br /><strong>소규모 봉사활동 웹 플랫폼.</strong></p><div className="presentation-tags"><span>2–10명</span><span>3시간 이내</span><span>지역 공공장소</span></div><p>오준원 · 박용빈 · 김병수</p><small>현재는 1주차 개발 기반·UI 시안입니다. 공식 봉사실적·종합보험 비적용.</small></div><ParkArt /></div>}{slide === 1 && <div className="checklist-grid">{weekOne.map(g => <section className="panel" key={g.area}><span className="eyebrow">{g.area}</span><h2>기반과 설계</h2><ul className="checklist">{g.items.map(i => <li key={i}><Icon name="check" size={17} />{i}</li>)}</ul></section>)}</div>}{slide === 2 && <><div className="architecture"><div><span>FRONTEND</span><h2>React · Vite</h2><p>UI 초안 · API 요청</p></div><Icon name="arrow" size={32} /><div><span>BACKEND</span><h2>Spring Boot</h2><p>시연 데이터 조회 API</p></div><Icon name="arrow" size={32} /><div><span>DATABASE</span><h2>MySQL · Flyway</h2><p>핵심 구조 · 마이그레이션</p></div></div><div className="presentation-evidence"><strong>{status?.database === 'UP' ? '현재 API · DB 연결 성공' : '현재 서버 연결 확인 필요'}</strong><p>조회된 장소 {catalog?.places.length ?? 0}곳 · 페르소나 {catalog?.personas.length ?? 0}명 · 활동 시안 {catalog?.activities.length ?? 0}건</p><small>인증, 서버 위험도 검사, 정원 잠금, 체크인 로직은 아직 구현되지 않았습니다.</small></div></>}{slide === 3 && <div className="next-week-grid"><section className="panel"><span className="eyebrow">WEEK 02</span><h2>다음주 작업</h2><ol><li>ERD·API 명세·권한표·참가 상태 전이 확정</li><li>지도·목록 화면 및 입력·오류 규칙 설계</li><li>시연 장소 좌표·이용 조건·계정 정의 확정</li><li>위험 키워드·배포 비용·보안 기준 정리</li></ol></section><section className="panel"><span className="eyebrow">HANDOFF</span><h2>인수인계 원칙</h2><ol><li>README의 현재 구현·주차 체크리스트 확인</li><li>한 사람이 해당 주차 전체 범위 작업</li><li>실행·규칙 테스트 후 실제 완료만 체크</li><li>보고서·인수인계·검증 결과를 함께 main 푸시</li></ol></section></div>}</div><div className="slide-controls"><button className="secondary-button" disabled={slide === 0} onClick={() => setSlide(s => s - 1)}>이전</button><div className="slide-dots">{titles.map((title, index) => <button key={title} aria-label={`${index + 1}번 슬라이드`} aria-current={slide === index ? 'step' : undefined} className={slide === index ? 'active' : ''} onClick={() => setSlide(index)} />)}<span>{slide + 1} / 4</span></div><button className="primary-button" disabled={slide === 3} onClick={() => setSlide(s => s + 1)}>다음 <Icon name="arrow" size={17} /></button></div></div>
}
