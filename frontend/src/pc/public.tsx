// PC 공개 화면 (2026-11-11): 봉사 찾기 (no login), a post's page (also what a shared link opens), login, 기관 가입,
// and the page a personal account sees (Volink is used in the app).
import { useEffect, useRef, useState } from 'react'
import { mountMotion } from './motion'
import type { Motion } from './motion'
import type { FormEvent, ReactNode } from 'react'
import { api, ApiError, login, uploadFile } from '../api'
import type { LiveActivity, User } from '../api'
import { DocPicker } from './docs'
import type { OrgDoc } from './docs'
import { AppQr, appUrl, Loading, Logo, PcIcon, PublicFooter, PublicHeader, minutesWord, when } from './ui'

const left = (a: LiveActivity) => Math.max(0, a.capacity - a.confirmed)
const startsAt = (a: LiveActivity) => new Date(`${a.date}T${a.startTime}:00+09:00`).getTime()

function seatTag(a: LiveActivity) {
  if (a.status !== 'RECRUITING' || startsAt(a) <= Date.now()) return <span className="pc-tag">모집 마감</span>
  if (left(a) === 0) return startsAt(a) - Date.now() > 2 * 3_600_000 ? <span className="pc-tag amb">대기 가능</span> : <span className="pc-tag">모집 마감</span>
  return <span className="pc-tag g">{left(a)}자리 남음</span>
}

/** 봉사 장면 (첫 화면 위쪽): four scenes in turn. Stops while off screen or the tab is hidden;
 *  with reduced motion one still scene shows. */
function VolunteerMotion() {
  const ref = useRef<SVGSVGElement>(null)
  const motion = useRef<Motion | null>(null)
  const [scene, setScene] = useState(0)
  const [names, setNames] = useState<{ cat: string; name: string }[]>([])
  useEffect(() => {
    if (!ref.current) return
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const m = mountMotion(ref.current, { start: still ? 2.6 : 0, animate: !still, onScene: setScene })
    motion.current = m; setNames(m.scenes)
    let visible = true
    const sync = () => m.play(!still && visible && document.visibilityState === 'visible')
    const seen = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync() }) : null
    seen?.observe(ref.current)
    document.addEventListener('visibilitychange', sync)
    ;(window as unknown as { __motion?: Motion }).__motion = m
    return () => { seen?.disconnect(); document.removeEventListener('visibilitychange', sync); m.destroy() }
  }, [])
  return <div className="pc-motion">
    <svg ref={ref} viewBox="0 0 720 540" role="img" aria-label={names[scene] ? `봉사 장면: ${names[scene].name}` : '봉사 장면'} />
  </div>
}

/** The app download: QR for a phone camera next to the button (the APK file on this server). */
export function AppGet() {
  return <div className="pc-get"><AppQr size={116} /><div><b>휴대폰 카메라로 찍어 앱 받기</b><span>안드로이드 · 무료</span>
    <a className="pc-btn lg" href={appUrl()}><PcIcon name="download" size={17} />앱 받기</a></div></div>
}

/** A screen of the app in a phone frame (real phone proportions, 390×844). */
function Phone({ src, label, className }: { src: string; label: string; className?: string }) {
  return <img className={'pc-shot' + (className ? ' ' + className : '')} src={src} alt={label} loading="lazy" width={390} height={844} />
}

/** Elements with .pc-rv fade up one by one as they come into view. */
function useReveal() {
  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('.pc-rv'))
    if (!('IntersectionObserver' in window)) { items.forEach(el => el.classList.add('in')); return }
    const seen = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('in'); seen.unobserve(entry.target) }
    }), { rootMargin: '0px 0px -12% 0px', threshold: 0.12 })
    items.forEach(el => seen.observe(el))
    return () => seen.disconnect()
  }, [])
}

const features: { tag: string; title: string[]; text: string; chips: string[]; shot: string; label: string }[] = [
  { tag: '01 · 찾기·신청', title: ['내 주변 봉사를', '찾고 바로 신청해요'], text: '지도와 날짜·분야로 가까운 모집을 찾아요. 자리가 없으면 대기 신청하고, 자리가 나면 알림으로 알려 드려요.', chips: ['내 주변', '이번 주말', '처음 환영', '대기 신청'], shot: '/pc/app-detail.jpg', label: '모집글 화면' },
  { tag: '02 · 일정·출석', title: ['신청한 일정은 달력으로,', '출석은 현장 QR로'], text: '모집자가 출석을 열면 알림이 와요. 30초마다 바뀌는 QR과 위치 확인으로 출석하고, 끝나면 활동 기록이 남아요.', chips: ['일정 달력', '하루 전 알림', 'QR 출석'], shot: '/pc/app-mine.jpg', label: '내 활동 달력 화면' },
  { tag: '03 · 기록', title: ['1365 실적과 Volink 활동을', '한곳에서 봐요'], text: '1365 실적을 가져오거나 실적확인서를 스캔해 함께한 시간을 모아요. 1365 공식 실적과 Volink 활동은 따로 구분해 보여 줘요.', chips: ['1365 가져오기', '확인서 스캔', '함께한 시간'], shot: '/pc/app-my.jpg', label: '마이 화면' },
  { tag: '04 · 커뮤니티', title: ['봉사 경험을', '이웃과 나눠요'], text: '후기·질문·봉사 홍보로 이야기를 나누고, 함께한 활동을 카드로 붙여 소개해요.', chips: ['봉사 후기', '질문', '봉사 홍보'], shot: '/pc/app-community.jpg', label: '커뮤니티 화면' },
]
const steps: [string, string][] = [['앱 받기', 'QR을 찍거나 [앱 받기]를 눌러 설치해요'], ['가입하기', '이메일·카카오·구글로 가입하고 관심 분야를 골라요'], ['신청하기', '마음에 드는 봉사를 찾아 신청하면 확정 알림이 와요']]

/** The first page: what the app does, how to start, and the way in for 기관. No list of posts (shared links open #/activity/{id}). */
export function PublicHome({ user, onSignOut, to }: { user: User | null; onSignOut: () => void; to?: string | null }) {
  useReveal()
  // Opened from a menu item on another page (#/?to=how): go to that part.
  useEffect(() => {
    if (!to) return
    const t = window.setTimeout(() => document.getElementById('pc-' + to)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    return () => window.clearTimeout(t)
  }, [to])
  return <div className="pc">
    <PublicHeader user={user} current="home" onSignOut={onSignOut} />
    <section className="pc-land-hero" id="pc-about"><div className="pc-wrap">
      <div className="pc-land-copy pc-rv">
        <h1>우리 동네 봉사,<br />찾고 신청하고 기록까지<br />앱 하나로</h1>
        <p>가까운 모집을 찾아 신청하고, 현장에서 QR로 출석하고,<br />1365 실적까지 한곳에서 챙겨요.</p>
        <AppGet />
      </div>
      <VolunteerMotion />
    </div></section>
    <section className="pc-wrap pc-land-sec" aria-label="Volink로 할 수 있는 것">
      <div className="pc-land-h pc-rv"><h2>Volink로 할 수 있는 것</h2><p>봉사를 찾는 순간부터 기록이 남을 때까지</p></div>
      {features.map((f, i) => <article key={f.tag} className={'pc-row pc-rv' + (i % 2 ? ' flip' : '')}>
        <div className="t"><small>{f.tag}</small><h3>{f.title[0]}<br />{f.title[1]}</h3><p>{f.text}</p><ul>{f.chips.map(c => <li key={c}>{c}</li>)}</ul></div>
        <Phone src={f.shot} label={f.label} />
      </article>)}
    </section>
    <section className="pc-wrap pc-land-sec" id="pc-how" aria-label="이렇게 시작해요">
      <div className="pc-land-h pc-rv"><h2>이렇게 시작해요</h2><p>3분이면 첫 신청까지</p></div>
      <div className="pc-steps3 big">{steps.map(([t, d], i) => <div key={t} className="pc-rv" style={{ transitionDelay: i * 0.1 + 's' }}><i>{i + 1}</i><b>{t}</b><span>{d}</span></div>)}</div>
      <div className="pc-land-cta pc-rv"><AppQr size={92} /><div><b>지금 Volink 앱을 받아 보세요</b><span>안드로이드 · 무료</span></div><a className="pc-btn lg" href={appUrl()}><PcIcon name="download" size={17} />앱 받기</a></div>
    </section>
    <section className="pc-land-org" id="pc-org" aria-label="기관 안내"><div className="pc-wrap pc-rv"><div><h2>봉사자를 모집하는 기관이세요?</h2><p>기관센터에서 모집글을 올리고 신청자·출석·기록을 PC로 관리하세요.</p></div>
      <div className="pc-sp" /><a className="pc-btn lg light" href="#/org/signup">기관 가입 신청</a><a className="pc-btn lg ghost" href="#/org">기관 로그인</a></div></section>
    <PublicFooter />
  </div>
}

/** 기관센터 입구 (not logged in): what the 기관센터 does next to the 기관 login. */
export function OrgEntry({ onSession, user, onSignOut }: { onSession: (user: User) => void; user: User | null; onSignOut: () => void }) {
  return <div className="pc">
    <PublicHeader user={user} current="org" onSignOut={onSignOut} />
    <div className="pc-wrap pc-org-entry">
      <div>
        <h1>기관 봉사 모집,<br />PC에서 한 번에 관리하세요</h1>
        <p className="lead">모집글 작성부터 신청자 승인, 현장 출석, 완료 기록까지.</p>
        <div className="pc-steps3">{[['가입 신청', '기관 정보와 담당자를 입력해요'], ['운영자 확인', '확인되면 알림으로 알려 드려요'], ['모집 시작', '기관센터에서 모집글을 올려요']].map(([t, d], i) =>
          <div key={t}><i>{i + 1}</i><b>{t}</b><span>{d}</span></div>)}</div>
        <div className="pc-can">{[['여러 날짜', '모집글 한 번에 올리기'], ['신청자', '한 번에 승인 · 신청 질문 답 보기'], ['출석부', '내려받기 · 현장 출석은 앱으로'], ['1365 연결', '링크 · 기관 공개 페이지']].map(([b, t]) => <div key={b}><b>{b}</b> {t}</div>)}</div>
      </div>
      <LoginCard onSession={onSession} title="기관 로그인" note="기관 담당자 계정으로 로그인해요." />
    </div>
    <PublicFooter />
  </div>
}

const difficultyWord: Record<string, string> = { EASY: '가벼워요', NORMAL: '보통', HARD: '힘써요' }
const placeWord: Record<string, string> = { OUTDOOR: '야외', INDOOR: '실내', MIXED: '실내·야외' }

export function PublicDetail({ id, user, onSignOut }: { id: number; user: User | null; onSignOut: () => void }) {
  const [a, setA] = useState<LiveActivity | null>(null)
  const [missing, setMissing] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    api<LiveActivity>('/api/activities/' + id).then(found => {
      if (user && found.organizerId === user.id && user.memberType === 'INSTITUTION') { window.location.replace('#/org/activity/' + id); return }
      setA(found)
    }).catch(() => setMissing(true))
  }, [id, user])
  const body = missing ? <div className="pc-center"><div className="pc-pn pc-card" style={{ textAlign: 'center' }}><h1>모집글을 찾을 수 없어요</h1><p className="mu">삭제됐거나 아직 공개되지 않은 모집이에요.</p><a className="pc-btn" href="#/">다른 모집 보기</a></div></div>
    : !a ? <Loading /> : <main className="pc-pub pc-detail">
      <div className="main">
        <p className="mu"><a href="#/">봉사 찾기</a> › {a.category}</p>
        <div className="pc-chips" style={{ gap: 6 }}><span className="pc-tag g">{a.category}</span>{a.difficulty && <span className="pc-tag">{difficultyWord[a.difficulty]}</span>}{a.placeKind && <span className="pc-tag">{placeWord[a.placeKind]}</span>}{(a.newcomerOk === true || a.newcomerOk === 1) && <span className="pc-tag g">처음 환영</span>}{a.activityType === 'INSTITUTION' && <span className="pc-tag blu">{a.organizationName ?? '기관'} 주관</span>}{(a.youthOk === false || a.youthOk === 0) && <span className="pc-tag">만 19세 이상</span>}</div>
        <h1>{a.title}</h1>
        <div className="pc-pn" style={{ padding: '4px 16px' }}>
          <div className="pc-kv"><span>일시</span><b>{when(a.date, a.startTime)} · {minutesWord(a.durationMinutes)}</b></div>
          <div className="pc-kv"><span>장소</span><b>{[a.placeName ?? '장소 미정', a.meetingPoint].filter(Boolean).join(' · ')}</b></div>
          <div className="pc-kv"><span>모집</span><b>확정 {a.confirmed} / {a.capacity}명{a.waiting ? ` · 대기 ${a.waiting}명` : ''}</b></div>
          <div className="pc-kv" style={{ borderBottom: 0 }}><span>모집자</span><b>{a.activityType === 'INSTITUTION' && a.organizationId ? <a className="pc-link" href={'#/o/' + a.organizationId}>{a.organizationName}</a> : a.activityType === 'INSTITUTION' ? a.organizationName : a.organizerName}{a.organizerStats ? ` · 모집 ${a.organizerStats.hosted}회 · 완료 ${a.organizerStats.finished}회` : ''}</b></div>
        </div>
        <div className="pc-pn" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2>어떤 활동인가요?</h2><p style={{ whiteSpace: 'pre-wrap', color: 'var(--pc-ink2)', lineHeight: 1.7 }}>{a.description}</p>
          {a.supplies && a.supplies.length > 0 && <><h2 style={{ marginTop: 8 }}>준비물</h2><p style={{ color: 'var(--pc-ink2)' }}>{a.supplies.map(s => s.name + (s.provided ? ' (모집자가 준비)' : '')).join(' · ')}</p></>}
        </div>
        {a.vmsLink && <div className="pc-pn" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}><div style={{ flex: 1 }}><b style={{ color: 'var(--pc-blu)' }}>1365에도 등록된 활동이에요</b><p className="pc-note">1365 봉사실적은 1365에서 신청해야 인정돼요. Volink는 1365 신청을 대신하지 않아요.</p></div><a className="pc-btn sm line" href={a.vmsLink} target="_blank" rel="noreferrer">1365에서 보기</a></div>}
        <p className="pc-note">Volink 활동은 공식 봉사실적이 아니며 자원봉사 종합보험이 적용되지 않습니다. 연락처는 공개하지 않으며, 궁금한 점은 참가 확정 뒤 앱의 활동 소식에서 물어볼 수 있어요.</p>
      </div>
      <aside className="pc-pn aside">
        <div><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}><b>확정 {a.confirmed} / {a.capacity}명</b>{seatTag(a)}</div>
          <div className="pc-prog"><i style={{ width: Math.min(100, a.confirmed / Math.max(1, a.capacity) * 100) + '%' }} /></div></div>
        <div style={{ borderTop: '1px solid var(--pc-line)', paddingTop: 14, display: 'flex', gap: 14, alignItems: 'center' }} className="pc-qr-in"><AppQr size={100} />
          <div><b style={{ fontSize: 15 }}>신청은 앱에서 해요</b><p className="pc-note" style={{ marginTop: 4 }}>Volink 앱을 받고 로그인한 뒤<br />이 모집을 찾아 신청해 주세요</p></div></div>
        <a className="pc-btn lg wide" href={appUrl()}><PcIcon name="download" size={17} />앱 받기</a>
        <button type="button" className="pc-btn line wide" onClick={() => { void navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true)).catch(() => {}) }}><PcIcon name="link" />{copied ? '링크를 복사했어요' : '링크 복사'}</button>
      </aside>
    </main>
  return <div className="pc"><PublicHeader user={user} onSignOut={onSignOut} />{body}<PublicFooter /></div>
}

/** One login for 기관 and 운영자; the account decides where it goes. Personal members use the app. */
function LoginCard({ onSession, title, note }: { onSession: (user: User) => void; title: string; note: string }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '').trim(), password = String(data.get('password') ?? '')
    if (!email || !password) { setError('이메일과 비밀번호를 입력해 주세요.'); return }
    setBusy(true); setError('')
    try {
      const user = await login(email, password)
      onSession(user)
      const next = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('next')
      window.location.replace(user.role === 'ADMIN' ? (next?.startsWith('#/admin') ? next : '#/admin') : user.memberType === 'INSTITUTION' ? (next?.startsWith('#/org') ? next : '#/org') : '#/app')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '로그인하지 못했어요.') } finally { setBusy(false) }
  }
  return <form className="pc-pn pc-card pc-login" onSubmit={submit} noValidate>
    <h1>{title}</h1><p className="mu" style={{ marginTop: -6 }}>{note}</p>
    <label className="pc-f"><span>이메일</span><input className="pc-in" name="email" type="email" autoComplete="username" /></label>
    <label className="pc-f"><span>비밀번호</span><input className="pc-in" name="password" type="password" autoComplete="current-password" /></label>
    {error && <p className="pc-err" role="alert" style={{ margin: 0 }}>{error}</p>}
    <button className="pc-btn lg wide" disabled={busy}>{busy ? '로그인하는 중…' : '로그인'}</button>
    <div style={{ borderTop: '1px solid var(--pc-line)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5 }}>
      <div style={{ display: 'flex' }}><span className="mu">처음 오셨나요?</span><a className="pc-link" style={{ marginLeft: 'auto' }} href="#/org/signup">기관 가입 신청</a></div>
      <div style={{ display: 'flex' }}><span className="mu">개인 회원은 앱에서 이용해요</span><a className="pc-link" style={{ marginLeft: 'auto' }} href={appUrl()}>앱 받기</a></div></div>
  </form>
}

export function PcLogin({ onSession }: { onSession: (user: User) => void }) {
  return <div className="pc"><header className="pc-hd"><Logo /></header>
    <div className="pc-center"><LoginCard onSession={onSession} title="로그인" note="기관 담당자와 운영자 계정으로 로그인해요" /></div></div>
}

export function AppOnly({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  return <div className="pc"><PublicHeader user={user} onSignOut={onSignOut} />
    <div className="pc-center"><div className="pc-pn pc-card wide" style={{ flexDirection: 'row', gap: 28, alignItems: 'center' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ color: 'var(--pc-g)' }}><PcIcon name="phone" size={34} /></span>
        <h1 style={{ fontSize: 24, lineHeight: 1.35 }}>{user.name}님, 신청과 출석은<br />Volink 앱에서 할 수 있어요</h1>
        <p className="mu">같은 이메일과 비밀번호로 앱에 로그인하면 신청 내역과 기록이 그대로 보여요.</p>
        <div style={{ display: 'flex', gap: 8 }}><a className="pc-btn lg" href={appUrl()}><PcIcon name="download" size={17} />앱 받기</a><button type="button" className="pc-btn lg line" onClick={onSignOut}>로그아웃</button></div>
        <a className="pc-link" href="#/">PC에서 모집 둘러보기 ›</a>
      </div>
      <AppQr size={150} />
    </div></div></div>
}

const orgTypes: [string, string][] = [['VOLUNTEER_CENTER', '자원봉사센터'], ['WELFARE', '복지관·복지시설'], ['SCHOOL', '학교·교육기관'], ['NONPROFIT', '비영리단체'], ['PUBLIC', '공공기관'], ['OTHER', '기타']]

/** 기관 가입 동의 (같은 항목을 앱 기관 가입도 받아요). The last value is the short text shown by [보기]. */
const orgTerms: [string, string | null][] = [
  ['기관을 대표하는 담당자이며 만 14세 이상이에요', null],
  ['Volink 이용약관에 동의해요', '기관 회원은 운영자 확인을 받은 뒤 기관 이름으로 봉사 모집글을 올리고 신청자·출석·완료를 관리할 수 있어요. 모집글에는 사실인 내용만 쓰고, 연락처·외부 연락 유도·위험한 활동을 올리지 않아요. 규칙을 어기면 글이 숨겨지거나 이용이 제한될 수 있어요.'],
  ['개인정보 처리방침에 동의해요', '담당자 이름·이메일과 기관 연락처·주소·1365 수요처 번호를 기관 확인과 서비스 안내에 써요. 기관 연락처는 다른 회원에게 공개하지 않아요. 탈퇴하면 개인 정보는 지우고, 법으로 남겨야 하는 기록만 정해진 기간 동안 보관해요.'],
  ['기관 정보가 사실이고, 관리자 확인에 동의해요', null],
  ['Volink 활동은 공식 봉사실적·자원봉사 종합보험이 아님을 이해해요', 'Volink 활동 기록은 공식 봉사실적으로 인정되지 않으며 자원봉사 종합보험이 적용되지 않아요. 1365 실적이 필요한 활동은 1365에도 등록하고, 참여자가 1365에서 신청하도록 안내해 주세요.'],
]
const signSteps = ['약관 동의', '기관 정보', '담당자 계정', '신청 완료']

/** 기관 가입 신청 (2026-11-12): 약관 동의 → 기관 정보 → 담당자 계정 → 신청 완료, one step at a time. */
export function OrgSignup({ onSession }: { onSession: (user: User) => void }) {
  const [step, setStep] = useState(0)
  const [agreed, setAgreed] = useState(orgTerms.map(() => false))
  const [reading, setReading] = useState<number | null>(null)
  const [f, setF] = useState({ organizationType: '', organization: '', organizationContact: '', vmsCode: '', address: '', name: '', email: '', password: '', passwordConfirm: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [docFiles, setDocFiles] = useState<File[]>([])
  const [sent, setSent] = useState<{ ok: OrgDoc[]; failed: string[] }>({ ok: [], failed: [] })
  const set = (k: keyof typeof f) => (value: string) => { setF(old => ({ ...old, [k]: value })); setErrors(old => { const next = { ...old }; delete next[k]; return next }) }
  const go = (n: number) => { setStep(n); setMessage(''); window.scrollTo(0, 0) }
  function checkOrg() {
    const found: Record<string, string> = {}
    if (!f.organizationType) found.organizationType = '기관 유형을 골라 주세요.'
    if (f.organization.trim().length < 2) found.organization = '기관명을 입력해 주세요.'
    if (!/^[0-9-]{9,20}$/.test(f.organizationContact.trim())) found.organizationContact = '연락처는 숫자와 - 로 입력해 주세요.'
    setErrors(found)
    if (!Object.keys(found).length) go(2)
  }
  const pwOk = f.password.length >= 8 && /[A-Za-z]/.test(f.password) && /\d/.test(f.password)
  async function submit(event: FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (!f.name.trim()) found.name = '담당자 이름을 입력해 주세요.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) found.email = '이메일 형식을 확인해 주세요.'
    if (!pwOk) found.password = '영문과 숫자를 섞어 8자 이상으로 만들어 주세요.'
    if (f.password !== f.passwordConfirm) found.passwordConfirm = '비밀번호가 서로 달라요.'
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true); setMessage('')
    try {
      await api('/api/auth/signup', 'POST', { memberType: 'INSTITUTION', name: f.name.trim(), email: f.email.trim(), password: f.password, interests: [],
        organizationName: f.organization.trim(), organizationContact: f.organizationContact.trim(), organizationType: f.organizationType, organizationAddress: f.address.trim() || null,
        vmsRegistered: Boolean(f.vmsCode.trim()), vmsCode: f.vmsCode.trim() || null, agreedNotice: true })
      onSession(await login(f.email.trim(), f.password))
      // 확인 서류 (선택): sent after the account exists; one that fails can be added again on 심사 현황.
      const ok: OrgDoc[] = [], failed: string[] = []
      for (const file of docFiles) { try { ok.push(await uploadFile<OrgDoc>('/api/me/organization/documents', file)) } catch { failed.push(file.name) } }
      setSent({ ok, failed })
      go(3)
    } catch (cause) {
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length) {
        const map: Record<string, string> = { organizationName: 'organization', organizationAddress: 'address' }
        const next = Object.fromEntries(Object.entries(cause.fieldErrors).map(([k, v]) => [map[k] ?? k, v]))
        setErrors(next)
        if (['organizationType', 'organization', 'organizationContact', 'vmsCode', 'address'].some(k => next[k])) go(1)
      } else setMessage(cause instanceof Error ? cause.message : '가입하지 못했어요.')
    } finally { setBusy(false) }
  }
  const err = (k: string) => errors[k] ? <em role="alert">{errors[k]}</em> : null
  const cls = (k: string) => 'pc-in' + (errors[k] ? ' bad' : '')
  const input = (k: keyof typeof f, label: ReactNode, props: Record<string, unknown> = {}) =>
    <label className="pc-f"><span>{label}</span><input className={cls(k)} value={f[k]} onChange={e => set(k)(e.target.value)} {...props} />{err(k)}</label>
  const all = agreed.every(Boolean)
  return <div className="pc"><header className="pc-hd"><a className="pc-logo" href="#/"><i><PcIcon name="leaf" size={14} /></i>volink<em>기관센터</em></a><div className="pc-sp" /><span className="mu">이미 계정이 있나요? <a className="pc-link" href="#/org">기관 로그인</a></span></header>
    <div className="pc-center"><div className="pc-pn pc-card pc-sign">
      <ol className="pc-sign-steps" aria-label="가입 단계">{signSteps.map((t, i) => <li key={t} className={i < step ? 'done' : i === step ? 'on' : ''} aria-current={i === step ? 'step' : undefined}>{t}</li>)}</ol>
      {step === 0 && <div className="pc-sign-body" key="terms">
        <h1>기관 가입을 위해<br />약관에 동의해 주세요</h1>
        <label className="pc-agree all"><input type="checkbox" className="pc-cb" checked={all} onChange={e => setAgreed(orgTerms.map(() => e.target.checked))} /><b>전체 동의하기</b></label>
        <div className="pc-agree-list">{orgTerms.map(([text, more], i) => <div key={text} className="pc-agree">
          <label><input type="checkbox" className="pc-cb" checked={agreed[i]} onChange={e => setAgreed(old => old.map((v, k) => k === i ? e.target.checked : v))} /><span><em>필수</em>{text}</span></label>
          {more && <button type="button" className="pc-more-link" onClick={() => setReading(i)} aria-label={text + ' 보기'}>보기 ›</button>}</div>)}</div>
        <button type="button" className="pc-btn lg wide" disabled={!all} onClick={() => go(1)}>동의하고 계속</button>
      </div>}
      {step === 1 && <form className="pc-sign-body" key="org" noValidate onSubmit={e => { e.preventDefault(); checkOrg() }}>
        <h1>어떤 기관인가요?</h1>
        <div className="pc-f"><span id="org-type">기관 유형</span><div className="pc-chips" role="radiogroup" aria-labelledby="org-type">{orgTypes.map(([k, t]) =>
          <button key={k} type="button" role="radio" aria-checked={f.organizationType === k} aria-pressed={f.organizationType === k} onClick={() => set('organizationType')(k)}>{t}</button>)}</div>{err('organizationType')}</div>
        {input('organization', '기관명', { maxLength: 100 })}
        <div className="pc-two">{input('organizationContact', '대표 연락처', { type: 'tel', maxLength: 20, placeholder: '031-000-0000' })}
          {input('vmsCode', <>1365 수요처 번호 <small>(있으면)</small></>, { maxLength: 30 })}</div>
        {input('address', <>주소 <small>(선택)</small></>, { maxLength: 200 })}
        <DocPicker files={docFiles} onChange={setDocFiles} />
        <div className="pc-sign-nav"><button type="button" className="pc-btn lg line" onClick={() => go(0)}>이전</button><button className="pc-btn lg">다음</button></div>
      </form>}
      {step === 2 && <form className="pc-sign-body" key="account" noValidate onSubmit={submit}>
        <h1>로그인할 담당자 계정을<br />만들어 주세요</h1>
        {input('name', '담당자 이름', { maxLength: 40, autoComplete: 'name' })}
        {input('email', <>이메일 <small>(로그인 아이디)</small></>, { type: 'email', autoComplete: 'email' })}
        <div className="pc-two">{input('password', <>비밀번호 <small>영문·숫자 8자 이상</small></>, { type: 'password', autoComplete: 'new-password' })}
          {input('passwordConfirm', '비밀번호 확인', { type: 'password', autoComplete: 'new-password' })}</div>
        {f.passwordConfirm && !errors.passwordConfirm && <p className={'pc-hint' + (f.password === f.passwordConfirm ? '' : ' bad')}>{f.password === f.passwordConfirm ? '비밀번호가 같아요' : '비밀번호가 서로 달라요'}</p>}
        <div className="pc-q" style={{ fontSize: 13 }}><b>신청할 기관</b><br />{orgTypes.find(([k]) => k === f.organizationType)?.[1]} · {f.organization}<br />{f.organizationContact}{f.address ? ' · ' + f.address : ''}{f.vmsCode ? ' · 1365 수요처 ' + f.vmsCode : ''}{docFiles.length ? <><br />확인 서류 {docFiles.length}개</> : null}</div>
        {message && <p className="pc-err" role="alert" style={{ margin: 0 }}>{message}</p>}
        <div className="pc-sign-nav"><button type="button" className="pc-btn lg line" onClick={() => go(1)}>이전</button><button className="pc-btn lg" disabled={busy}>{busy ? '보내는 중…' : '가입 신청하기'}</button></div>
      </form>}
      {step === 3 && <div className="pc-sign-body done" key="done">
        <span className="pc-sign-mark"><PcIcon name="check" size={30} /></span>
        <h1>가입 신청을 받았어요</h1>
        <p className="mu">운영자가 기관 정보를 확인하면 알림으로 알려 드려요. 보통 1~2일 걸려요.</p>
        {sent.ok.length > 0 && <div className="pc-q pc-sent"><PcIcon name="check" size={16} />확인 서류 {sent.ok.length}개를 함께 보냈어요</div>}
        {sent.failed.length > 0 && <p className="pc-err" role="alert" style={{ margin: 0, alignSelf: 'stretch' }}>{sent.failed.join(', ')}은(는) 올리지 못했어요. 기관센터의 심사 현황에서 다시 올려 주세요.</p>}
        <div className="pc-steps" style={{ alignSelf: 'stretch', textAlign: 'left', margin: '6px 0 0 8px' }}><div><b>가입 신청</b><small>{f.organization}</small></div><div className="now"><b>운영자 확인 중</b><small>기관 정보 확인</small></div><div className="next"><b>모집 시작</b><small>기관센터에서 모집글 올리기</small></div></div>
        <a className="pc-btn lg wide" href="#/org">기관센터로 가기</a>
      </div>}
    </div></div>
    {reading !== null && <div className="pc-dim" onClick={() => setReading(null)}><div className="pc-pn pc-dialog" role="dialog" aria-label={orgTerms[reading][0]} onClick={e => e.stopPropagation()}>
      <h2>{orgTerms[reading][0]}</h2><p style={{ lineHeight: 1.7, color: 'var(--pc-ink2)' }}>{orgTerms[reading][1]}</p>
      <button type="button" className="pc-btn" onClick={() => { setAgreed(old => old.map((v, k) => k === reading ? true : v)); setReading(null) }}>동의하고 닫기</button></div></div>}
  </div>
}

type OrgPageData = { id: number; name: string; orgType: string | null; address: string | null; intro: string | null; vmsRegistered: boolean | number | null
  hosted: number; people: number; attendance: number | null
  recruiting: { id: number; title: string; category: string; date: string; startTime: string; capacity: number; confirmed: number }[]
  reviews: { id: number; title: string; author: string; activityTitle: string; date: string }[] }
const orgTypeWord: Record<string, string> = { VOLUNTEER_CENTER: '자원봉사센터', WELFARE: '복지관·복지시설', SCHOOL: '학교·교육기관', NONPROFIT: '비영리단체', PUBLIC: '공공기관', OTHER: '기관' }

/** 기관 공개 페이지 (#/o/{id}): anyone, no login; what the institution does, its open posts and reviews. */
export function OrgPage({ id, user, onSignOut }: { id: number; user: User | null; onSignOut: () => void }) {
  const [o, setO] = useState<OrgPageData | null>(null)
  const [missing, setMissing] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => { api<OrgPageData>('/api/organizations/' + id).then(setO).catch(() => setMissing(true)) }, [id])
  const body = missing ? <div className="pc-center"><div className="pc-pn pc-card" style={{ textAlign: 'center' }}><h1>기관을 찾을 수 없어요</h1><a className="pc-btn" href="#/">모집 둘러보기</a></div></div>
    : !o ? <Loading /> : <main className="pc-pub" style={{ maxWidth: 1150 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p className="mu"><a href="#/">봉사 찾기</a> › 기관</p>
        <section className="pc-pn pc-orghead" aria-label="기관">
          <span className="mark" aria-hidden="true">{o.name.slice(0, 1)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="pc-chips" style={{ gap: 6, marginBottom: 6 }}><span className="pc-tag blu">{orgTypeWord[o.orgType ?? ''] ?? '기관'}</span><span className="pc-tag g">확인된 기관</span>{o.vmsRegistered ? <span className="pc-tag">1365 수요처</span> : null}</div>
            <h1>{o.name}</h1>{o.address && <p className="mu" style={{ marginTop: 2 }}>{o.address}</p>}
            {o.intro && <p style={{ marginTop: 8, color: 'var(--pc-ink2)', whiteSpace: 'pre-wrap' }}>{o.intro}</p>}
          </div>
          <div className="nums"><div><b>{o.hosted}</b><span>모집</span></div><div><b>{o.people}명</b><span>함께한 사람</span></div><div><b>{o.attendance == null ? '–' : o.attendance + '%'}</b><span>출석률</span></div></div>
        </section>
        <section className="pc-pn" aria-label="지금 모집 중"><div className="pc-ph"><h2>지금 모집 중</h2><small>{o.recruiting.length}개</small></div>
          {o.recruiting.length === 0 ? <p className="pc-empty">지금 모집 중인 활동이 없어요.</p> : <table className="pc-tbl"><thead><tr><th>일시</th><th>활동</th><th>확정</th><th>상태</th></tr></thead><tbody>{o.recruiting.map(r =>
            <tr key={r.id} className="go" onClick={() => { window.location.hash = '#/activity/' + r.id }}><td className="nw">{when(r.date, r.startTime)}</td><td><a className="t" href={'#/activity/' + r.id}>{r.title}</a><small>{r.category}</small></td><td className="nw">{r.confirmed}/{r.capacity}명</td>
              <td>{r.capacity - r.confirmed > 0 ? <span className="pc-tag g">{r.capacity - r.confirmed}자리 남음</span> : <span className="pc-tag amb">대기 가능</span>}</td></tr>)}</tbody></table>}</section>
        <section className="pc-pn" aria-label="참여한 사람들의 후기"><div className="pc-ph"><h2>참여한 사람들의 후기</h2><small>{o.reviews.length}개</small></div>
          {o.reviews.length === 0 ? <p className="pc-empty">아직 후기가 없어요.</p> : o.reviews.map(r => <div key={r.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--pc-line2)' }}><b>{r.title}</b><p className="pc-note">{r.author} · {r.activityTitle} · {r.date}</p></div>)}
          <p className="pc-note" style={{ padding: '10px 16px' }}>후기 전체는 Volink 앱 커뮤니티에서 볼 수 있어요.</p></section>
      </div>
      <aside className="pc-pn" style={{ width: 300, flex: 'none', padding: 20, display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 90 }}>
        <b>이 기관의 모집에 신청하려면</b>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><AppQr size={92} /><span className="pc-note">Volink 앱을 받고 로그인한 뒤 모집을 찾아 신청해 주세요</span></div>
        <a className="pc-btn lg wide" href={appUrl()}><PcIcon name="download" size={17} />앱 받기</a>
        <button type="button" className="pc-btn line wide" onClick={() => { void navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true)).catch(() => {}) }}><PcIcon name="link" />{copied ? '링크를 복사했어요' : '페이지 링크 복사'}</button>
      </aside>
    </main>
  return <div className="pc"><PublicHeader user={user} onSignOut={onSignOut} />{body}<PublicFooter /></div>
}
