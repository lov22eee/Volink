// PC 공개 화면 (2026-11-11): 봉사 찾기 (no login), a post's page (also what a shared link opens), login, 기관 가입,
// and the page a personal account sees (Volink is used in the app).
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError, login } from '../api'
import type { LiveActivity, User } from '../api'
import { categories } from '../categories'
import { AppQr, appUrl, Loading, Logo, PcIcon, PublicFooter, PublicHeader, minutesWord, when } from './ui'

const left = (a: LiveActivity) => Math.max(0, a.capacity - a.confirmed)
const startsAt = (a: LiveActivity) => new Date(`${a.date}T${a.startTime}:00+09:00`).getTime()

function seatTag(a: LiveActivity) {
  if (a.status !== 'RECRUITING' || startsAt(a) <= Date.now()) return <span className="pc-tag">모집 마감</span>
  if (left(a) === 0) return startsAt(a) - Date.now() > 2 * 3_600_000 ? <span className="pc-tag amb">대기 가능</span> : <span className="pc-tag">모집 마감</span>
  return <span className="pc-tag g">{left(a)}자리 남음</span>
}

const coverOf: Record<string, string> = { 환경: 'environment', 교육: 'education', 복지: 'welfare', '문화·예술': 'culture', 동물: 'animal', 지역사회: 'community', 기타: 'community' }
const cover = (category: string) => '/covers/' + (coverOf[category] ?? 'community') + '.jpg'

/** The app download: QR for a phone camera next to the button (the APK file on this server). */
export function AppGet() {
  return <div className="pc-get"><AppQr size={116} /><div><b>휴대폰 카메라로 찍어 앱 받기</b><span>안드로이드 · 무료</span>
    <a className="pc-btn lg" href={appUrl()}><PcIcon name="download" size={17} />앱 받기</a></div></div>
}

const features: [Parameters<typeof PcIcon>[0]['name'], string, string][] = [
  ['pin', '내 주변 봉사 찾기', '지도·날짜·분야로 찾고 바로 신청해요. 자리가 없으면 대기 신청'],
  ['qr', '현장 QR 출석', '30초마다 바뀌는 QR과 위치 확인으로 출석하고 기록이 쌓여요'],
  ['record', '1365 실적 한곳에', '1365 신청·실적과 실적확인서를 모아 함께한 시간을 봐요'],
  ['chat', '봉사 커뮤니티', '후기·질문·홍보로 이웃과 봉사 경험을 나눠요'],
]

export function PublicHome({ user, onSignOut }: { user: User | null; onSignOut: () => void }) {
  const [list, setList] = useState<LiveActivity[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [field, setField] = useState('')
  const [weekend, setWeekend] = useState(false)
  const [all, setAll] = useState(false)
  useEffect(() => { api<LiveActivity[]>('/api/activities').then(setList).catch(() => { setList([]); setFailed(true) }) }, [])
  const shown = useMemo(() => (list ?? []).filter(a => {
    if (field && a.category !== field) return false
    if (weekend) { const day = new Date(a.date + 'T12:00:00+09:00').getUTCDay(); if (day !== 0 && day !== 6) return false }
    return true
  }), [list, field, weekend])
  return <div className="pc">
    <PublicHeader user={user} current="find" onSignOut={onSignOut} />
    <section className="pc-land-hero"><div className="pc-wrap">
      <div className="pc-land-copy">
        <h1>우리 동네 봉사,<br />찾고 신청하고 기록까지<br />앱 하나로</h1>
        <p>가까운 모집을 찾아 신청하고, 현장에서 QR로 출석하고,<br />1365 실적까지 한곳에서 챙겨요.</p>
        <AppGet />
      </div>
      <div className="pc-land-phones" aria-hidden="true"><img src="/pc/app-detail.jpg" alt="" /><img src="/pc/app-mine.jpg" alt="" /></div>
    </div></section>
    <section className="pc-wrap pc-land-sec" id="pc-about"><h2>Volink로 할 수 있는 것</h2>
      <div className="pc-feat">{features.map(([icon, title, text]) => <div key={title}><span><PcIcon name={icon} size={22} /></span><b>{title}</b><p>{text}</p></div>)}</div>
    </section>
    <section className="pc-wrap pc-land-sec" aria-label="지금 모집 중">
      <div className="pc-land-h"><h2>지금 모집 중</h2>{list && list.length > 0 && <small>{list.length}개</small>}</div>
      <div className="pc-chips" role="group" aria-label="분야">{['', ...categories].map(c => <button key={c || 'all'} type="button" aria-pressed={field === c} onClick={() => setField(c)}>{c || '전체'}</button>)}
        <button type="button" aria-pressed={weekend} onClick={() => setWeekend(v => !v)}>이번 주말</button></div>
      {list === null ? <Loading /> : failed ? <p className="pc-land-empty">모집 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>
        : shown.length === 0 ? <p className="pc-land-empty">{list.length ? '조건에 맞는 모집이 없어요.' : '지금 모집 중인 활동이 없어요. 앱에서 새 모집 알림을 받아 보세요.'}</p>
        : <><div className="pc-cards">{(all ? shown : shown.slice(0, 8)).map(a => <a key={a.id} className="pc-acard" href={'#/activity/' + a.id}>
            <span className="im" style={{ backgroundImage: `url(${cover(a.category)})` }} />
            <span className="t"><small>{a.category}{a.activityType === 'INSTITUTION' && a.organizationName ? ' · ' + a.organizationName : ''}</small><b>{a.title}</b>
              <span>{when(a.date, a.startTime)} · {a.placeName ?? '장소 미정'}</span>{seatTag(a)}</span></a>)}</div>
          {!all && shown.length > 8 && <button type="button" className="pc-btn line pc-more" onClick={() => setAll(true)}>{shown.length - 8}개 더 보기</button>}</>}
    </section>
    <section className="pc-land-org"><div className="pc-wrap"><div><h2>봉사자를 모집하는 기관이세요?</h2><p>기관센터에서 모집글을 올리고 신청자·출석·기록을 PC로 관리하세요.</p></div>
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
  return <div className="pc"><PublicHeader user={user} current="find" onSignOut={onSignOut} />{body}<PublicFooter /></div>
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

export function OrgSignup({ onSession }: { onSession: (user: User) => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const d = new FormData(event.currentTarget)
    const v = (k: string) => String(d.get(k) ?? '').trim()
    const found: Record<string, string> = {}
    if (!v('organizationType')) found.organizationType = '기관 유형을 골라 주세요.'
    if (v('organization').length < 2) found.organization = '기관명을 입력해 주세요.'
    if (!/^[0-9-]{9,20}$/.test(v('organizationContact'))) found.organizationContact = '연락처는 숫자와 - 로 입력해 주세요.'
    if (!v('name')) found.name = '담당자 이름을 입력해 주세요.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) found.email = '이메일 형식을 확인해 주세요.'
    if (String(d.get('password')) !== String(d.get('passwordConfirm'))) found.passwordConfirm = '비밀번호가 서로 달라요.'
    if (!d.get('notice')) found.notice = '안내를 확인해 주세요.'
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true); setMessage('')
    try {
      await api('/api/auth/signup', 'POST', { memberType: 'INSTITUTION', name: v('name'), email: v('email'), password: String(d.get('password')), interests: [],
        organizationName: v('organization'), organizationContact: v('organizationContact'), organizationType: v('organizationType'), organizationAddress: v('address') || null,
        vmsRegistered: Boolean(v('vmsCode')), vmsCode: v('vmsCode') || null, agreedNotice: true })
      onSession(await login(v('email'), String(d.get('password'))))
      window.location.replace('#/org')
    } catch (cause) {
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length) setErrors(cause.fieldErrors)
      else setMessage(cause instanceof Error ? cause.message : '가입하지 못했어요.')
    } finally { setBusy(false) }
  }
  const err = (k: string) => errors[k] ? <em role="alert">{errors[k]}</em> : null
  const cls = (k: string) => 'pc-in' + (errors[k] ? ' bad' : '')
  return <div className="pc"><header className="pc-hd"><a className="pc-logo" href="#/"><i><PcIcon name="leaf" size={14} /></i>volink<em>기관센터</em></a><div className="pc-sp" /><span className="mu">이미 계정이 있나요? <a className="pc-link" href="#/login">로그인</a></span></header>
    <div className="pc-center"><form className="pc-pn pc-card wide" onSubmit={submit} noValidate>
      <h1>기관 가입 신청</h1><p className="mu" style={{ marginTop: -6 }}>운영자가 기관 정보를 확인한 뒤 모집을 시작할 수 있어요. 보통 1~2일 걸려요.</p>
      <h2 style={{ marginTop: 6 }}>기관 정보</h2>
      <div className="pc-two">
        <label className="pc-f"><span>기관 유형</span><select className={cls('organizationType')} name="organizationType" defaultValue=""><option value="" disabled>선택</option>{orgTypes.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>{err('organizationType')}</label>
        <label className="pc-f"><span>기관명</span><input className={cls('organization')} name="organization" maxLength={100} />{err('organization')}</label>
        <label className="pc-f"><span>대표 연락처</span><input className={cls('organizationContact')} name="organizationContact" type="tel" maxLength={20} placeholder="031-000-0000" />{err('organizationContact')}</label>
        <label className="pc-f"><span>1365 수요처 번호 <small>(있으면)</small></span><input className={cls('vmsCode')} name="vmsCode" maxLength={30} />{err('vmsCode')}</label>
      </div>
      <label className="pc-f"><span>주소 <small>(선택)</small></span><input className={cls('organizationAddress')} name="address" maxLength={200} />{err('organizationAddress')}</label>
      <h2 style={{ marginTop: 6 }}>담당자 계정</h2>
      <div className="pc-two">
        <label className="pc-f"><span>담당자 이름</span><input className={cls('name')} name="name" maxLength={40} autoComplete="name" />{err('name')}</label>
        <label className="pc-f"><span>이메일</span><input className={cls('email')} name="email" type="email" autoComplete="email" />{err('email')}</label>
        <label className="pc-f"><span>비밀번호 <small>영문·숫자 8자 이상</small></span><input className={cls('password')} name="password" type="password" autoComplete="new-password" />{err('password')}</label>
        <label className="pc-f"><span>비밀번호 확인</span><input className={cls('passwordConfirm')} name="passwordConfirm" type="password" autoComplete="new-password" />{err('passwordConfirm')}</label>
      </div>
      <label className="pc-check"><input type="checkbox" name="notice" className="pc-cb" /><span>Volink 활동 기록은 공식 봉사실적으로 인정되지 않으며 자원봉사 종합보험이 적용되지 않음을 확인합니다. 기관 연락처는 다른 회원에게 공개하지 않습니다.</span></label>{err('notice')}
      {message && <p className="pc-err" role="alert" style={{ margin: 0 }}>{message}</p>}
      <button className="pc-btn lg" disabled={busy}>{busy ? '보내는 중…' : '가입 신청하기'}</button>
    </form></div></div>
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
  return <div className="pc"><PublicHeader user={user} current="find" onSignOut={onSignOut} />{body}<PublicFooter /></div>
}
