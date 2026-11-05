// App start: nothing is shown before signing in. Login on the first screen, signup in three steps.
// Institution members sign up on the PC web site (documents and a contact person are needed), so the app signs up
// general members only (a grey line on step 1 says so; there is no type choice). The server rules are the same as on the web (age 14+, ADMIN never selectable).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError, completeSocial, finishSocial, login } from '../api'
import { GoogleMark, KakaoMark, providerName, socialError, startSocial, useProviders } from '../social'
import type { Provider } from '../social'
import { showToast } from '../App'
import type { User } from '../api'
import { ageOn, signupRules } from '../rules'
import { ActionBar, MIcon, Sheet, WheelColumn, Wheels, TextInput } from './ui'
import { categories } from '../categories'
import { fieldIcon } from './cards'

export function Login({ onSession }: { onSession: (user: User) => void }) {
  const providers = useProviders()
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
      onSession(await login(email.trim(), password))
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status < 500 ? '이메일 또는 비밀번호를 다시 확인해 주세요.' : '연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.')
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
      <label className="m-input m-reveal with-icon"><MIcon name="mail" size={20} /><span className="sr-only">이메일</span>
        <TextInput type="email" inputMode="email" autoComplete="username" placeholder="이메일" aria-label="이메일" value={email} onChange={event => { setEmail(event.target.value); setError('') }} enterKeyHint="next" /></label>
      <label className="m-input m-reveal with-icon"><MIcon name="lock" size={20} /><span className="sr-only">비밀번호</span>
        <TextInput type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="비밀번호" aria-label="비밀번호" value={password} onChange={event => { setPassword(event.target.value); setError('') }} enterKeyHint="go" />
        <button type="button" className="m-peek" aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={() => setShow(!show)}><MIcon name={show ? 'eyeOff' : 'eye'} size={20} /></button></label>
      {error && <p className="m-err" role="alert">{error}</p>}
      <button className="m-btn" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
      <p className="m-splash-links">처음이신가요? <a href="#/signup">회원가입</a></p>
      {/* Social login is not connected yet (needs Kakao/Google app keys and server OAuth): the buttons only say so. */}
      <div className="m-social" role="group" aria-label="간편 로그인">
        <span className="m-social-line">간편 로그인 · 개인 회원</span>
        <div className="m-social-row">
          <button type="button" className="m-social-btn kakao" aria-label="카카오로 로그인" onClick={() => social('kakao')}><KakaoMark size={26} /></button>
          <button type="button" className="m-social-btn google" aria-label="구글로 로그인" onClick={() => social('google')}><GoogleMark size={24} /></button>
        </div>
      </div>
      <p className="m-fine">공식 봉사실적·자원봉사 종합보험은 1365 활동에만 해당돼요.</p>
    </form>
  </main>
}

const todayYear = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date()))
const years = Array.from({ length: 90 }, (_, i) => todayYear - 10 - i)
const months = Array.from({ length: 12 }, (_, i) => i + 1)
const pad = (n: number) => String(n).padStart(2, '0')

type Birth = { y: number; m: number; d: number }
const birthText = (b: Birth | null) => b ? `${b.y}년 ${b.m}월 ${b.d}일` : ''

/** The birth-date wheel, shared by both signups. */
function BirthSheet({ value, onPick, onClose }: { value: Birth | null; onPick: (b: Birth) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Birth>(value ?? { y: 2003, m: 1, d: 1 })
  const days = useMemo(() => Array.from({ length: new Date(draft.y, draft.m, 0).getDate() }, (_, i) => i + 1), [draft.y, draft.m])
  return <Sheet title="생년월일" onClose={onClose} footer={<button type="button" className="m-btn" onClick={() => onPick({ ...draft, d: Math.min(draft.d, days.length) })}>완료</button>}>
    <Wheels>
      <WheelColumn label="년" items={years} value={draft.y} render={y => y + '년'} onChange={y => setDraft(v => ({ ...v, y }))} />
      <WheelColumn label="월" items={months} value={draft.m} render={m => m + '월'} onChange={m => setDraft(v => ({ ...v, m }))} />
      <WheelColumn label="일" items={days} value={Math.min(draft.d, days.length)} render={d => d + '일'} onChange={d => setDraft(v => ({ ...v, d }))} />
    </Wheels>
  </Sheet>
}

/** An answer already given: small, below the current question, tap to change it. */
function Answered({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return <button type="button" className="m-answered" onClick={onEdit} aria-label={label + ' 고치기'}><small>{label}</small><span>{value}</span><em>고치기</em></button>
}

/**
 * Signup one question at a time (like the community start): email → password (+ confirm) → name → birth date →
 * the agreements in a bottom sheet. Earlier answers stay below the question and can be changed by tapping them.
 */
export function Signup({ onSession }: { onSession: (user: User) => void }) {
  type Step = 'email' | 'password' | 'name' | 'birth' | 'interests'
  const order: Step[] = ['email', 'password', 'name', 'birth', 'interests']
  const [interests, setInterests] = useState<string[]>([])
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [name, setName] = useState('')
  const [birth, setBirth] = useState<Birth | null>(null)
  const [picking, setPicking] = useState(false)
  const [terms, setTerms] = useState(false)
  const [agreeNotice, setAgreeNotice] = useState(false)
  const [agreeContact, setAgreeContact] = useState(false)
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
  const birthDate = birth ? `${birth.y}-${pad(birth.m)}-${pad(birth.d)}` : ''
  const age = birth ? ageOn(birthDate, new Date()) : null
  const ageOk = age !== null && age >= signupRules.minimumAge
  const nameOk = name.trim().length >= 1 && name.trim().length <= signupRules.nameMax
  const ok: Record<Step, boolean> = { email: emailOk, password: passwordOk && confirmOk, name: nameOk, birth: ageOk, interests: true }
  const index = order.indexOf(step)

  // The birth wheel opens by itself when that question comes up.
  useEffect(() => { if (step === 'birth' && !birth) setPicking(true) }, [step, birth])

  async function finish() {
    setBusy(true)
    setError('')
    try {
      // Interests are optional (0~3): 나중에 할게요 leaves them for 마이 > 관심 분야.
      await api('/api/auth/signup', 'POST', { memberType: 'GENERAL', name: name.trim(), email: email.trim(), password, birthDate, interests, agreedNotice: true })
      onSession(await login(email.trim(), password))
      window.location.hash = '#/welcome'
    } catch (cause) {
      setTerms(false)
      if (cause instanceof ApiError && cause.code === 'EMAIL_TAKEN') { setStep('email'); setError('이미 가입한 이메일이에요. 로그인하거나 다른 이메일을 써 주세요.') }
      else if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length) setError(Object.values(cause.fieldErrors)[0])
      else setError(cause instanceof Error ? cause.message : '가입하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }
  function next(event?: FormEvent) {
    event?.preventDefault()
    if (!ok[step]) return
    setError('')
    // Back after changing an earlier answer: go on to the first question not yet answered well.
    const pending = order.find(s => !ok[s])
    if (pending) setStep(pending)
    else if (step !== 'interests' && index < order.length - 1) setStep(order[index + 1])
    else setTerms(true)
  }
  const back = () => index === 0 ? (window.location.hash = '#/login') : setStep(order[index - 1])
  const titles: Record<Step, string> = { email: '이메일을 알려 주세요', password: '비밀번호를 정해 주세요', name: '어떻게 불러 드릴까요?', birth: '생년월일을 알려 주세요', interests: '관심 있는 봉사를 골라 주세요' }
  const answered = order.slice(0, index).reverse()

  return <div className="m-screen m-signup m-ask">
    <header className="m-top"><button type="button" className="m-icon-btn" aria-label="뒤로" onClick={back}><MIcon name="back" /></button><h1 className="m-title">회원가입</h1><span className="m-top-actions" /></header>
    <div className="m-progress" role="progressbar" aria-valuemin={1} aria-valuemax={5} aria-valuenow={index + 1} aria-label="가입 단계"><i style={{ width: (index + 1) * 20 + '%' }} /></div>
    <form className="m-body m-form" onSubmit={next} noValidate>
      <div key={step} className="m-q">
        <h2 className="m-h2">{titles[step]}</h2>
        {step === 'email' && <>
          <TextInput className="m-input big" type="email" inputMode="email" autoComplete="email" placeholder="example@email.com" aria-label="이메일" autoFocus value={email}
            onChange={event => { setEmail(event.target.value); setError('') }} enterKeyHint="next" />
          {email && !emailOk && <span className="m-err">이메일 형식을 확인해 주세요.</span>}
          <p className="m-help m-org-hint">기관 가입은 PC에서 진행해 주세요.</p>
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
        {step === 'birth' && <>
          <button type="button" className="m-input big m-pick" aria-label={'생년월일 ' + (birth ? birthText(birth) : '선택')} onClick={() => setPicking(true)}>
            <MIcon name="calendar" size={19} /><span className={birth ? '' : 'ph'}>{birth ? birthText(birth) : '생년월일을 골라 주세요'}</span>{age !== null && <small>만 {age}세</small>}</button>
          {birth && !ageOk && <span className="m-err" role="alert">만 {signupRules.minimumAge}세 이상만 가입할 수 있어요.</span>}
        </>}
        {step === 'interests' && <InterestPicker value={interests} onChange={setInterests} />}
      </div>
      {answered.length > 0 && <div className="m-answers">{answered.map(s => <Answered key={s} label={{ email: '이메일', password: '비밀번호', name: '이름', birth: '생년월일', interests: '관심 분야' }[s]}
        value={s === 'email' ? email : s === 'password' ? '•'.repeat(Math.min(password.length, 12)) : s === 'name' ? name : birthText(birth)} onEdit={() => setStep(s)} />)}</div>}
      {error && <p className="m-err" role="alert">{error}</p>}
      <ActionBar><button className="m-btn" disabled={!ok[step] || busy}>{step === 'interests' && !interests.length ? '나중에 할게요' : '다음'}</button></ActionBar>
    </form>
    {picking && <BirthSheet value={birth} onClose={() => setPicking(false)} onPick={value => { setBirth(value); setPicking(false) }} />}
    {terms && <Sheet title="마지막으로 확인해 주세요" onClose={() => setTerms(false)} footer={<button type="button" className="m-btn" disabled={!(agreeNotice && agreeContact) || busy} onClick={finish}>{busy ? '가입하는 중…' : '가입하고 시작하기'}</button>}>
      <div className="m-agree flat">
        <label className="m-check all"><input type="checkbox" checked={agreeNotice && agreeContact} onChange={event => { setAgreeNotice(event.target.checked); setAgreeContact(event.target.checked) }} /><span className="m-box" /><strong>모두 동의</strong></label>
        <label className="m-check"><input type="checkbox" checked={agreeNotice} onChange={event => setAgreeNotice(event.target.checked)} /><span className="m-box" />공식 봉사실적·자원봉사 종합보험이 아님을 이해해요</label>
        <label className="m-check"><input type="checkbox" checked={agreeContact} onChange={event => setAgreeContact(event.target.checked)} /><span className="m-box" />연락처는 서로 공개하지 않아요</label>
      </div>
      <p className="m-help">공식 봉사시간은 1365 자원봉사포털에서 인정받을 수 있어요.</p>
    </Sheet>}
  </div>
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
  const [step, setStep] = useState<'name' | 'birth' | 'interests'>('name')
  const [interests, setInterests] = useState<string[]>([])
  const [name, setName] = useState(query.get('name') ?? '')
  const [birth, setBirth] = useState<Birth | null>(null)
  const [picking, setPicking] = useState(false)
  const [terms, setTerms] = useState(false)
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const birthDate = birth ? `${birth.y}-${pad(birth.m)}-${pad(birth.d)}` : ''
  const age = birth ? ageOn(birthDate, new Date()) : null
  const nameOk = name.trim().length > 0
  const ageOk = age !== null && age >= signupRules.minimumAge
  useEffect(() => { if (step === 'birth' && !birth) setPicking(true) }, [step, birth])
  function next(event?: FormEvent) {
    event?.preventDefault()
    if (step === 'name' && nameOk) setStep('birth')
    else if (step === 'birth' && ageOk && nameOk) setStep('interests')
    else if (step === 'interests' && ageOk && nameOk) setTerms(true)
  }
  async function finish() {
    setBusy(true)
    setError('')
    try {
      onSession(await completeSocial({ ticket: query.get('ticket') ?? '', name: name.trim(), birthDate, interests, agreedNotice: agree }))
      window.location.hash = '#/welcome'
    } catch (cause) {
      setTerms(false)
      setError(cause instanceof ApiError ? (Object.values(cause.fieldErrors)[0] ?? cause.message) : '가입하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }
  return <div className="m-screen m-signup m-ask">
    <header className="m-top"><button type="button" className="m-icon-btn" aria-label="뒤로" onClick={() => { if (step === 'interests') setStep('birth'); else if (step === 'birth') setStep('name'); else window.location.hash = '#/login' }}><MIcon name="back" /></button><h1 className="m-title">{providerName[provider]}로 시작하기</h1><span className="m-top-actions" /></header>
    <div className="m-progress" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step === 'name' ? 1 : step === 'birth' ? 2 : 3} aria-label="가입 단계"><i style={{ width: step === 'name' ? '33%' : step === 'birth' ? '66%' : '100%' }} /></div>
    <form className="m-body m-form" onSubmit={next} noValidate>
      <div key={step} className="m-q">
        <h2 className="m-h2">{step === 'name' ? '어떻게 불러 드릴까요?' : step === 'birth' ? '생년월일을 알려 주세요' : '관심 있는 봉사를 골라 주세요'}</h2>
        {step === 'interests' ? <InterestPicker value={interests} onChange={setInterests} /> : step === 'name' ? <TextInput className="m-input big" aria-label="이름" autoFocus maxLength={signupRules.nameMax} value={name} onChange={event => setName(event.target.value)} enterKeyHint="next" />
          : <><button type="button" className="m-input big m-pick" aria-label={'생년월일 ' + (birth ? birthText(birth) : '선택')} onClick={() => setPicking(true)}>
            <MIcon name="calendar" size={19} /><span className={birth ? '' : 'ph'}>{birth ? birthText(birth) : '생년월일을 골라 주세요'}</span>{age !== null && <small>만 {age}세</small>}</button>
            {birth && !ageOk && <span className="m-err">만 {signupRules.minimumAge}세 이상만 가입할 수 있어요.</span>}</>}
      </div>
      {step !== 'name' && <div className="m-answers">{step === 'interests' && <Answered label="생년월일" value={birthText(birth)} onEdit={() => setStep('birth')} />}<Answered label="이름" value={name} onEdit={() => setStep('name')} /></div>}
      {error && <p className="m-err" role="alert">{error}</p>}
      <ActionBar><button className="m-btn" disabled={step === 'name' ? !nameOk : !ageOk || busy}>{step === 'interests' && !interests.length ? '나중에 할게요' : '다음'}</button></ActionBar>
    </form>
    {picking && <BirthSheet value={birth} onClose={() => setPicking(false)} onPick={value => { setBirth(value); setPicking(false) }} />}
    {terms && <Sheet title="마지막으로 확인해 주세요" onClose={() => setTerms(false)} footer={<button type="button" className="m-btn" disabled={!agree || busy} onClick={finish}>{busy ? '가입하는 중…' : '가입하고 시작하기'}</button>}>
      <div className="m-agree flat"><label className="m-check"><input type="checkbox" checked={agree} onChange={event => setAgree(event.target.checked)} /><span className="m-box" />공식 봉사실적·자원봉사 종합보험이 아님을 이해해요</label></div>
      <p className="m-help">간편 로그인은 개인 회원으로 가입돼요.</p>
    </Sheet>}
  </div>
}

/** 관심 분야 at signup (optional, up to 3): used for 나에게 맞는 봉사 on the home screen. */
function InterestPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  return <>
    <p className="m-help">최대 {signupRules.maxInterests}개 · 홈에서 맞는 모집글과 1365 봉사를 골라 드려요. 나중에 마이에서 바꿀 수 있어요.</p>
    <div className="m-tiles">{categories.map(c => { const on = value.includes(c)
      return <button type="button" key={c} className={'m-tile' + (on ? ' on' : '')} aria-pressed={on}
        onClick={() => onChange(on ? value.filter(x => x !== c) : value.length < signupRules.maxInterests ? [...value, c] : value)}><MIcon name={fieldIcon[c] ?? 'sprout'} size={24} />{c}</button> })}</div>
  </>
}
