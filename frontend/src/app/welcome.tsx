// Right after signing up (app): why we ask, then the phone's own permission prompt — location first, then notifications.
// Either can be skipped; the app works without both and 마이 can turn them on later.
import { useState } from 'react'
import { api } from '../api'
import { remember } from '../location'
import { askNotifications } from './native'
import { MIcon } from './ui'

export function WelcomeScreen() {
  const [step, setStep] = useState<'location' | 'notify' | 'night'>('location')
  const [busy, setBusy] = useState(false)
  const done = () => { window.location.hash = '#/home' }
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
    done()
  }
  const location = step === 'location'
  if (step === 'night') return <main className="m-welcome" aria-label="시작 안내">
    <div className="m-welcome-dots" aria-hidden="true"><i className="on" /><i className="on" /><i className="on" /></div>
    <div className="m-welcome-body">
      <span className="m-welcome-ico"><MIcon name="moon" size={40} /></span>
      <h1>밤에도 알림을<br />받을까요?</h1>
      <p>밤 10시부터 아침 8시까지는 알림을 보내지 않을 수 있어요. 시간은 마이 › 알림 설정에서 언제든 바꿀 수 있어요.</p>
    </div>
    <div className="m-welcome-actions">
      <button type="button" className="m-btn" disabled={busy} onClick={() => night(true)}>밤에는 조용히 받을게요</button>
      <button type="button" className="m-btn line" disabled={busy} onClick={() => night(false)}>밤에도 받을게요</button>
    </div>
  </main>
  return <main className="m-welcome" aria-label="시작 안내">
    <div className="m-welcome-dots" aria-hidden="true"><i className="on" /><i className={location ? '' : 'on'} /><i /></div>
    <div className="m-welcome-body">
      <span className="m-welcome-ico"><MIcon name={location ? 'pin' : 'bell'} size={40} /></span>
      <h1>{location ? <>내 주변 봉사를 찾으려면<br />위치를 허용해 주세요</> : <>신청 결과와 활동 소식을<br />알려 드릴까요?</>}</h1>
      <p>{location ? '가까운 활동과 1365 봉사를 거리순으로 보여 드리고, 현장 체크인(200m 안)에 써요. 위치는 저장하지 않아요.'
        : '승인·자리 제안·공지·하루 전 안내를 놓치지 않게 알려 드려요. 마이 > 알림 설정에서 언제든 바꿀 수 있어요.'}</p>
    </div>
    <div className="m-welcome-actions">
      <button type="button" className="m-btn" disabled={busy} onClick={location ? allowLocation : allowNotify}>{busy ? '확인하는 중…' : location ? '위치 허용하기' : '알림 받기'}</button>
      <button type="button" className="m-text-btn" disabled={busy} onClick={location ? () => setStep('notify') : done}>나중에 할게요</button>
    </div>
  </main>
}
