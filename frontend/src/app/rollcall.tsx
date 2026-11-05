// 출석부 (organizer, app): QR + 4-digit code on top, then who is here and who is not yet (before check-in opens: only who is confirmed).
// Anyone not yet here can be checked in by hand with a reason, one at a time or several at once with one reason
// (e.g. people who applied on a PC and have no phone with them). Every manual check-in keeps its reason.
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { api, ApiError, siteUrl } from '../api'
import type { Applicant, LiveActivity } from '../api'
import { showToast } from '../App'
import { hhmm } from '../checkin'
import type { Phase, QrInfo } from '../checkin'
import { ActionBar, MIcon, Sheet, TextInput } from './ui'

const reasons = ['휴대폰 없음', '앱·로그인 안 됨', '위치 안 잡힘', '얼굴로 확인함']
const methodTag: Record<string, { text: string; tone: string }> = { QR: { text: 'QR', tone: '' }, CODE: { text: '코드', tone: '' }, MANUAL: { text: '수동', tone: 'man' } }

export function RollCall({ activity, people, phase, opens, onChanged }: { activity: LiveActivity; people: Applicant[]; phase: Phase; opens: number; onChanged: () => void }) {
  const [info, setInfo] = useState<QrInfo | null>(null)
  const [image, setImage] = useState('')
  const [left, setLeft] = useState(30)
  const [big, setBig] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<number[]>([])
  const [target, setTarget] = useState<Applicant[] | null>(null)
  const [reason, setReason] = useState(reasons[0])
  const [own, setOwn] = useState('')
  const [busy, setBusy] = useState(false)
  const open = phase === 'open'
  const canManual = phase === 'open' || phase === 'late'

  const load = useCallback(() => api<QrInfo>('/api/activities/' + activity.id + '/qr').then(next => { setInfo(next); setLeft(next.codeSecondsLeft ?? next.rotateSeconds) }).catch(() => setInfo(null)), [activity.id])
  useEffect(() => { load() }, [load, phase])
  // A new QR and code when the 30-second slot turns over; the list follows along.
  useEffect(() => {
    if (!info?.open) return
    const tick = window.setInterval(() => setLeft(value => {
      if (value <= 1) { load(); onChanged(); return 30 }
      return value - 1
    }), 1000)
    return () => window.clearInterval(tick)
  }, [info?.open, load, onChanged])
  const url = info?.token ? siteUrl() + '#/checkin/' + activity.id + '?t=' + encodeURIComponent(info.token) : ''
  useEffect(() => { if (url) QRCode.toDataURL(url, { width: 560, margin: 1 }).then(setImage).catch(() => setImage('')); else setImage('') }, [url])

  const here = people.filter(p => p.status === 'CHECKED_IN' || p.status === 'COMPLETED')
  const notYet = people.filter(p => p.status === 'CONFIRMED')
  const expected = here.length + notYet.length + people.filter(p => p.status === 'NO_SHOW').length

  async function confirm() {
    if (!target) return
    const text = (own.trim() || reason).trim()
    setBusy(true)
    try {
      if (target.length === 1) await api('/api/participations/' + target[0].id + '/manual-check-in', 'POST', { reason: text })
      else await api('/api/activities/' + activity.id + '/manual-check-ins', 'POST', { participationIds: target.map(p => p.id), reason: text })
      showToast(target.length === 1 ? target[0].name + ' 님 출석을 확인했어요' : target.length + '명 출석을 확인했어요', '사유: ' + text)
      setTarget(null); setSelecting(false); setPicked([]); setOwn('')
      onChanged()
    } catch (cause) {
      showToast(cause instanceof ApiError ? (Object.values(cause.fieldErrors)[0] ?? cause.message) : '처리하지 못했어요')
    } finally {
      setBusy(false)
    }
  }

  const timer = <span className="r-timer" aria-hidden="true"><i style={{ width: (left / 30) * 100 + '%' }} /></span>
  return <>
    {open && info?.code ? <section className="r-qr" aria-label="출석 QR과 코드">
      <button type="button" className="r-qr-img" aria-label="QR 크게 보기" onClick={() => setBig(true)}>{image && <img src={image} alt="체크인 QR" data-url={url} />}</button>
      <div className="r-qr-info"><small>출석 코드</small><b className="r-code">{info.code}</b>{timer}<small>{left}초 뒤 새 코드 · QR도 같이 바뀌어요</small></div>
    </section>
      : phase === 'later' || phase === 'soon' ? <div className="m-note"><strong>체크인은 {hhmm(opens)}부터 열려요</strong>그때 이 자리에 QR과 4자리 출석 코드가 나와요. 미리 출석부를 확인해 두세요.</div>
      : phase === 'late' ? <div className="m-note warm"><strong>QR·코드 체크인 시간이 지났어요</strong>늦게 온 사람은 아래 ‘출석 체크’로 확인해 주세요.</div>
      : null}

    {(phase === 'later' || phase === 'soon') ? <>
      <div className="r-sec"><h3><MIcon name="users" size={18} />참가 확정 <b>{notYet.length + here.length}</b>명</h3></div>
      {notYet.length + here.length ? <ul className="r-roll">{[...here, ...notYet].map(p => <li key={p.id}>
        <span className="m-avatar sm"><MIcon name="user" size={16} /></span>
        <span className="r-nm"><b>{p.name}</b>{p.lateMinutes ? <small className="late">약 {p.lateMinutes}분 늦어요</small> : null}</span>
      </li>)}</ul> : <p className="r-empty">아직 확정된 참가자가 없어요.</p>}
    </> : <>
    <div className="r-sec"><h3><MIcon name="checkCircle" size={18} />출석 <b>{here.length}</b>/{expected}</h3></div>
    {here.length ? <ul className="r-roll">{here.map(p => <li key={p.id}>
      <span className="r-ok"><MIcon name="check" size={15} /></span>
      <span className="r-nm"><b>{p.name}</b><small>{p.checkedInAt ?? ''}{p.checkInReason ? ' · ' + p.checkInReason : ''}{p.status === 'COMPLETED' ? ' · 완료 확인' : ''}</small></span>
      {p.checkInMethod && <span className={'r-tag ' + (methodTag[p.checkInMethod]?.tone ?? '')}>{methodTag[p.checkInMethod]?.text ?? p.checkInMethod}</span>}
    </li>)}</ul> : <p className="r-empty">아직 출석한 사람이 없어요.</p>}

    {phase !== 'ended' && <>
      <div className="r-sec"><h3><MIcon name="clock" size={18} />아직 <b>{notYet.length}</b></h3>
        {canManual && notYet.length > 1 && <button type="button" className="m-text-btn" onClick={() => { setSelecting(!selecting); setPicked([]) }}>{selecting ? '선택 취소' : '여러 명 선택'}</button>}</div>
      {notYet.length ? <ul className="r-roll">{notYet.map(p => {
        const on = picked.includes(p.id)
        return <li key={p.id} className={on ? 'sel' : ''} onClick={selecting ? () => setPicked(on ? picked.filter(x => x !== p.id) : [...picked, p.id]) : undefined}>
          {selecting ? <span className={'r-cb' + (on ? ' on' : '')} role="checkbox" aria-checked={on} aria-label={p.name + ' 선택'}>{on && <MIcon name="check" size={14} />}</span> : <span className="r-no" />}
          <span className="r-nm"><b>{p.name}</b><small className={p.lateMinutes ? 'late' : ''}>{p.lateMinutes ? `약 ${p.lateMinutes}분 늦어요` : '아직 체크인 안 함'}</small></span>
          {!selecting && canManual && <button type="button" className="m-btn xs line" onClick={() => { setTarget([p]); setReason(reasons[0]); setOwn('') }}>출석 체크</button>}
        </li>
      })}</ul> : <p className="r-empty">모두 출석했어요</p>}
    </>}
    </>}
    {phase === 'ended' && notYet.length > 0 && <p className="m-help">체크인하지 않은 {notYet.length}명은 불참으로 처리돼요.</p>}
    <p className="m-help">수동 확인은 사유와 함께 기록에 남아요. QR·위치 확인은 부정 참여를 줄이는 방법이며 완벽한 증명은 아니에요.</p>

    {selecting ? <ActionBar><button className="m-btn" disabled={!picked.length} onClick={() => { setTarget(notYet.filter(p => picked.includes(p.id))); setReason(reasons[0]); setOwn('') }}>{picked.length ? `${picked.length}명 출석 처리` : '출석 처리할 사람을 골라요'}</button></ActionBar>
      : open && info?.code && <ActionBar><button className="m-btn" onClick={() => setBig(true)}><MIcon name="qr" size={19} />QR·코드 크게 띄우기</button></ActionBar>}

    {target && <Sheet title={target.length === 1 ? target[0].name + ' 님 출석 확인' : target.length + '명 출석 확인'} onClose={() => setTarget(null)}
      footer={<button type="button" className="m-btn" disabled={busy || !(own.trim() || reason)} onClick={confirm}>{busy ? '처리 중…' : '출석 확인'}</button>}>
      {target.length > 1 && <div className="m-labels">{target.map(p => <span key={p.id} className="m-badge gray">{p.name}</span>)}</div>}
      <span className="m-label">사유 <small>기록에 남아요</small></span>
      <div className="r-reasons">{reasons.map(x => <button key={x} type="button" className={reason === x && !own.trim() ? 'on' : ''} aria-pressed={reason === x && !own.trim()} onClick={() => { setReason(x); setOwn('') }}>{x}</button>)}</div>
      <label className="m-field"><span className="sr-only">직접 적기</span><TextInput className="m-input" maxLength={200} placeholder="직접 적기 (선택)" value={own} onChange={event => setOwn(event.target.value)} enterKeyHint="done" /></label>
    </Sheet>}

    {big && info?.code && createPortal(<div className="r-full" role="dialog" aria-modal="true" aria-label="출석 QR과 코드 크게 보기">
      <span className="m-badge mint">{activity.title}</span>
      {image && <img src={image} alt="체크인 QR (크게)" />}
      <span className="r-full-hint">QR이 안 찍히면 이 숫자를 입력하세요</span>
      <b className="r-full-code">{info.code}</b>
      {timer}
      <small>{left}초 뒤 바뀌어요 · 출석 {here.length}/{expected}명</small>
      <button type="button" className="m-btn line" onClick={() => setBig(false)}>닫기</button>
    </div>, document.body)}
  </>
}
