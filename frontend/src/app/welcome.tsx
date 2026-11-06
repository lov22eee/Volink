// Right after signing up (app): why we ask, then the phone's own permission prompt — location first, then notifications.
// Either can be skipped; the app works without both and 마이 can turn them on later.
// Last (V29, 2026-11-06): how to keep 1365 activities — 가져오기 (connect the 1365 page in the app) or 직접 남기기.
import { useState } from 'react'
import { api } from '../api'
import { remember } from '../location'
import { showToast } from '../App'
import { saveExtMode, useConnect1365 } from './lab'
import { askNotifications } from './native'
import { MIcon } from './ui'

export function WelcomeScreen() {
  const [step, setStep] = useState<'location' | 'notify' | 'night' | 'ext'>('location')
  const [busy, setBusy] = useState(false)
  const done = () => { window.location.hash = '#/home' }
  // 1365 연결: the consent sheet, then the 1365 screen; "다음에 할게요" there still keeps 가져오기 and goes home.
  const [connectSheet, connect] = useConnect1365(done)
  async function chooseExt(mode: 'IMPORT' | 'MANUAL') {
    setBusy(true)
    try { await saveExtMode(mode) } catch { /* asked again in 설정 */ }
    setBusy(false)
    if (mode === 'IMPORT') connect()
    else { showToast('1365 봉사는 직접 남기면 돼요', '다녀온 뒤 ‘참여했나요?’ → 실적확인서 올리기'); done() }
  }
  async function allowLocation() {
    setBusy(true)
    await new Promise<void>(resolve => {
      if (!navigator.geolocation) { resolve(); return }
      navigator.geolocation.getCurrentPosition(() => { remember(true); resolve() }, () => resolve(), { timeout: 10000 })
    })
    setBusy(false)
    setStep('notify')
  }
  async function allowNotify() {
    setBusy(true)
    await askNotifications()
    setBusy(false)
    setStep('night')
  }
  /** Quiet hours 22:00–08:00 on (default) or off; changeable later in 마이 > 알림 설정. */
  async function night(quiet: boolean) {
    setBusy(true)
    await api('/api/me/notification-settings', 'PUT', { push: true, quiet }).catch(() => {})
    setBusy(false)
    setStep('ext')
  }
  const location = step === 'location'
  const dots = (n: number) => <div className="m-welcome-dots" aria-hidden="true">{[1, 2, 3, 4].map(i => <i key={i} className={i <= n ? 'on' : ''} />)}</div>
  if (step === 'ext') return <main className="m-welcome" aria-label="시작 안내">
    {dots(4)}
    <div className="m-welcome-body">
      <span className="m-welcome-ico ext"><b>1365</b></span>
      <h1>1365 봉사실적도 함께 모을까요?</h1>
      <p>1365 봉사시간과 Volink 활동을 한눈에 볼 수 있어요.</p>
      <ul className="m-welcome-facts">
        <li><MIcon name="timer" size={20} /><span>5분 정도면 충분해요</span></li>
        <li><MIcon name="checkCircle" size={20} /><span>상단 가이드와 함께 진행 가능해요</span></li>
      </ul>
    </div>
    <div className="m-welcome-actions">
      <button type="button" className="m-btn blue" disabled={busy} onClick={() => chooseExt('IMPORT')}>1365 연결하기</button>
      <button type="button" className="m-btn line" disabled={busy} onClick={() => chooseExt('MANUAL')}>괜찮아요, 직접 남길게요</button>
      <small className="m-welcome-foot">설정 › 실험실에서 언제든 바꿀 수 있어요</small>
    </div>
    {connectSheet}
  </main>
  if (step === 'night') return <main className="m-welcome" aria-label="시작 안내">
    {dots(3)}
    <div className="m-welcome-body">
      <span className="m-welcome-ico"><MIcon name="moon" size={40} /></span>
      <h1>밤에도 알림을 받을까요?</h1>
      <p>밤 10시~아침 8시엔 쉬게 할 수 있어요.</p>
    </div>
    <div className="m-welcome-actions">
      <button type="button" className="m-btn" disabled={busy} onClick={() => night(true)}>밤에는 조용히 받을게요</button>
      <button type="button" className="m-btn line" disabled={busy} onClick={() => night(false)}>밤에도 받을게요</button>
    </div>
  </main>
  return <main className="m-welcome" aria-label="시작 안내">
    {dots(location ? 1 : 2)}
    <div className="m-welcome-body">
      <span className="m-welcome-ico"><MIcon name={location ? 'pin' : 'bell'} size={40} /></span>
      <h1>{location ? '위치를 허용해 주세요' : '알림을 받을까요?'}</h1>
      <p>{location ? '가까운 봉사 찾기와 현장 체크인에 써요. 저장하지 않아요.' : '승인·공지·하루 전 안내를 알려 드려요.'}</p>
    </div>
    <div className="m-welcome-actions">
      <button type="button" className="m-btn" disabled={busy} onClick={location ? allowLocation : allowNotify}>{busy ? '확인하는 중…' : location ? '위치 허용하기' : '알림 받기'}</button>
      <button type="button" className="m-text-btn" disabled={busy} onClick={() => setStep(location ? 'notify' : 'ext')}>나중에 할게요</button>
    </div>
  </main>
}
