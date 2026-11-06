// App start: nothing is shown before signing in. Login on the first screen with a 개인회원 / 기관회원 tab, signup one
// question at a time. Institution members sign up and log in with e-mail only (2026-11-06 user decision); the server
// checks the tab against the account and keeps every rule of the web (age 14+, ADMIN never selectable, 기관 확인 by an admin).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError, completeSocial, finishSocial, login } from '../api'
import { GoogleMark, KakaoMark, providerName, socialError, startSocial, useProviders } from '../social'
import type { Provider } from '../social'
import { showToast } from '../App'
import type { User } from '../api'
import { ageOn, signupRules } from '../rules'
import { ActionBar, MIcon, Sheet, WheelColumn, Wheels, TextInput } from './ui'
import { askNotifications } from './native'
import { searchPlaces } from '../placePicker'
import type { PlaceResult } from '../placePicker'
import { categories } from '../categories'
import { fieldIcon } from './cards'

type Kind = 'GENERAL' | 'INSTITUTION'
const kindFromHash = (): Kind => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('type') === 'institution' ? 'INSTITUTION' : 'GENERAL'

export function Login({ onSession }: { onSession: (user: User) => void }) {
  const providers = useProviders()
  const [kind, setKind] = useState<Kind>(kindFromHash)
  const social = (provider: Provider) => providers[provider] ? startSocial(provider) : showToast(providerName[provider] + ' 로그인은 준비 중이에요', '지금은 이메일로 로그인해 주세요')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState(() => socialError(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('oauth')))
  const [busy, setBusy] = useState(false)
  // The app returns here from the phone browser (volink://login?oauth=…) while this screen is already open.
  useEffect(() => {
    const read = () => { const code = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('oauth'); if (code) setError(socialError(code)) }
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!email.trim() || !password) { setError('이메일과 비밀번호를 입력해 주세요.'); return }
    setBusy(true)
    setError('')
    try {
      onSession(await login(email.trim(), password, kind))
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === 'MEMBER_TYPE_MISMATCH' ? cause.message
        : cause instanceof ApiError && cause.status === 429 ? cause.message
        : cause instanceof ApiError && cause.status < 500 ? '이메일 또는 비밀번호를 다시 확인해 주세요.' : '연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }
  return <main className="m-splash" aria-label="로그인">
    <div className="m-splash-brand">
      <span className="m-logo"><MIcon name="leaf" size={44} /></span>
      <strong className="m-word">volink<i>.</i></strong>
      <p>우리 동네에서 시작하는 작은 변화</p>
    </div>
    <form className="m-splash-form" onSubmit={submit} noValidate>
      <div className="m-seg wide m-kind" role="tablist" aria-label="회원 유형">{([['GENERAL', '개인회원'], ['INSTITUTION', '기관회원']] as [Kind, string][]).map(([key, label]) =>
        <button key={key} type="button" role="tab" aria-selected={kind === key} className={kind === key ? 'on' : ''} onClick={() => { setKind(key); setError('') }}>{label}</button>)}</div>
      <label className="m-input m-reveal with-icon"><MIcon name="mail" size={20} /><span className="sr-only">이메일</span>
        <TextInput type="email" inputMode="email" autoComplete="username" placeholder="이메일" aria-label="이메일" value={email} onChange={event => { setEmail(event.target.value); setError('') }} enterKeyHint="next" /></label>
      <label className="m-input m-reveal with-icon"><MIcon name="lock" size={20} /><span className="sr-only">비밀번호</span>
        <TextInput type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="비밀번호" aria-label="비밀번호" value={password} onChange={event => { setPassword(event.target.value); setError('') }} enterKeyHint="go" />
        <button type="button" className="m-peek" aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={() => setShow(!show)}><MIcon name={show ? 'eyeOff' : 'eye'} size={20} /></button></label>
      {error && <p className="m-err" role="alert">{error}</p>}
      <button className="m-btn" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
      <p className="m-splash-links">처음이신가요? <a href={kind === 'INSTITUTION' ? '#/signup?type=institution' : '#/signup'}>{kind === 'INSTITUTION' ? '기관회원 가입' : '회원가입'}</a></p>
      {kind === 'GENERAL' ? <div className="m-social" role="group" aria-label="간편 로그인">
        <span className="m-social-line">간편 로그인 · 개인 회원</span>
        <div className="m-social-row">
          <button type="button" className="m-social-btn kakao" aria-label="카카오로 로그인" onClick={() => social('kakao')}><KakaoMark size={26} /></button>
          <button type="button" className="m-social-btn google" aria-label="구글로 로그인" onClick={() => social('google')}><GoogleMark size={24} /></button>
        </div>
      </div> : <p className="m-social-line m-org-only">기관회원은 이메일로만 로그인할 수 있어요</p>}
      <p className="m-fine">공식 봉사실적·자원봉사 종합보험은 1365 활동에만 해당돼요.</p>
      {/* 임시 (한글 입력 확인이 끝나면 지움): 한글 입력 진단 화면 */}
      <a className="m-fine m-lab-link" href="#/ime-lab">입력 진단</a>
    </form>
  </main>
}

const todayYear = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date()))
const years = Array.from({ length: 90 }, (_, i) => todayYear - 10 - i)
const months = Array.from({ length: 12 }, (_, i) => i + 1)
const pad = (n: number) => String(n).padStart(2, '0')

type Birth = { y: number; m: number; d: number }
const birthIso = (b: Birth) => `${b.y}-${pad(b.m)}-${pad(b.d)}`

/** The birth date right on the screen (no sheet): three wheels and the age under them. */
function BirthWheel({ value, onChange }: { value: Birth; onChange: (b: Birth) => void }) {
  const days = useMemo(() => Array.from({ length: new Date(value.y, value.m, 0).getDate() }, (_, i) => i + 1), [value.y, value.m])
  const set = (part: Partial<Birth>) => { const next = { ...value, ...part }; onChange({ ...next, d: Math.min(next.d, new Date(next.y, next.m, 0).getDate()) }) }
  const age = ageOn(birthIso(value), new Date())
  return <div className="m-birth">
    <Wheels>
      <WheelColumn label="년" items={years} value={value.y} render={y => y + '년'} onChange={y => set({ y })} />
      <WheelColumn label="월" items={months} value={value.m} render={m => m + '월'} onChange={m => set({ m })} />
      <WheelColumn label="일" items={days} value={Math.min(value.d, days.length)} render={d => d + '일'} onChange={d => set({ d })} />
    </Wheels>
    <p className={'m-help center' + (age < signupRules.minimumAge ? ' m-err' : '')} role={age < signupRules.minimumAge ? 'alert' : undefined}>
      만 {age}세{age < signupRules.minimumAge ? ` · 만 ${signupRules.minimumAge}세 이상만 가입할 수 있어요` : ''}</p>
  </div>
}

/** Agreements first (2026-11-06): every one is required; the same list for e-mail and Kakao / Google signups. */
const consents = {
  GENERAL: ['만 14세 이상이에요', 'Volink 이용약관에 동의해요', '개인정보 처리방침에 동의해요', 'Volink 활동은 공식 봉사실적·자원봉사 종합보험이 아님을 이해해요', '연락처는 서로 공개하지 않아요'],
  INSTITUTION: ['담당자는 만 14세 이상이에요', 'Volink 이용약관에 동의해요', '개인정보 처리방침에 동의해요', '기관 정보가 사실이고, 관리자 확인에 동의해요', 'Volink 활동은 공식 봉사실적·자원봉사 종합보험이 아님을 이해해요'],
}
function Terms({ items, value, onChange }: { items: string[]; value: boolean[]; onChange: (next: boolean[]) => void }) {
  const all = value.every(Boolean)
  return <div className="m-terms">
    <label className="m-check all"><input type="checkbox" checked={all} onChange={event => onChange(items.map(() => event.target.checked))} /><span className="m-box" /><strong>모두 동의</strong></label>
    <div className="m-terms-box">{items.map((item, i) => <label key={item} className="m-check"><input type="checkbox" checked={value[i]}
      onChange={event => onChange(value.map((v, k) => k === i ? event.target.checked : v))} /><span className="m-box" /><span>[필수] {item}</span></label>)}</div>
  </div>
}

/** One question per screen: back, progress bar, a two-line question, the answer, one big button at the bottom. */
function Flow({ title, index, total, heading, sub, onBack, onSubmit, footer, children }: { title: string; index: number; total: number; heading: string; sub?: string
  onBack: () => void; onSubmit: () => void; footer: React.ReactNode; children: React.ReactNode }) {
  return <div className="m-screen m-signup m-ask m-flow">
    <header className="m-top"><button type="button" className="m-icon-btn" aria-label="뒤로" onClick={onBack}><MIcon name="back" /></button><h1 className="m-title">{title}</h1><span className="m-top-actions" /></header>
    <div className="m-progress" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={index + 1} aria-label="가입 단계"><i style={{ width: (index + 1) / total * 100 + '%' }} /></div>
    <form className="m-body m-form" onSubmit={event => { event.preventDefault(); onSubmit() }} noValidate>
      <div key={heading} className="m-q"><h2 className="m-flow-h">{heading}</h2>{sub && <p className="m-help">{sub}</p>}{children}</div>
      <ActionBar>{footer}</ActionBar>
    </form>
  </div>
}

export const orgTypes: [string, string][] = [['VOLUNTEER_CENTER', '자원봉사센터'], ['WELFARE', '복지관·복지시설'], ['SCHOOL', '학교·교육기관'], ['NONPROFIT', '비영리단체'], ['PUBLIC', '공공기관'], ['OTHER', '기타']]

/** 기관 주소: the same place search as 활동 만들기 (public, works before login), or typed by hand. */
function AddressPicker({ value, onChange }: { value: string; onChange: (address: string) => void }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<PlaceResult[] | null>(null)
  const [manual, setManual] = useState(false)
  useEffect(() => {
    const q = query.trim()
    if (manual || q.length < 2) { setItems(null); return }
    let live = true
    const t = window.setTimeout(() => searchPlaces(q).then(result => { if (live) setItems(result.items.slice(0, 5)) }).catch(() => { if (live) setItems([]) }), 300)
    return () => { live = false; window.clearTimeout(t) }
  }, [query, manual])
  if (manual) return <>
    <TextInput className="m-input big" autoFocus placeholder="예: 경기 양주시 부흥로 1533" aria-label="기관 주소" maxLength={200} value={value} onChange={event => onChange(event.target.value)} enterKeyHint="next" />
    <button type="button" className="m-text-btn m-flow-alt" onClick={() => { setManual(false); onChange('') }}>장소 검색으로 찾기</button>
  </>
  return <>
    <span className="m-input big with-icon"><MIcon name="search" size={20} /><TextInput autoFocus placeholder="기관 이름이나 주소로 검색" aria-label="기관 주소 검색" value={query} onChange={event => setQuery(event.target.value)} enterKeyHint="search" /></span>
    {items && items.length > 0 && <ul className="m-addr">{items.map(item => { const address = item.address || item.name; const on = value === address
      return <li key={(item.kakaoId ?? item.placeId ?? '') + item.name}><button type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => onChange(address)}>
        <MIcon name="pin" size={18} /><span><b>{item.name}</b><small>{item.address}</small></span>{on && <MIcon name="check" size={18} />}</button></li> })}</ul>}
    {items && items.length === 0 && <p className="m-help">검색 결과가 없어요.</p>}
    <button type="button" className="m-text-btn m-flow-alt" onClick={() => { setManual(true); onChange('') }}>찾는 곳이 없나요? 직접 입력할게요</button>
  </>
}

export function Signup({ onSession, institution = false }: { onSession: (user: User) => void; institution?: boolean }) {
  type Step = 'terms' | 'email' | 'password' | 'name' | 'birth' | 'interests' | 'orgType' | 'org' | 'address' | 'contact' | 'vms'
  // 기관회원: the manager's account (e-mail, password, name, birth: the same rules) and then the organization; an admin
  // confirms it (기관 확인) before institution activities open. Interests are for personal members.
  const order: Step[] = institution ? ['terms', 'email', 'password', 'name', 'birth', 'orgType', 'org', 'address', 'contact', 'vms'] : ['terms', 'email', 'password', 'name', 'birth', 'interests']
  const items = consents[institution ? 'INSTITUTION' : 'GENERAL']
  const [step, setStep] = useState<Step>('terms')
  const [agreed, setAgreed] = useState<boolean[]>(() => items.map(() => false))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [name, setName] = useState('')
  const [birth, setBirth] = useState<Birth>({ y: todayYear - 20, m: 1, d: 1 })
  const [interests, setInterests] = useState<string[]>([])
  const [orgType, setOrgType] = useState('')
  const [org, setOrg] = useState('')
  const [address, setAddress] = useState('')
  const [contact, setContact] = useState('')
  const [vms, setVms] = useState<boolean | null>(null)
  const [vmsCode, setVmsCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().length <= 254
  const rules = [
    { label: `${signupRules.passwordMin}자 이상`, ok: password.length >= signupRules.passwordMin && password.length <= signupRules.passwordMax },
    { label: '영문', ok: /[A-Za-z]/.test(password) },
    { label: '숫자', ok: /\d/.test(password) },
  ]
  const passwordOk = rules.every(rule => rule.ok)
  const confirmOk = confirm.length > 0 && confirm === password
  const ageOk = ageOn(birthIso(birth), new Date()) >= signupRules.minimumAge
  const orgOk = org.trim().length >= 2 && org.trim().length <= 100
  const contactOk = /^[0-9-]{9,20}$/.test(contact.trim())
  const vmsCodeOk = !vmsCode.trim() || /^[0-9A-Za-z-]{1,30}$/.test(vmsCode.trim())
  const ok: Record<Step, boolean> = { terms: agreed.every(Boolean), email: emailOk, password: passwordOk && confirmOk, name: name.trim().length >= 1 && name.trim().length <= signupRules.nameMax,
    birth: ageOk, interests: true, orgType: Boolean(orgType), org: orgOk, address: address.trim().length >= 2, contact: contactOk, vms: vms !== null && vmsCodeOk }
  const index = order.indexOf(step)
  const last = index === order.length - 1

  async function finish() {
    setBusy(true)
    setError('')
    try {
      await api('/api/auth/signup', 'POST', institution
        ? { memberType: 'INSTITUTION', name: name.trim(), email: email.trim(), password, birthDate: birthIso(birth), interests: [], agreedNotice: true,
          organizationName: org.trim(), organizationContact: contact.trim(), organizationType: orgType, organizationAddress: address.trim(), vmsRegistered: vms, vmsCode: vms ? vmsCode.trim() : '' }
        : { memberType: 'GENERAL', name: name.trim(), email: email.trim(), password, birthDate: birthIso(birth), interests, agreedNotice: true })
      if (institution) try { sessionStorage.setItem('volink.orgAsk', '1') } catch { /* private mode */ }
      onSession(await login(email.trim(), password, institution ? 'INSTITUTION' : 'GENERAL'))
      window.location.hash = institution ? '#/home' : '#/welcome'
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'EMAIL_TAKEN') { setStep('email'); setError('이미 가입한 이메일이에요. 로그인하거나 다른 이메일을 써 주세요.') }
      else if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length) setError(Object.values(cause.fieldErrors)[0])
      else setError(cause instanceof Error ? cause.message : '가입하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }
  function next() {
    if (!ok[step] || busy) return
    setError('')
    if (last) void finish()
    else setStep(order[index + 1])
  }
  const back = () => index === 0 ? (window.location.hash = institution ? '#/login?type=institution' : '#/login') : (setError(''), setStep(order[index - 1]))
  const headings: Record<Step, string> = {
    terms: institution ? '기관회원으로 시작하기 전에\n확인해 주세요' : 'Volink를 시작하기 전에\n확인해 주세요', email: institution ? '담당자 이메일을\n알려 주세요' : '이메일을\n알려 주세요',
    password: '비밀번호를\n정해 주세요', name: institution ? '담당자 이름을\n알려 주세요' : '이름을\n알려 주세요', birth: institution ? '담당자 생년월일을\n알려 주세요' : '생년월일을\n알려 주세요',
    interests: '어떤 봉사에\n관심 있나요?', orgType: '어떤 기관인가요?', org: '기관 이름을\n알려 주세요', address: '기관 주소를\n알려 주세요', contact: '기관 대표 연락처를\n알려 주세요', vms: '1365에 등록된\n수요처인가요?',
  }
  const subs: Partial<Record<Step, string>> = {
    email: institution ? '기관 확인 결과를 이 계정으로 알려 드려요.' : undefined, name: institution ? '관리자 확인에만 써요. 참가자에게는 기관 이름으로 보여요.' : '참가자에게는 가운데 글자를 가려서 보여 줘요.',
    interests: `${signupRules.maxInterests}개까지 고를 수 있어요. 나중에 마이에서 바꿀 수 있어요.`, contact: '관리자가 기관을 확인할 때만 써요. 참가자에게는 보이지 않아요.',
    vms: '확인이 빨라져요. 증빙 서류 올리기는 다음 업데이트에서 열려요.',
  }
  const label = busy ? (institution ? '제출하는 중…' : '가입하는 중…') : last ? (institution ? '제출하기' : interests.length ? '가입하고 시작하기' : '나중에 고르고 가입하기') : '다음'

  return <Flow title={institution ? '기관회원 가입' : '회원가입'} index={index} total={order.length} heading={headings[step]} sub={subs[step]} onBack={back} onSubmit={next}
    footer={<>{error && <p className="m-err m-flow-err" role="alert">{error}</p>}<button className="m-btn" disabled={!ok[step] || busy}>{label}</button></>}>
    {step === 'terms' && <Terms items={items} value={agreed} onChange={setAgreed} />}
    {step === 'email' && <>
      <TextInput className="m-input big" type="email" inputMode="email" autoComplete="email" placeholder="example@email.com" aria-label="이메일" autoFocus value={email}
        onChange={event => { setEmail(event.target.value); setError('') }} enterKeyHint="next" />
      {email && !emailOk && <span className="m-err">이메일 형식을 확인해 주세요.</span>}
    </>}
    {step === 'password' && <>
      <span className="m-input big with-peek">
        <TextInput type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="영문·숫자 포함 8자 이상" aria-label="비밀번호" autoFocus value={password} onChange={event => setPassword(event.target.value)} enterKeyHint="next" />
        <button type="button" className="m-peek" aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={() => setShow(!show)}><MIcon name={show ? 'eyeOff' : 'eye'} size={20} /></button></span>
      <span className="m-rules">{rules.map(rule => <span key={rule.label} className={'m-rule' + (rule.ok ? ' ok' : '')}>{rule.ok && <MIcon name="check" size={13} />}{rule.label}</span>)}</span>
      {passwordOk && <div className="m-q-more">
        <TextInput className={'m-input big' + (confirm && !confirmOk ? ' bad' : '')} type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="한 번 더 입력" aria-label="비밀번호 확인" value={confirm}
          onChange={event => setConfirm(event.target.value)} enterKeyHint="done" />
        {confirm && !confirmOk && <span className="m-err">비밀번호가 달라요.</span>}</div>}
    </>}
    {step === 'name' && <TextInput className="m-input big" autoComplete="name" placeholder="이름" aria-label="이름" autoFocus maxLength={signupRules.nameMax} value={name} onChange={event => setName(event.target.value)} enterKeyHint="next" />}
    {step === 'birth' && <BirthWheel value={birth} onChange={setBirth} />}
    {step === 'interests' && <InterestPicker value={interests} onChange={setInterests} />}
    {step === 'orgType' && <div className="m-chips wrap m-flow-chips">{orgTypes.map(([key, text]) => <button type="button" key={key} className={'m-chip' + (orgType === key ? ' on' : '')} aria-pressed={orgType === key} onClick={() => setOrgType(key)}>{text}</button>)}</div>}
    {step === 'org' && <><TextInput className="m-input big" autoComplete="organization" placeholder="예: 양주시 자원봉사센터" aria-label="기관명" autoFocus maxLength={100} value={org} onChange={event => { setOrg(event.target.value); setError('') }} enterKeyHint="next" />
      {org && !orgOk && <span className="m-err">기관명은 2~100자로 적어 주세요.</span>}</>}
    {step === 'address' && <AddressPicker value={address} onChange={setAddress} />}
    {step === 'contact' && <><TextInput className="m-input big" type="tel" inputMode="tel" autoComplete="tel" placeholder="예: 031-000-0000" aria-label="기관 연락처" autoFocus maxLength={20} value={contact} onChange={event => { setContact(event.target.value); setError('') }} enterKeyHint="done" />
      {contact && !contactOk && <span className="m-err">숫자와 - 로 9~20자 적어 주세요.</span>}</>}
    {step === 'vms' && <>
      <div className="m-two m-flow-pick"><button type="button" className={'m-type-card' + (vms === true ? ' on' : '')} aria-pressed={vms === true} onClick={() => setVms(true)}>네, 등록돼 있어요</button>
        <button type="button" className={'m-type-card' + (vms === false ? ' on' : '')} aria-pressed={vms === false} onClick={() => setVms(false)}>아니요</button></div>
      {vms && <><TextInput className={'m-input big' + (vmsCodeOk ? '' : ' bad')} placeholder="1365 수요처 번호 (선택)" aria-label="1365 수요처 번호" maxLength={30} value={vmsCode} onChange={event => setVmsCode(event.target.value)} enterKeyHint="done" />
        {!vmsCodeOk && <span className="m-err">영문·숫자·- 로 적어 주세요.</span>}</>}
    </>}
  </Flow>
}

/**
 * 기관회원 before 기관 확인 (PENDING), after a refusal (REJECTED) or while suspended: only this screen (user decision
 * 2026-11-06). The server decides the status; 다시 확인 reads it again and an approved organization goes on to the app.
 */
export function OrgReview({ user, onRefresh, onSignOut }: { user: User; onRefresh: (quiet?: boolean) => Promise<void>; onSignOut: () => void }) {
  const [busy, setBusy] = useState(false)
  // Right after the 기관회원 signup (once): may we tell you when the review is done? Then the phone's own prompt.
  const [ask, setAsk] = useState(() => { try { const on = sessionStorage.getItem('volink.orgAsk') === '1'; sessionStorage.removeItem('volink.orgAsk'); return on } catch { return false } })
  // Coming back to the app (for example from the push): read the status again.
  useEffect(() => {
    const back = () => { if (!document.hidden) void onRefresh(true).catch(() => {}) }
    document.addEventListener('visibilitychange', back)
    return () => document.removeEventListener('visibilitychange', back)
  }, [onRefresh])
  const org = user.organization
  const state = org?.status === 'REJECTED' ? { tone: 'bad', icon: 'alert' as const, title: '기관 확인이 반려됐어요', text: org.rejectReason ? '반려 사유: ' + org.rejectReason : '반려 사유를 확인하지 못했어요.' }
    : org?.status === 'SUSPENDED' ? { tone: 'bad', icon: 'alert' as const, title: '이용이 멈춘 기관이에요', text: '자세한 내용은 Volink 관리자에게 문의해 주세요.' }
    : { tone: 'wait', icon: 'clock' as const, title: '기관 확인을 기다리고 있어요', text: '관리자가 기관 정보를 확인하면 기관 주관 활동을 열 수 있어요. 보통 하루 안에 확인해요.' }
  return <main className="m-splash m-org-review" aria-label="기관 확인 현황">
    <div className="m-splash-brand">
      <span className={'m-org-ico ' + state.tone}><MIcon name={state.icon} size={36} /></span>
      <h1 className="m-h2">{state.title}</h1>
      <p>{state.text}</p>
    </div>
    <dl className="m-org-facts">
      <div><dt>기관명</dt><dd>{org?.name ?? '-'}</dd></div>
      <div><dt>담당자</dt><dd>{user.name}</dd></div>
      <div><dt>상태</dt><dd>{org?.status === 'REJECTED' ? '반려' : org?.status === 'SUSPENDED' ? '이용 중지' : '확인 대기'}</dd></div>
    </dl>
    <div className="m-org-actions">
      <button type="button" className="m-btn" disabled={busy} onClick={async () => { setBusy(true); try { await onRefresh() } finally { setBusy(false) } }}>{busy ? '확인하는 중…' : '다시 확인하기'}</button>
      <button type="button" className="m-btn line" onClick={onSignOut}>로그아웃</button>
    </div>
    {ask && <Sheet title="기관 확인이 끝나면 알려 드릴까요?" onClose={() => setAsk(false)} footer={<div className="m-org-ask">
      <button type="button" className="m-btn" onClick={async () => { const on = await askNotifications(); setAsk(false); showToast(on ? '확인이 끝나면 알림으로 알려 드릴게요' : '알림이 꺼져 있어요', on ? '' : '휴대폰 설정에서 Volink 알림을 켤 수 있어요') }}>알림 받기</button>
      <button type="button" className="m-btn line" onClick={() => setAsk(false)}>허용하지 않기</button></div>}>
      <p className="m-help">관리자가 기관 정보를 확인하면 바로 알림을 보내 드려요. 허용하지 않아도 이 화면에서 언제든 다시 확인할 수 있어요.</p>
    </Sheet>}
  </main>
}

/** Back from Kakao / Google: the one-time code becomes the session. */
export function SocialDone({ onSession }: { onSession: (user: User) => void }) {
  const [error, setError] = useState('')
  const once = useRef(false)
  useEffect(() => {
    // The code works once; React may run this effect twice in development.
    if (once.current) return
    once.current = true
    const code = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('code')
    if (!code) { setError('로그인 정보가 없어요.'); return }
    finishSocial(code).then(onSession).catch(cause => setError(cause instanceof Error ? cause.message : '로그인하지 못했어요.'))
  }, [onSession])
  return <main className="m-splash" aria-label="로그인"><div className="m-splash-brand"><span className="m-logo"><MIcon name="leaf" size={44} /></span>
    {error ? <><p>{error}</p><a className="m-btn line" href="#/login">로그인으로</a></> : <p>로그인하는 중이에요…</p>}</div></main>
}

/** First Kakao / Google login in the app: name → birth date (14+) one at a time, then the notice in a sheet. */
export function SocialSignup({ onSession }: { onSession: (user: User) => void }) {
  const query = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const provider = (query.get('provider') ?? 'kakao') as Provider
  type Step = 'terms' | 'name' | 'birth' | 'interests'
  const order: Step[] = ['terms', 'name', 'birth', 'interests']
  const items = consents.GENERAL
  const [step, setStep] = useState<Step>('terms')
  const [agreed, setAgreed] = useState<boolean[]>(() => items.map(() => false))
  const [name, setName] = useState(query.get('name') ?? '')
  const [birth, setBirth] = useState<Birth>({ y: todayYear - 20, m: 1, d: 1 })
  const [interests, setInterests] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ageOk = ageOn(birthIso(birth), new Date()) >= signupRules.minimumAge
  const ok: Record<Step, boolean> = { terms: agreed.every(Boolean), name: name.trim().length >= 1 && name.trim().length <= signupRules.nameMax, birth: ageOk, interests: true }
  const index = order.indexOf(step)
  const last = index === order.length - 1
  async function finish() {
    setBusy(true)
    setError('')
    try {
      onSession(await completeSocial({ ticket: query.get('ticket') ?? '', name: name.trim(), birthDate: birthIso(birth), interests, agreedNotice: true }))
      window.location.hash = '#/welcome'
    } catch (cause) {
      setError(cause instanceof ApiError ? (Object.values(cause.fieldErrors)[0] ?? cause.message) : '가입하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }
  const headings: Record<Step, string> = { terms: 'Volink를 시작하기 전에\n확인해 주세요', name: '이름을\n알려 주세요', birth: '생년월일을\n알려 주세요', interests: '어떤 봉사에\n관심 있나요?' }
  const subs: Partial<Record<Step, string>> = { terms: '간편 로그인은 개인 회원으로 가입돼요.', name: providerName[provider] + '에서 받은 이름이에요. 고쳐도 돼요.', interests: `${signupRules.maxInterests}개까지 고를 수 있어요. 나중에 마이에서 바꿀 수 있어요.` }
  return <Flow title={providerName[provider] + '로 시작하기'} index={index} total={order.length} heading={headings[step]} sub={subs[step]}
    onBack={() => index === 0 ? (window.location.hash = '#/login') : setStep(order[index - 1])}
    onSubmit={() => { if (!ok[step] || busy) return; if (last) void finish(); else setStep(order[index + 1]) }}
    footer={<>{error && <p className="m-err m-flow-err" role="alert">{error}</p>}<button className="m-btn" disabled={!ok[step] || busy}>{busy ? '가입하는 중…' : last ? (interests.length ? '가입하고 시작하기' : '나중에 고르고 가입하기') : '다음'}</button></>}>
    {step === 'terms' && <Terms items={items} value={agreed} onChange={setAgreed} />}
    {step === 'name' && <TextInput className="m-input big" aria-label="이름" autoFocus maxLength={signupRules.nameMax} value={name} onChange={event => setName(event.target.value)} enterKeyHint="next" />}
    {step === 'birth' && <BirthWheel value={birth} onChange={setBirth} />}
    {step === 'interests' && <InterestPicker value={interests} onChange={setInterests} />}
  </Flow>
}

function InterestPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  return <>
    <div className="m-tiles">{categories.map(c => { const on = value.includes(c)
      return <button type="button" key={c} className={'m-tile' + (on ? ' on' : '')} aria-pressed={on}
        onClick={() => onChange(on ? value.filter(x => x !== c) : value.length < signupRules.maxInterests ? [...value, c] : value)}><MIcon name={fieldIcon[c] ?? 'sprout'} size={24} />{c}</button> })}</div>
  </>
}
