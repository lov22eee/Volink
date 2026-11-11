// PC 공개 화면 (2026-11-11): 봉사 찾기 (no login), a post's page (also what a shared link opens), login, 기관 가입,
// and the page a personal account sees (Volink is used in the app).
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError, login } from '../api'
import type { LiveActivity, User } from '../api'
import { categories } from '../categories'
import { AppQr, appUrl, Loading, PcIcon, PublicFooter, PublicHeader, minutesWord, when } from './ui'

const left = (a: LiveActivity) => Math.max(0, a.capacity - a.confirmed)
const startsAt = (a: LiveActivity) => new Date(`${a.date}T${a.startTime}:00+09:00`).getTime()

function seatTag(a: LiveActivity) {
  if (a.status !== 'RECRUITING' || startsAt(a) <= Date.now()) return <span className="pc-tag">모집 마감</span>
  if (left(a) === 0) return startsAt(a) - Date.now() > 2 * 3_600_000 ? <span className="pc-tag amb">대기 가능</span> : <span className="pc-tag">모집 마감</span>
  return <span className="pc-tag g">{left(a)}자리 남음</span>
}

function AppBox() {
  return <div className="pc-pn pc-qr"><AppQr /><div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <a className="pc-btn lg" href={appUrl()}><PcIcon name="download" size={17} />앱 받기</a><span className="pc-note">휴대폰 카메라로 찍으면 바로 받을 수 있어요</span></div></div>
}

export function PublicHome({ user, onSignOut }: { user: User | null; onSignOut: () => void }) {
  const [list, setList] = useState<LiveActivity[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [field, setField] = useState('')
  const [words, setWords] = useState('')
  const [weekend, setWeekend] = useState(false)
  const [newcomer, setNewcomer] = useState(false)
  useEffect(() => { api<LiveActivity[]>('/api/activities').then(setList).catch(() => { setList([]); setFailed(true) }) }, [])
  const shown = useMemo(() => (list ?? []).filter(a => {
    if (field && a.category !== field) return false
    if (words.trim() && !(a.title + ' ' + (a.placeName ?? '')).includes(words.trim())) return false
    if (newcomer && !(a.newcomerOk === true || a.newcomerOk === 1)) return false
    if (weekend) { const day = new Date(a.date + 'T12:00:00+09:00').getUTCDay(); if (day !== 0 && day !== 6) return false }
    return true
  }), [list, field, words, weekend, newcomer])
  return <div className="pc">
    <PublicHeader user={user} current="find" onSignOut={onSignOut} />
    <main className="pc-pub">
      <aside className="pc-hero">
        <h1>우리 동네 봉사,<br />앱에서 신청해요</h1>
        <p>가까운 모집을 찾고, QR로 출석하고, 1365 기록까지 한곳에서 챙겨요.</p>
        <AppBox />
        <div className="pc-pn pc-org-cta"><PcIcon name="building" size={22} /><div style={{ flex: 1 }}><b>봉사자를 모집하는 기관이세요?</b><p className="pc-note">기관센터에서 모집글과 신청자를 관리할 수 있어요</p></div>
          <a className="pc-btn sm line" href="#/org">기관센터</a></div>
      </aside>
      <section className="pc-pn" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }} aria-label="지금 모집 중">
        <div className="pc-ph"><h2>지금 모집 중</h2><small>{list ? `${list.length}개` : ''}</small></div>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--pc-line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ flex: 1, position: 'relative' }}><span className="sr">활동 검색</span><input className="pc-in" style={{ height: 36, paddingLeft: 34 }} value={words} onChange={e => setWords(e.target.value)} placeholder="활동 이름, 장소" />
              <span style={{ position: 'absolute', left: 11, top: 10, color: 'var(--pc-mu)' }}><PcIcon name="search" /></span></label>
            <div className="pc-chips"><button type="button" aria-pressed={weekend} onClick={() => setWeekend(v => !v)}>주말</button><button type="button" aria-pressed={newcomer} onClick={() => setNewcomer(v => !v)}>처음 환영</button></div>
          </div>
          <div className="pc-chips" role="group" aria-label="분야">{['', ...categories].map(c => <button key={c || 'all'} type="button" aria-pressed={field === c} onClick={() => setField(c)}>{c || '전체'}</button>)}</div>
        </div>
        {list === null ? <Loading /> : failed ? <p className="pc-empty">모집 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>
          : shown.length === 0 ? <p className="pc-empty">조건에 맞는 모집이 없어요.</p>
          : <table className="pc-tbl"><thead><tr><th>분야</th><th>활동</th><th>일시</th><th>장소</th><th>확정</th><th>상태</th></tr></thead>
            <tbody>{shown.map(a => <tr key={a.id} className="go" onClick={() => { window.location.hash = '#/activity/' + a.id }}>
              <td><span className="pc-tag">{a.category}</span></td>
              <td><a className="t" href={'#/activity/' + a.id}>{a.title}</a>{a.activityType === 'INSTITUTION' && a.organizationName && <small>{a.organizationName}</small>}</td>
              <td className="nw">{when(a.date, a.startTime)}</td><td className="mu">{a.placeName ?? '장소 미정'}</td>
              <td className="nw">{a.confirmed}/{a.capacity}명</td><td>{seatTag(a)}</td></tr>)}</tbody></table>}
      </section>
    </main>
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
        <div className="pc-chips" style={{ gap: 6 }}><span className="pc-tag g">{a.category}</span>{a.difficulty && <span className="pc-tag">{difficultyWord[a.difficulty]}</span>}{a.placeKind && <span className="pc-tag">{placeWord[a.placeKind]}</span>}{(a.newcomerOk === true || a.newcomerOk === 1) && <span className="pc-tag g">처음 환영</span>}{a.activityType === 'INSTITUTION' && <span className="pc-tag blu">{a.organizationName ?? '기관'} 주관</span>}</div>
        <h1>{a.title}</h1>
        <div className="pc-pn" style={{ padding: '4px 16px' }}>
          <div className="pc-kv"><span>일시</span><b>{when(a.date, a.startTime)} · {minutesWord(a.durationMinutes)}</b></div>
          <div className="pc-kv"><span>장소</span><b>{[a.placeName ?? '장소 미정', a.meetingPoint].filter(Boolean).join(' · ')}</b></div>
          <div className="pc-kv"><span>모집</span><b>확정 {a.confirmed} / {a.capacity}명{a.waiting ? ` · 대기 ${a.waiting}명` : ''}</b></div>
          <div className="pc-kv" style={{ borderBottom: 0 }}><span>모집자</span><b>{a.activityType === 'INSTITUTION' ? a.organizationName : a.organizerName}{a.organizerStats ? ` · 모집 ${a.organizerStats.hosted}회 · 완료 ${a.organizerStats.finished}회` : ''}</b></div>
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
export function PcLogin({ onSession }: { onSession: (user: User) => void }) {
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
  return <div className="pc"><header className="pc-hd"><a className="pc-logo" href="#/"><i><PcIcon name="leaf" size={14} /></i>volink</a></header>
    <div className="pc-center"><form className="pc-pn pc-card" onSubmit={submit} noValidate>
      <h1>로그인</h1><p className="mu" style={{ marginTop: -6 }}>기관 담당자와 운영자 계정으로 로그인해요</p>
      <label className="pc-f"><span>이메일</span><input className="pc-in" name="email" type="email" autoComplete="username" /></label>
      <label className="pc-f"><span>비밀번호</span><input className="pc-in" name="password" type="password" autoComplete="current-password" /></label>
      {error && <p className="pc-err" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="pc-btn lg wide" disabled={busy}>{busy ? '로그인하는 중…' : '로그인'}</button>
      <div style={{ borderTop: '1px solid var(--pc-line)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5 }}>
        <div style={{ display: 'flex' }}><span className="mu">처음 오셨나요?</span><a className="pc-link" style={{ marginLeft: 'auto' }} href="#/org/signup">기관 가입 신청</a></div>
        <div style={{ display: 'flex' }}><span className="mu">봉사에 참여하려면</span><a className="pc-link" style={{ marginLeft: 'auto' }} href={appUrl()}>앱 받기</a></div></div>
    </form></div></div>
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
