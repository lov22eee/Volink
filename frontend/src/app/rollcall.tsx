// 출석부 (organizer, app): QR + 4-digit code on top, then who is here and who is not yet (before check-in opens: only who is confirmed).
// Anyone not yet here can be checked in by hand with a reason, one at a time or several at once with one reason
// (e.g. people who applied on a PC and have no phone with them). Every manual check-in keeps its reason.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { api, ApiError, checkInLink } from '../api'
import type { Applicant, LiveActivity } from '../api'
import { showToast } from '../App'
import { hhmm } from '../checkin'
import type { Phase, QrInfo } from '../checkin'
import { ActionBar, MIcon, Sheet, TextInput } from './ui'

/** Keeps the phone screen on while the QR is shown (app only; ScreenPlugin). */
const screen = registerPlugin<{ keepOn(options: { on: boolean }): Promise<void> }>('VolinkScreen')
const keepOn = (on: boolean) => { if (Capacitor.isNativePlatform()) void screen.keepOn({ on }).catch(() => {}) }

const reasons = ['휴대폰 없음', '앱·로그인 안 됨', '위치 안 잡힘', '얼굴로 확인함']
const methodTag: Record<string, { text: string; tone: string }> = { QR: { text: 'QR', tone: '' }, CODE: { text: '코드', tone: '' }, MANUAL: { text: '수동', tone: 'man' } }

export function RollCall({ activity, people, phase, opens, closes, onChanged }: { activity: LiveActivity; people: Applicant[]; phase: Phase; opens: number; closes: number; onChanged: () => void }) {
  const [info, setInfo] = useState<QrInfo | null>(null)
  const [image, setImage] = useState('')
  const [left, setLeft] = useState(30)
  // When the current code ends (this phone's clock). The bar shrinks smoothly by a CSS animation from the server's seconds left.
  const [until, setUntil] = useState(0)
  const [span, setSpan] = useState(30)
  const [big, setBig] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<number[]>([])
  const [target, setTarget] = useState<Applicant[] | null>(null)
  const [reason, setReason] = useState(reasons[0])
  const [own, setOwn] = useState('')
  const [busy, setBusy] = useState(false)
  const open = phase === 'open'
  const canManual = phase === 'open' || phase === 'wait' || phase === 'late'
  const [starting, setStarting] = useState(false)
  // [출석 시작] (2026-11-08): opens QR / code check-in and tells the confirmed participants.
  async function startNow() {
    setStarting(true)
    try {
      const result = await api<{ notified: number }>('/api/activities/' + activity.id + '/checkin/start', 'POST', {})
      showToast('출석을 시작했어요', `참가자 ${result.notified}명에게 알렸어요`)
      load(); onChanged()
    } catch (cause) {
      showToast(cause instanceof ApiError ? cause.message : '출석을 시작하지 못했어요')
    } finally { setStarting(false) }
  }

  const load = useCallback(() => api<QrInfo>('/api/activities/' + activity.id + '/qr').then(next => {
    const secs = Math.max(1, next.codeSecondsLeft ?? next.rotateSeconds)
    setInfo(next); setSpan(secs); setLeft(secs); setUntil(Date.now() + secs * 1000)
  }).catch(() => setInfo(null)), [activity.id])
  useEffect(() => { load() }, [load, phase])
  // A new QR and code when the 30-second slot turns over (asked again from the server); the list follows along.
  useEffect(() => {
    if (!info?.open || !until) return
    const tick = window.setInterval(() => {
      const rest = until - Date.now()
      if (rest <= 0) { window.clearInterval(tick); setUntil(0); load(); onChanged(); return }
      setLeft(Math.ceil(rest / 1000))
    }, 200)
    return () => window.clearInterval(tick)
  }, [info?.open, until, load, onChanged])
  const url = info?.token ? checkInLink(activity.id, info.token) : ''
  useEffect(() => { if (url) QRCode.toDataURL(url, { width: 560, margin: 1 }).then(setImage).catch(() => setImage('')); else setImage('') }, [url])

  const here = people.filter(p => p.status === 'CHECKED_IN' || p.status === 'COMPLETED')
  const notYet = people.filter(p => p.status === 'CONFIRMED')
  const expected = here.length + notYet.length + people.filter(p => p.status === 'NO_SHOW').length

  // 실시간 (2026-11-08): while the QR is open the list is read every 5 s; a new arrival shows a toast and '방금' for a minute.
  useEffect(() => {
    if (!open) return
    const poll = window.setInterval(onChanged, 5000)
    return () => window.clearInterval(poll)
  }, [open, onChanged])
  const seen = useRef<Set<number> | null>(null)
  const [just, setJust] = useState<Record<number, number>>({})
  useEffect(() => {
    const ids = new Set(here.map(p => p.id))
    if (seen.current && open) {
      const fresh = here.filter(p => !seen.current!.has(p.id))
      if (fresh.length) {
        showToast(fresh.length === 1 ? `${fresh[0].name} 님이 출석했어요 · ${here.length}/${expected}` : `${fresh.length}명이 출석했어요 · ${here.length}/${expected}`)
        const at = Date.now()
        setJust(prev => ({ ...prev, ...Object.fromEntries(fresh.map(p => [p.id, at])) }))
      }
    }
    seen.current = ids
  }, [here.map(p => p.id).join(','), open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!Object.keys(just).length) return
    const t = window.setTimeout(() => setJust(prev => Object.fromEntries(Object.entries(prev).filter(([, at]) => Date.now() - at < 60_000))), 5000)
    return () => window.clearTimeout(t)
  }, [just])
  // Everyone confirmed is here: a ✓ instead of the QR (it can be shown again for someone late).
  const allIn = open && expected > 0 && notYet.length === 0
  const [showAgain, setShowAgain] = useState(false)
  const showQr = open && (!allIn || showAgain)
  useEffect(() => { keepOn(showQr || big); return () => keepOn(false) }, [showQr, big])

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

  const timer = <span className="r-timer" aria-hidden="true"><i key={until} style={{ '--from': Math.min(1, span / 30), animationDuration: span + 's' } as CSSProperties} /></span>
  return <>
    {allIn && !showAgain ? <section className="r-alldone" aria-label="모두 출석">
      <span className="r-alldone-ico"><MIcon name="check" size={30} /></span>
      <strong>모두 출석했어요</strong><small>{here.length}/{expected}명</small>
      <button type="button" className="m-text-btn" onClick={() => setShowAgain(true)}>QR 다시 띄우기</button>
    </section>
    : open && info?.code ? <section className="r-qr" aria-label="출석 QR과 코드">
      <button type="button" className="r-qr-img" aria-label="QR 크게 보기" onClick={() => setBig(true)}>{image && <img src={image} alt="체크인 QR" data-url={url} />}</button>
      <div className="r-qr-info"><small>출석 코드</small><b className="r-code">{info.code}</b>{timer}<small>{left}초</small></div>
    </section>
      : phase === 'wait' ? <section className="r-start" aria-label="출석 시작">
        <span className="r-start-ico"><MIcon name="qr" size={30} /></span>
        <strong>아직 출석을 시작하지 않았어요</strong>
        <small>{hhmm(closes)}(종료 30분 전)까지 열 수 있어요.<br />누르면 참가자 {notYet.length}명에게 알림이 가요.</small>
      </section>
      : phase === 'later' || phase === 'soon' ? <div className="m-note"><strong>출석은 {hhmm(opens)}부터 시작할 수 있어요</strong><span>현장에 도착하면 [출석 시작]을 눌러 주세요.</span></div>
      : phase === 'late' ? <div className="m-note warm"><strong>QR·코드 체크인 시간이 지났어요</strong></div>
      : null}

    {(phase === 'later' || phase === 'soon') ? <>
      <div className="r-sec"><h3><MIcon name="users" size={18} />참가 확정 <b>{notYet.length + here.length}</b>명</h3></div>
      {notYet.length + here.length ? <ul className="r-roll">{[...here, ...notYet].map(p => <li key={p.id}>
        <span className="m-avatar sm"><MIcon name="user" size={16} /></span>
        <span className="r-nm"><b>{p.name}</b>{p.lateMinutes ? <small className="late">약 {p.lateMinutes}분 늦어요</small> : null}</span>
      </li>)}</ul> : <p className="r-empty">아직 확정된 참가자가 없어요.</p>}
    </> : <>
    <div className="r-sec"><h3><MIcon name="checkCircle" size={18} />출석 <b key={here.length} className="r-count">{here.length}</b>/{expected}</h3>
      {showQr && <small className="r-awake"><MIcon name="moon" size={13} />화면 꺼짐 방지 중</small>}</div>
    {open && expected > 0 && <i className="r-bar" aria-hidden="true"><span style={{ width: (here.length / expected * 100) + '%' }} /></i>}
    {here.length ? <ul className="r-roll">{here.map(p => <li key={p.id}>
      <span className="r-ok"><MIcon name="check" size={15} /></span>
      <span className="r-nm"><b>{p.name}{just[p.id] && <em className="r-just">방금</em>}</b><small>{p.checkedInAt ?? ''}{p.checkInReason ? ' · ' + p.checkInReason : ''}{p.status === 'COMPLETED' ? ' · 완료 확인' : ''}</small></span>
      {p.checkInMethod && <span className={'r-tag ' + (methodTag[p.checkInMethod]?.tone ?? '')}>{methodTag[p.checkInMethod]?.text ?? p.checkInMethod}</span>}
    </li>)}</ul> : <p className="r-empty">아직 출석한 사람이 없어요.</p>}

    {phase !== 'ended' && <>
      <div className="r-sec"><h3><MIcon name="clock" size={18} />미출석 <b>{notYet.length}</b></h3>
        {canManual && notYet.length > 1 && <button type="button" className="m-text-btn" onClick={() => { setSelecting(!selecting); setPicked([]) }}>{selecting ? '선택 취소' : '여러 명 선택'}</button>}</div>
      {notYet.length ? <ul className="r-roll">{notYet.map(p => {
        const on = picked.includes(p.id)
        return <li key={p.id} className={on ? 'sel' : ''} onClick={selecting ? () => setPicked(on ? picked.filter(x => x !== p.id) : [...picked, p.id]) : undefined}>
          {selecting ? <span className={'r-cb' + (on ? ' on' : '')} role="checkbox" aria-checked={on} aria-label={p.name + ' 선택'}>{on && <MIcon name="check" size={14} />}</span> : <span className="r-no" />}
          <span className="r-nm"><b>{p.name}</b>{p.lateMinutes ? <small className="late">약 {p.lateMinutes}분 늦어요</small> : null}</span>
          {!selecting && canManual && <button type="button" className="m-btn xs line" onClick={() => { setTarget([p]); setReason(reasons[0]); setOwn('') }}>출석 체크</button>}
        </li>
      })}</ul> : <p className="r-empty">{allIn && !showAgain ? '남은 사람이 없어요' : '모두 출석했어요'}</p>}
    </>}
    </>}
    {phase === 'ended' && notYet.length > 0 && <p className="m-help">{activity.checkinOpenedAt ? `체크인하지 않은 ${notYet.length}명은 불참으로 처리돼요.` : `출석을 열지 않아 ${notYet.length}명은 출석 미확인으로 남아요 (불참 처리 안 함).`}</p>}

    {selecting ? <ActionBar><button className="m-btn" disabled={!picked.length} onClick={() => { setTarget(notYet.filter(p => picked.includes(p.id))); setReason(reasons[0]); setOwn('') }}>{picked.length ? `${picked.length}명 출석 처리` : '출석 처리할 사람을 골라요'}</button></ActionBar>
      : phase === 'wait' ? <ActionBar><button className="m-btn" disabled={starting} onClick={startNow}><MIcon name="qr" size={19} />{starting ? '시작하는 중…' : '출석 시작'}</button></ActionBar>
      : showQr && info?.code && <ActionBar><button className="m-btn" onClick={() => setBig(true)}><MIcon name="qr" size={19} />QR·코드 크게 띄우기</button></ActionBar>}

    {target && <Sheet title={target.length === 1 ? target[0].name + ' 님 출석 확인' : target.length + '명 출석 확인'} onClose={() => setTarget(null)}
      footer={<button type="button" className="m-btn" disabled={busy || !(own.trim() || reason)} onClick={confirm}>{busy ? '처리 중…' : '출석 확인'}</button>}>
      {target.length > 1 && <div className="m-labels">{target.map(p => <span key={p.id} className="m-badge gray">{p.name}</span>)}</div>}
      <span className="m-label">사유</span>
      <div className="r-reasons">{reasons.map(x => <button key={x} type="button" className={reason === x && !own.trim() ? 'on' : ''} aria-pressed={reason === x && !own.trim()} onClick={() => { setReason(x); setOwn('') }}>{x}</button>)}</div>
      <label className="m-field"><span className="sr-only">직접 적기</span><TextInput className="m-input" maxLength={200} placeholder="직접 적기 (선택)" value={own} onChange={event => setOwn(event.target.value)} enterKeyHint="done" /></label>
    </Sheet>}

    {big && info?.code && createPortal(<div className="r-full" role="dialog" aria-modal="true" aria-label="출석 QR과 코드 크게 보기">
      <span className="m-badge mint">{activity.title}</span>
      {image && <img src={image} alt="체크인 QR (크게)" />}
      <span className="r-full-hint">QR이 안 찍히면 이 숫자를 입력하세요</span>
      <b className="r-full-code">{info.code}</b>
      {timer}
      <small>{left}초 · 출석 {here.length}/{expected}명</small>
      <button type="button" className="m-btn line" onClick={() => setBig(false)}>닫기</button>
    </div>, document.body)}
  </>
}
