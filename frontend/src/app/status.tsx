// 내 이용 상태 (week 7, 2026-11-09): running limits (신청 / 글쓰기), 최근 90일 불참, warnings, my reports and appeals.
// 이의신청: 7 days after a no-show, a record or a sanction; the organizer answers first, then an admin.
import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { Loading, MIcon, Sheet, TextArea, TopBar } from './ui'

type Limit = { until: string | null; reason: string } | null
export type Status = { noShows: number; apply: Limit; write: Limit; warnings: number
  sanctions: { id: number; type: string; scope: string; source: string; reason: string; startsAt: string; endsAt: string | null; revoked: boolean; appealable: boolean; appeal: string | null }[]
  noShowList: { participationId: number; activityId: number; title: string; date: string; appealable: boolean; appeal: string | null }[] }
type MyReport = { id: number; targetType: string; reasonLabel: string; status: string; resultNote: string | null; createdAt: string }
export type AppealTarget = { kind: 'NO_SHOW' | 'RECORD' | 'SANCTION'; participationId?: number; recordId?: number; sanctionId?: number; label: string }

const md = (iso: string) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`
const appealWord: Record<string, string> = { SUBMITTED: '모집자 확인 중', ESCALATED: '관리자 확인 중', ACCEPTED: '이의 인정', REJECTED: '이의 기각' }
const reportWord: Record<string, string> = { RECEIVED: '접수', REVIEWING: '처리 중', ACTION_TAKEN: '처리 완료', DISMISSED: '문제 없음' }

export function useStatus(): Status | null {
  const [status, setStatus] = useState<Status | null>(null)
  useEffect(() => { api<Status>('/api/me/status').then(setStatus).catch(() => {}) }, [])
  return status
}

/** 신청 제한 / 글쓰기 제한 card (마이 top, this screen). */
export function LimitCard({ status }: { status: Status }) {
  const limit = status.apply ?? status.write
  if (!limit) return null
  const both = status.apply && status.write
  return <a className="st-limit" href="#/my?view=status">
    <span className="st-limit-ico"><MIcon name="alert" size={20} /></span>
    <span><b>{limit.until ? md(limit.until) + '까지 ' : ''}{both ? '신청·글쓰기가 제한돼요' : status.apply ? '신청할 수 없어요' : '글을 쓸 수 없어요'}</b><small>{limit.reason}</small></span>
    <MIcon name="chevron" size={16} /></a>
}

export function AppealSheet({ target, onClose, onSent }: { target: AppealTarget; onClose: () => void; onSent: () => void }) {
  const [code, setCode] = useState(target.kind === 'SANCTION' ? 'TOO_MUCH' : 'ATTENDED')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const codes: [string, string][] = target.kind === 'SANCTION' ? [['TOO_MUCH', '조치가 지나쳐요'], ['OTHER', '기타']] : [['ATTENDED', '실제로 참여했어요'], ['TIME', '시간이 달라요'], ['OTHER', '기타']]
  async function send() {
    setBusy(true); setError('')
    try { await api('/api/appeals', 'POST', { kind: target.kind, participationId: target.participationId, recordId: target.recordId, sanctionId: target.sanctionId, reasonCode: code, reason: text.trim() }); onSent() }
    catch (cause) { setError(cause instanceof ApiError ? (Object.values(cause.fieldErrors)[0] ?? cause.message) : '보내지 못했어요.') } finally { setBusy(false) }
  }
  return <Sheet title="이의 신청" onClose={onClose} footer={<button type="button" className="m-btn" disabled={busy || text.trim().length < 5} onClick={send}>{busy ? '보내는 중…' : '보내기'}</button>}>
    <div className="rp-target"><MIcon name="record" size={16} /><span>{target.label}</span></div>
    <span className="m-label">무엇이 틀렸나요?</span>
    <div className="m-chips wrap">{codes.map(([k, label]) => <button key={k} type="button" className={'m-chip' + (code === k ? ' on' : '')} onClick={() => setCode(k)}>{label}</button>)}</div>
    <span className="m-label">자세히 알려 주세요</span>
    <TextArea className="m-input" rows={4} maxLength={1000} value={text} placeholder="예) QR이 안 찍혀서 모집자님께 직접 말씀드렸어요" onChange={e => setText(e.target.value)} />
    <p className="m-help">{target.kind === 'SANCTION' ? '관리자가 확인해요.' : '모집자가 먼저 답하고, 3일 안에 답이 없거나 다투면 관리자가 확인해요. 그동안 기록은 보류돼요.'}</p>
    {error && <p className="m-err" role="alert">{error}</p>}
  </Sheet>
}

export function StatusScreen() {
  const [status, setStatus] = useState<Status | null>(null)
  const [reports, setReports] = useState<MyReport[] | null>(null)
  const [appeal, setAppeal] = useState<AppealTarget | null>(null)
  const load = () => { api<Status>('/api/me/status').then(setStatus).catch(() => {}); api<MyReport[]>('/api/me/reports').then(setReports).catch(() => setReports([])) }
  useEffect(load, [])
  if (!status) return <div className="m-screen"><TopBar title="내 이용 상태" back="history" /><Loading /></div>
  return <div className="m-screen">
    <TopBar title="내 이용 상태" back="history" />
    <div className="m-body">
      <LimitCard status={status} />
      <section className="st-sum">
        <div><b>{status.noShows}</b><small>최근 90일 불참</small></div>
        <div><b>{status.warnings}</b><small>인정된 신고</small></div>
      </section>
      <p className="m-help">불참 90일 안 3번이면 14일 신청 제한 · 인정된 신고 1번 경고, 2번 7일 글쓰기 제한, 3번 30일 제한이에요. 이의가 받아들여지면 횟수에서 빠져요.</p>
      {status.noShowList.length > 0 && <><h2 className="m-h3">불참 기록</h2><div className="m-list">{status.noShowList.map(n => <div key={n.participationId} className="m-row">
        <span className="m-row-main"><strong>{n.title}</strong><small>{md(n.date)} · 불참{n.appeal ? ' · ' + appealWord[n.appeal] : ''}</small></span>
        {n.appealable && !n.appeal && <button type="button" className="m-btn line sm" onClick={() => setAppeal({ kind: 'NO_SHOW', participationId: n.participationId, label: `${n.title} · ${md(n.date)} 불참` })}>이의 신청</button>}</div>)}</div></>}
      {status.sanctions.length > 0 && <><h2 className="m-h3">제재 기록</h2><div className="m-list">{status.sanctions.map(s => <div key={s.id} className="m-row">
        <span className="m-row-main"><strong>{s.type === 'WARNING' ? '경고' : s.scope === 'APPLY' ? '신청 제한' : s.scope === 'WRITE' ? '글쓰기 제한' : '신청·글쓰기 제한'}{s.endsAt ? ` · ${md(s.endsAt)}까지` : ''}</strong>
          <small>{s.reason}{s.revoked ? ' · 풀림' : ''}{s.appeal ? ' · ' + appealWord[s.appeal] : ''}</small></span>
        {s.appealable && !s.appeal && !s.revoked && <button type="button" className="m-btn line sm" onClick={() => setAppeal({ kind: 'SANCTION', sanctionId: s.id, label: s.reason })}>이의 신청</button>}</div>)}</div></>}
      <h2 className="m-h3">내 신고</h2>
      {!reports ? <Loading /> : reports.length ? <div className="m-list">{reports.map(r => <div key={r.id} className="m-row">
        <span className="m-row-main"><strong>{r.reasonLabel}</strong><small>{r.createdAt.slice(5, 10).replace('-', '/')} · {reportWord[r.status] ?? r.status}{r.resultNote ? ' · ' + r.resultNote : ''}</small></span></div>)}</div>
        : <p className="m-help">신고한 내용이 없어요.</p>}
    </div>
    {appeal && <AppealSheet target={appeal} onClose={() => setAppeal(null)} onSent={() => { setAppeal(null); load() }} />}
  </div>
}

/** 모집 관리 › 출석: appeals about this activity; the organizer answers first (출석으로 바꾸기 / 그대로 두기 + 이유). */
export function HostAppeals({ activityId, onChanged }: { activityId: number; onChanged: () => void }) {
  const [list, setList] = useState<{ id: number; reasonLabel: string; reason: string; status: string; name: string; hostNote: string | null; hostDueAt: string | null }[] | null>(null)
  const [keeping, setKeeping] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const load = () => api<typeof list>('/api/activities/' + activityId + '/appeals').then(setList).catch(() => setList([]))
  useEffect(() => { void load() }, [activityId]) // eslint-disable-line react-hooks/exhaustive-deps
  async function answer(id: number, decision: 'ACCEPT' | 'KEEP') {
    try { await api('/api/appeals/' + id + '/answer', 'POST', { decision, note: decision === 'KEEP' ? note.trim() : '' }); setKeeping(null); setNote(''); void load(); onChanged() }
    catch (cause) { window.alert(cause instanceof ApiError ? (Object.values(cause.fieldErrors)[0] ?? cause.message) : '처리하지 못했어요.') }
  }
  const open = (list ?? []).filter(a => a.status === 'SUBMITTED')
  if (!open.length) return null
  return <div className="ha-list">{open.map(a => <div key={a.id} className="ha-card">
    <div className="ha-head"><b>{a.name}</b><span className="m-badge amber">이의 신청</span></div>
    <small>{a.reasonLabel}</small>
    <p>“{a.reason}”</p>
    {keeping === a.id ? <><TextArea className="m-input" rows={2} maxLength={500} value={note} placeholder="그대로 두는 이유 (신청자와 관리자에게 보여요)" onChange={e => setNote(e.target.value)} />
      <div className="m-two"><button type="button" className="m-btn line sm" onClick={() => setKeeping(null)}>돌아가기</button><button type="button" className="m-btn sm" disabled={note.trim().length < 2} onClick={() => answer(a.id, 'KEEP')}>그대로 두기</button></div></>
      : <div className="m-two"><button type="button" className="m-btn sm" onClick={() => answer(a.id, 'ACCEPT')}>출석으로 바꾸기</button><button type="button" className="m-btn line sm" onClick={() => setKeeping(a.id)}>그대로 두기</button></div>}
    {a.hostDueAt && <small className="ha-due">{md(a.hostDueAt)} {a.hostDueAt.slice(11, 16)}까지 답하지 않으면 관리자가 확인해요</small>}
  </div>)}</div>
}
