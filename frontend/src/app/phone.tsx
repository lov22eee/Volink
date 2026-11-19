// 1인 1계정 (2026-11-22, user decision, V42). The SMS code is sent and checked by Firebase on the phone; the server gets
// only the Firebase ID token (the "proof") and keeps a hash of the number. Accounts from before may wait until 11월 29일;
// 기관 · 관리자 accounts are not asked. In local development (no Firebase) any 6 digits make a "dev:" proof, which only a
// server started with PHONE_DEV_VERIFY=true accepts.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Capacitor } from '@capacitor/core'
import { api, ApiError, logout } from '../api'
import { showToast } from '../App'
import { MIcon, Sheet, TextArea, TextInput, TopBar } from './ui'

export type PhoneStatus = { active: boolean; verified: boolean; last4: string | null; graceUntil: string | null; required: boolean; dispute: string | null }
export type Holder = { email: string | null; loginEmail?: string | null; provider: string; joinedAt: string }

const NATIVE = Capacitor.isNativePlatform() && import.meta.env.VITE_PUSH === '1'
const providerWord: Record<string, string> = { KAKAO: '카카오로 가입', GOOGLE: '구글로 가입', EMAIL: '이메일로 가입' }

/** 010-1234-5678 / 01012345678 → +821012345678 */
export function e164(input: string) {
  const digits = input.replace(/\D/g, '')
  return digits.startsWith('0') ? '+82' + digits.slice(1) : '+' + digits
}
const phoneOk = (input: string) => /^01[016789]\d{7,8}$/.test(input.replace(/\D/g, ''))
const dashed = (input: string) => {
  const d = input.replace(/\D/g, '').slice(0, 11)
  return d.length < 4 ? d : d.length < 8 ? `${d.slice(0, 3)}-${d.slice(3)}` : `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`
}
const md = (iso: string) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`

type Sent = { verificationId?: string; dev?: string }

/** Firebase phone sign-in on the phone itself; the session is signed out right after the token is taken. */
async function sendCode(phone: string, onAuto: (proof: string) => void): Promise<Sent> {
  if (!NATIVE) {
    if (!import.meta.env.DEV) throw new Error('이 기기에서는 휴대폰 인증을 할 수 없어요. 앱에서 해 주세요.')
    return { dev: phone }
  }
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
  await FirebaseAuthentication.removeAllListeners()
  return new Promise<Sent>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('문자를 보내지 못했어요. 잠시 뒤 다시 해 주세요.')), 60_000)
    void FirebaseAuthentication.addListener('phoneCodeSent', event => { window.clearTimeout(timer); resolve({ verificationId: event.verificationId }) })
    void FirebaseAuthentication.addListener('phoneVerificationFailed', event => { window.clearTimeout(timer); reject(new Error(friendly(event.message))) })
    // Android may read the SMS by itself: the proof arrives without typing the code.
    void FirebaseAuthentication.addListener('phoneVerificationCompleted', () => { window.clearTimeout(timer); void token().then(onAuto).catch(() => {}) })
    FirebaseAuthentication.signInWithPhoneNumber({ phoneNumber: phone }).catch(error => { window.clearTimeout(timer); reject(new Error(friendly(String(error?.message ?? error)))) })
  })
}

async function token() {
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
  const { token: proof } = await FirebaseAuthentication.getIdToken({ forceRefresh: true })
  await FirebaseAuthentication.signOut().catch(() => {})
  return proof
}

async function confirmCode(sent: Sent, code: string): Promise<string> {
  if (sent.dev) return 'dev:' + sent.dev
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
  try { await FirebaseAuthentication.confirmVerificationCode({ verificationId: sent.verificationId!, verificationCode: code }) }
  catch (error) { throw new Error(friendly(String((error as Error)?.message ?? error))) }
  return token()
}

function friendly(message: string) {
  if (/invalid.*(code|verification)/i.test(message)) return '인증번호가 맞지 않아요.'
  if (/expired/i.test(message)) return '인증번호 시간이 지났어요. 다시 받아 주세요.'
  if (/too.?many|quota|blocked/i.test(message)) return '요청이 많아요. 잠시 뒤 다시 해 주세요.'
  if (/invalid.*phone|format/i.test(message)) return '휴대폰 번호를 확인해 주세요.'
  return '인증하지 못했어요. 잠시 뒤 다시 해 주세요.'
}

/** 번호 입력 → 인증번호 받기 → 6자리 → proof. */
export function PhoneVerify({ onProof, busy, done, confirmButton = true, initial = '' }: { onProof: (proof: string, phone: string) => void; busy?: boolean; done?: boolean; confirmButton?: boolean; initial?: string }) {
  const [phone, setPhone] = useState(() => initial.startsWith('+82') ? dashed('0' + initial.slice(3)) : initial)
  const [sent, setSent] = useState<Sent | null>(null)
  const [code, setCode] = useState('')
  const [left, setLeft] = useState(0)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const codeRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (left <= 0) return; const t = window.setTimeout(() => setLeft(left - 1), 1000); return () => window.clearTimeout(t) }, [left])
  async function send() {
    if (!phoneOk(phone) || working) return
    setWorking(true); setError(''); setCode('')
    try {
      const number = e164(phone)
      setSent(await sendCode(number, proof => onProof(proof, number)))
      setLeft(180)
      window.setTimeout(() => codeRef.current?.focus(), 50)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '문자를 보내지 못했어요.') } finally { setWorking(false) }
  }
  async function confirm(value = code) {
    if (!sent || value.length !== 6 || working) return
    if (left <= 0) { setError('인증번호 시간이 지났어요. 다시 받아 주세요.'); return }
    setWorking(true); setError('')
    try { onProof(await confirmCode(sent, value), e164(phone)) } catch (cause) { setError(cause instanceof Error ? cause.message : '인증하지 못했어요.') } finally { setWorking(false) }
  }
  return <div className="ph-verify">
    <div className="ph-row">
      <TextInput className="m-input big" type="tel" disabled={done} inputMode="numeric" autoComplete="tel-national" placeholder="010-0000-0000" aria-label="휴대폰 번호"
        value={phone} maxLength={13} onChange={event => { setPhone(dashed(event.target.value)); setError('') }} />
      <button type="button" className="ph-send" disabled={!phoneOk(phone) || working || busy || done} onClick={() => void send()}>{sent ? '다시 받기' : '인증번호 받기'}</button>
    </div>
    {done && <p className="ph-done"><MIcon name="checkCircle" size={20} />인증을 마쳤어요</p>}
    {sent && !done && <>
      <label className="ph-code">
        <span className="ph-sr">인증번호 6자리</span>
        <input ref={codeRef} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} aria-label="인증번호 6자리"
          onChange={event => { const v = event.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); setError(''); if (v.length === 6) void confirm(v) }} />
        <span className="ph-boxes" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <i key={i} className={(i < code.length ? 'on' : '') + (i === code.length ? ' cur' : '')}>{code[i] ?? ''}</i>)}</span>
      </label>
      <p className="ph-hint"><span>{sent.dev ? '개발 환경: 아무 숫자 6자리' : '문자로 받은 6자리'}</span><b>{left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '시간 지남'}</b></p>
      {confirmButton && <button type="button" className="m-btn" disabled={code.length !== 6 || working || busy} onClick={() => void confirm()}>{working || busy ? '확인하는 중…' : '확인'}</button>}
      {!confirmButton && (working || busy) && <p className="ph-hint"><span>확인하는 중…</span></p>}
    </>}
    {error && <p className="m-err" role="alert">{error}</p>}
  </div>
}

/** 이미 가입된 번호예요 — the account that has the number, masked. */
export function TakenSheet({ holder, loginLabel = '이 계정으로 로그인', onLogin, onDispute, onClose }: { holder: Holder; loginLabel?: string; onLogin: () => void; onDispute: (note: string) => Promise<void> | void; onClose: () => void }) {
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  if (asking) return <Sheet title="제 번호가 아니에요" onClose={() => setAsking(false)} footer={<button type="button" className="m-btn" disabled={busy} onClick={async () => { setBusy(true); try { await onDispute(note) } finally { setBusy(false) } }}>{busy ? '보내는 중…' : '확인 요청하기'}</button>}>
    <p className="m-help" style={{ marginTop: 0 }}>번호를 새로 받았거나 가족이 쓰던 번호라면 관리자가 확인한 뒤 이 계정으로 옮겨 드려요.</p>
    <TextArea className="m-input" rows={3} maxLength={300} value={note} placeholder="예) 11월에 새로 개통한 번호예요" onChange={event => setNote(event.target.value)} />
  </Sheet>
  return createPortal(<div className="m-sheet-wrap">
    <div className="m-dim" onClick={onClose} />
    <section className="m-sheet sn-sheet" role="dialog" aria-modal="true" aria-labelledby="ph-taken">
      <span className="m-grab" aria-hidden="true" />
      <div className="sn-body">
        <span className="sn-mark ok" aria-hidden="true">!</span>
        <h2 id="ph-taken">이미 가입된 번호예요</h2>
        <p><span>이 번호로 만든 계정이 있어요.</span></p>
        <div className="ph-acc"><span className={'ph-acc-ic ' + holder.provider.toLowerCase()}>{holder.provider === 'KAKAO' ? 'K' : holder.provider === 'GOOGLE' ? 'G' : <MIcon name="mail" size={18} />}</span>
          <span><b>{holder.email ?? (providerWord[holder.provider] ?? '가입한 계정')}</b><small>{providerWord[holder.provider] ?? ''} · {md(holder.joinedAt)}</small></span></div>
        <button type="button" className="m-btn" onClick={onLogin}>{loginLabel}</button>
        <button type="button" className="sn-appeal sn-appeal-btn" onClick={() => setAsking(true)}>제 번호가 아니에요</button>
      </div>
    </section>
  </div>, document.body)
}

/** #/phone: 마이 › 휴대폰 인증, after a Kakao / Google sign-up, or from the sheet below. */
export function PhoneScreen({ next, fresh, onChange }: { next?: string; fresh?: boolean; onChange?: () => void }) {
  const [status, setStatus] = useState<PhoneStatus | null>(null)
  const [holder, setHolder] = useState<{ holder: Holder; proof: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<PhoneStatus>('/api/me/phone').then(setStatus).catch(() => {}) }, [])
  async function prove(proof: string) {
    setBusy(true)
    try {
      const result = await api<{ status: string; last4?: string; account?: Holder }>('/api/me/phone', 'POST', { proof })
      if (result.status === 'TAKEN' && result.account) { setHolder({ holder: result.account, proof }); return }
      showToast(status?.verified ? '휴대폰 번호를 바꿨어요' : '휴대폰 인증을 마쳤어요', `***-${result.last4}`)
      onChange?.()
      window.location.hash = next ?? '#/my'
    } catch (cause) { showToast(cause instanceof ApiError ? cause.message : '인증하지 못했어요.') } finally { setBusy(false) }
  }
  async function toOther() {
    // A Kakao / Google sign-up that just made a second account: that empty account goes, and the person logs in again.
    if (fresh) await api('/api/me/phone/abandon', 'POST', {}).catch(() => {})
    await logout().catch(() => {})
    rememberLoginEmail(holder?.holder)
    window.location.hash = '#/login'
    window.location.reload()
  }
  async function dispute(note: string) {
    if (!holder) return
    try { await api('/api/me/phone/dispute', 'POST', { proof: holder.proof, note }); showToast('확인을 요청했어요', '결과를 알림으로 알려 드릴게요'); setHolder(null); window.location.hash = next ?? '#/my' }
    catch (cause) { showToast(cause instanceof ApiError ? cause.message : '보내지 못했어요.') }
  }
  return <div className="m-screen">
    <TopBar title={status?.verified ? '휴대폰 번호 변경' : '휴대폰 인증'} back={fresh ? undefined : next ?? '#/my'} />
    <div className="m-body ph-screen">
      <h1 className="ph-title">{status?.verified ? <>새 휴대폰 번호를<br />인증해 주세요</> : <>휴대폰 번호를<br />인증해 주세요</>}</h1>
      <p className="ph-sub">{status?.verified ? `지금 번호 ***-${status.last4}` : '한 사람당 한 계정만 만들 수 있어요'}</p>
      {status?.dispute === 'OPEN' && <div className="m-note"><strong>관리자가 확인하고 있어요</strong>결과를 알림으로 알려 드릴게요.</div>}
      <PhoneVerify onProof={proof => void prove(proof)} busy={busy} />
      <p className="ph-fine">번호는 다른 사람에게 보이지 않고, 같은 번호인지 확인하는 데만 써요.</p>
    </div>
    {holder && <TakenSheet holder={holder.holder} loginLabel="이 계정으로 로그인" onLogin={() => void toOther()} onDispute={dispute} onClose={() => setHolder(null)} />}
  </div>
}

/** Wherever 신청 · 모집글 · 글쓰기 was stopped for a missing phone (api.ts sends the event): one sheet to go and verify. */
export function PhoneRequiredHost() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener('volink:phone-required', show)
    return () => window.removeEventListener('volink:phone-required', show)
  }, [])
  if (!open) return null
  const back = window.location.hash || '#/home'
  return createPortal(<div className="m-sheet-wrap">
    <div className="m-dim" onClick={() => setOpen(false)} />
    <section className="m-sheet sn-sheet" role="dialog" aria-modal="true" aria-labelledby="ph-need">
      <span className="m-grab" aria-hidden="true" />
      <div className="sn-body">
        <span className="sn-mark warn" aria-hidden="true"><MIcon name="phone" size={30} /></span>
        <h2 id="ph-need">휴대폰 인증 후 이용할 수 있어요</h2>
        <p><span>1분이면 끝나요.</span></p>
        <ul className="ph-points"><li>한 사람당 한 계정으로 운영해요</li><li>번호는 다른 사람에게 보이지 않아요</li><li>지금 쓰는 계정과 기록은 그대로예요</li></ul>
        <button type="button" className="m-btn" onClick={() => { setOpen(false); window.location.hash = '#/phone?next=' + encodeURIComponent(back) }}>인증하기</button>
        <button type="button" className="m-btn line sn-close" onClick={() => setOpen(false)}>닫기</button>
      </div>
    </section>
  </div>, document.body)
}

/** Shared by 홈 할 일 and 마이: the line asking for a phone, or nothing. */
export function usePhoneStatus() {
  const [status, setStatus] = useState<PhoneStatus | null>(null)
  useEffect(() => { api<PhoneStatus>('/api/me/phone').then(setStatus).catch(() => {}) }, [])
  return status
}

export function phoneLine(status: PhoneStatus | null): { text: string; sub: string; short: string } | null {
  if (!status || !status.active || status.verified) return null
  if (status.required) return { text: '휴대폰 인증이 필요해요', sub: '인증해야 신청·모집·글쓰기를 할 수 있어요', short: '휴대폰 인증이 필요해요' }
  const until = status.graceUntil ? md(status.graceUntil) + '까지' : ''
  return { text: '휴대폰 인증이 필요해요', sub: until ? until + ' 인증해 주세요' : '인증해 주세요', short: until ? `휴대폰 인증 · ${until}` : '휴대폰 인증이 필요해요' }
}

/** "이 계정으로 로그인": the login screen opens with that account's e-mail filled in (kept for this tab only). */
export function rememberLoginEmail(holder?: Holder | null) {
  try {
    if (holder?.loginEmail) sessionStorage.setItem('volink.loginEmail', holder.loginEmail)
    else sessionStorage.removeItem('volink.loginEmail')
  } catch { /* private mode */ }
}

export function takeLoginEmail() {
  try { const email = sessionStorage.getItem('volink.loginEmail') ?? ''; sessionStorage.removeItem('volink.loginEmail'); return email } catch { return '' }
}

/**
 * 휴대폰 인증 안내 (2026-11-19, user decision): an account still in its grace period sees this once each time the app is
 * opened (not on every screen), until it verifies. After the grace day the 신청 · 글쓰기 sheet (PhoneRequiredHost) takes over.
 * It waits while another sheet (경고 · 풀림) is open so the two never stack.
 */
export function PhoneNoticeHost({ tick }: { tick: string }) {
  const [status, setStatus] = useState<PhoneStatus | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let seen = false
    try { seen = sessionStorage.getItem('volink.phoneNotice') === '1' } catch { /* private mode */ }
    if (seen) return
    api<PhoneStatus>('/api/me/phone').then(setStatus).catch(() => {})
  }, [])
  useEffect(() => {
    if (!status || open || !status.active || status.verified || status.required || !status.graceUntil) return
    if (window.location.hash.startsWith('#/phone')) return
    try { if (sessionStorage.getItem('volink.phoneNotice') === '1') return } catch { /* private mode */ }
    let done = false
    const tryOpen = () => {
      if (done) return
      if (document.querySelector('.m-sheet-wrap')) { window.setTimeout(tryOpen, 800); return }
      done = true
      try { sessionStorage.setItem('volink.phoneNotice', '1') } catch { /* private mode */ }
      setOpen(true)
    }
    const t = window.setTimeout(tryOpen, 600)
    return () => { done = true; window.clearTimeout(t) }
  }, [status, tick, open])
  if (!open || !status?.graceUntil) return null
  const until = status.graceUntil
  // calendar days in Korea: 19일 → 29일 is 10일 남음, the day itself is 오늘까지
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
  const left = Math.max(0, Math.round((Date.parse(until) - Date.parse(today)) / 86_400_000))
  const day = new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(until + 'T12:00:00+09:00'))
  const close = () => setOpen(false)
  return createPortal(<div className="m-sheet-wrap">
    <div className="m-dim" onClick={close} />
    <section className="m-sheet sn-sheet" role="dialog" aria-modal="true" aria-labelledby="ph-notice">
      <span className="m-grab" aria-hidden="true" />
      <div className="sn-body">
        <span className="sn-mark warn" aria-hidden="true"><MIcon name="phone" size={30} /></span>
        <h2 id="ph-notice">휴대폰 인증을 해 주세요</h2>
        <p><span>{md(until)}까지 인증하면 지금처럼 이용할 수 있어요.</span></p>
        <dl className="sn-detail ph-notice-rows">
          <div><dt>인증 마감</dt><dd>{md(until)} ({day}) · {left ? left + '일 남음' : '오늘까지'}</dd></div>
          <div><dt>마감 뒤</dt><dd>신청 · 모집 · 글쓰기 제한</dd></div>
          <div><dt>번호</dt><dd>다른 사람에게 보이지 않아요</dd></div>
        </dl>
        <button type="button" className="m-btn" onClick={() => { close(); window.location.hash = '#/phone?next=' + encodeURIComponent(window.location.hash || '#/home') }}>지금 인증하기</button>
        <button type="button" className="m-btn line sn-close" onClick={close}>나중에 할게요</button>
      </div>
    </section>
  </div>, document.body)
}
