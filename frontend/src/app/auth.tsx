// App start: nothing is shown before signing in. Login on the first screen, signup in three steps.
// Institution members sign up on the PC web site (documents and a contact person are needed), so the app signs up
// general members only (a grey line on step 1 says so; there is no type choice). The server rules are the same as on the web (age 14+, ADMIN never selectable).
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError, login } from '../api'
import { showToast } from '../App'
import type { User } from '../api'
import { categories } from '../App'
import { ageOn, signupRules } from '../rules'
import { ActionBar, MIcon, Sheet, WheelColumn, Wheels } from './ui'
import type { MIconName } from './ui'

const fieldIcon: Record<string, MIconName> = { '환경 정화': 'leaf', '생활 지원': 'hand', '지역 돌봄': 'users' }

export function Login({ onSession }: { onSession: (user: User) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
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
        <input type="email" inputMode="email" autoComplete="username" placeholder="이메일" aria-label="이메일" value={email} onChange={event => { setEmail(event.target.value); setError('') }} enterKeyHint="next" /></label>
      <label className="m-input m-reveal with-icon"><MIcon name="lock" size={20} /><span className="sr-only">비밀번호</span>
        <input type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="비밀번호" aria-label="비밀번호" value={password} onChange={event => { setPassword(event.target.value); setError('') }} enterKeyHint="go" />
        <button type="button" className="m-peek" aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={() => setShow(!show)}><MIcon name={show ? 'eyeOff' : 'eye'} size={20} /></button></label>
      {error && <p className="m-err" role="alert">{error}</p>}
      <button className="m-btn" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
      <p className="m-splash-links">처음이신가요? <a href="#/signup">회원가입</a></p>
      {/* Social login is not connected yet (needs Kakao/Google app keys and server OAuth): the buttons only say so. */}
      <div className="m-social" role="group" aria-label="간편 로그인">
        <span className="m-social-line">간편 로그인</span>
        <div className="m-social-row">
          <button type="button" className="m-social-btn kakao" aria-label="카카오로 로그인 (준비 중)" onClick={() => showToast('카카오 로그인은 준비 중이에요', '지금은 이메일로 로그인해 주세요')}>
            <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path fill="#191919" d="M12 3.5c-5 0-9 3.1-9 7 0 2.5 1.7 4.7 4.2 6l-1 3.7c-.1.3.3.6.6.4l4.4-2.9h.8c5 0 9-3.1 9-7s-4-7.2-9-7.2Z" /></svg></button>
          <button type="button" className="m-social-btn google" aria-label="구글로 로그인 (준비 중)" onClick={() => showToast('구글 로그인은 준비 중이에요', '지금은 이메일로 로그인해 주세요')}>
            <svg width="24" height="24" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5Z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7Z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44Z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5Z" /></svg></button>
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

export function Signup({ onSession }: { onSession: (user: User) => void }) {
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [name, setName] = useState('')
  const [birth, setBirth] = useState<{ y: number; m: number; d: number } | null>(null)
  const [draft, setDraft] = useState({ y: 2003, m: 1, d: 1 })
  const [picking, setPicking] = useState(false)
  const [interests, setInterests] = useState<string[]>([])
  const [agreeNotice, setAgreeNotice] = useState(false)
  const [agreeContact, setAgreeContact] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
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
  const can = step === 1 ? emailOk && passwordOk && confirmOk : step === 2 ? nameOk && ageOk && interests.length >= 1 : agreeNotice && agreeContact
  const days = useMemo(() => Array.from({ length: new Date(draft.y, draft.m, 0).getDate() }, (_, i) => i + 1), [draft.y, draft.m])
  const touch = (key: string) => setTouched(value => ({ ...value, [key]: true }))

  async function finish() {
    setBusy(true)
    setError('')
    try {
      await api('/api/auth/signup', 'POST', { memberType: 'GENERAL', name: name.trim(), email: email.trim(), password, birthDate, interests, agreedNotice: true })
      onSession(await login(email.trim(), password))
      window.location.hash = '#/home'
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'EMAIL_TAKEN') { setStep(1); setError('이미 가입한 이메일이에요. 로그인하거나 다른 이메일을 써 주세요.') }
      else if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length) setError(Object.values(cause.fieldErrors)[0])
      else setError(cause instanceof Error ? cause.message : '가입하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }
  function next(event?: FormEvent) {
    event?.preventDefault()
    if (!can) { setTouched({ email: true, password: true, confirm: true, name: true, birth: true, interests: true }); return }
    if (step < 3) { setStep(step + 1); setError(''); window.scrollTo(0, 0) } else finish()
  }
  const back = () => step === 1 ? (window.location.hash = '#/login') : setStep(step - 1)

  return <div className="m-screen m-signup">
    <header className="m-top"><button type="button" className="m-icon-btn" aria-label="뒤로" onClick={back}><MIcon name="back" /></button><h1 className="m-title">회원가입</h1><span className="m-top-actions" /></header>
    <div className="m-progress" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step} aria-label="가입 단계"><i style={{ width: step * 33.34 + '%' }} /></div>
    <form className="m-body m-form" onSubmit={next} noValidate>
      <span className="m-step">{step} / 3</span>
      {step === 1 && <>
        <h2 className="m-h2">로그인에 쓸<br />이메일과 비밀번호</h2>
        <label className="m-field"><span className="m-label">이메일</span>
          <input className={'m-input' + (touched.email && !emailOk ? ' bad' : '')} type="email" inputMode="email" autoComplete="email" placeholder="example@email.com" value={email}
            onChange={event => { setEmail(event.target.value); setError('') }} onBlur={() => touch('email')} enterKeyHint="next" />
          {email && (emailOk ? <span className="m-ok"><MIcon name="check" size={15} />사용할 수 있는 형식이에요</span> : touched.email && <span className="m-err">이메일 형식을 확인해 주세요.</span>)}</label>
        <label className="m-field"><span className="m-label">비밀번호</span>
          <span className={'m-input with-peek' + (touched.password && !passwordOk ? ' bad' : '')}>
            <input type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="영문·숫자 포함 8자 이상" value={password} onChange={event => setPassword(event.target.value)} onBlur={() => touch('password')} aria-label="비밀번호" enterKeyHint="next" />
            <button type="button" className="m-peek" aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={() => setShow(!show)}><MIcon name={show ? 'eyeOff' : 'eye'} size={20} /></button></span>
          <span className="m-rules">{rules.map(rule => <span key={rule.label} className={'m-rule' + (rule.ok ? ' ok' : '')}>{rule.ok && <MIcon name="check" size={13} />}{rule.label}</span>)}</span></label>
        <label className="m-field"><span className="m-label">비밀번호 확인</span>
          <input className={'m-input' + (touched.confirm && confirm && !confirmOk ? ' bad' : '')} type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="한 번 더 입력" value={confirm}
            onChange={event => setConfirm(event.target.value)} onBlur={() => touch('confirm')} aria-label="비밀번호 확인" enterKeyHint="done" />
          {confirm && (confirmOk ? <span className="m-ok"><MIcon name="check" size={15} />비밀번호가 같아요</span> : touched.confirm && <span className="m-err">비밀번호가 달라요.</span>)}</label>
        <p className="m-help m-org-hint">기관 가입은 PC에서 진행해 주세요.</p>
      </>}
      {step === 2 && <>
        <h2 className="m-h2">어떻게 불러 드릴까요?</h2>
        <label className="m-field"><span className="m-label">이름</span>
          <input className={'m-input' + (touched.name && !nameOk ? ' bad' : '')} autoComplete="name" placeholder="이름" maxLength={signupRules.nameMax} value={name} onChange={event => setName(event.target.value)} onBlur={() => touch('name')} enterKeyHint="done" />
          <span className="m-help">다른 사람에게는 가운데 글자를 가려서 보여 줘요 (예: 김*지)</span></label>
        <div className="m-field"><span className="m-label">생년월일</span>
          <button type="button" className={'m-input m-pick' + (touched.birth && !ageOk ? ' bad' : '')} aria-label={'생년월일 ' + (birth ? `${birth.y}년 ${birth.m}월 ${birth.d}일` : '선택')} onClick={() => { if (birth) setDraft(birth); setPicking(true) }}>
            <MIcon name="calendar" size={19} /><span className={birth ? '' : 'ph'}>{birth ? `${birth.y}년 ${birth.m}월 ${birth.d}일` : '생년월일을 골라 주세요'}</span>{age !== null && <small>만 {age}세</small>}</button>
          {birth && !ageOk && <span className="m-err" role="alert">만 {signupRules.minimumAge}세 이상만 가입할 수 있어요.</span>}</div>
        <div className="m-field"><span className="m-label">관심 분야 <small>1~{signupRules.maxInterests}개 · 맞춤 추천에 써요</small></span>
          <div className="m-tiles">{categories.map(category => {
            const on = interests.includes(category)
            return <button type="button" key={category} className={'m-tile' + (on ? ' on' : '')} aria-pressed={on}
              onClick={() => setInterests(on ? interests.filter(item => item !== category) : interests.length < signupRules.maxInterests ? [...interests, category] : interests)}>
              <MIcon name={fieldIcon[category] ?? 'sprout'} size={24} />{category}</button>
          })}</div></div>
      </>}
      {step === 3 && <>
        <h2 className="m-h2">마지막으로 확인해 주세요</h2>
        <div className="m-agree">
          <label className="m-check all"><input type="checkbox" checked={agreeNotice && agreeContact} onChange={event => { setAgreeNotice(event.target.checked); setAgreeContact(event.target.checked) }} /><span className="m-box" /><strong>모두 동의</strong></label>
          <label className="m-check"><input type="checkbox" checked={agreeNotice} onChange={event => setAgreeNotice(event.target.checked)} /><span className="m-box" />공식 봉사실적·자원봉사 종합보험이 아님을 이해해요</label>
          <label className="m-check"><input type="checkbox" checked={agreeContact} onChange={event => setAgreeContact(event.target.checked)} /><span className="m-box" />연락처는 서로 공개하지 않아요</label>
        </div>
        <p className="m-help">Volink 활동 기록은 우리 동네 기록이에요. 공식 봉사시간은 1365 자원봉사포털에서 인정받을 수 있어요.</p>
      </>}
      {error && <p className="m-err" role="alert">{error}</p>}
      <ActionBar><button className="m-btn" disabled={!can || busy}>{step < 3 ? '다음' : busy ? '가입하는 중…' : '가입하고 시작하기'}</button></ActionBar>
    </form>
    {picking && <Sheet title="생년월일" onClose={() => setPicking(false)} footer={<>
      <p className="m-help center">만 {signupRules.minimumAge}세 이상만 가입할 수 있어요</p>
      <button type="button" className="m-btn" onClick={() => { const d = Math.min(draft.d, days.length); setBirth({ ...draft, d }); touch('birth'); setPicking(false) }}>완료</button></>}>
      <Wheels>
        <WheelColumn label="년" items={years} value={draft.y} render={y => y + '년'} onChange={y => setDraft(v => ({ ...v, y }))} />
        <WheelColumn label="월" items={months} value={draft.m} render={m => m + '월'} onChange={m => setDraft(v => ({ ...v, m }))} />
        <WheelColumn label="일" items={days} value={Math.min(draft.d, days.length)} render={d => d + '일'} onChange={d => setDraft(v => ({ ...v, d }))} />
      </Wheels>
    </Sheet>}
  </div>
}
