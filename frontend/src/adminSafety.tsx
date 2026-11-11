// 관리자 신고함 · 이의함 (week 7, 2026-11-09, PC). A decision always carries a reason (it is sent to the people involved and
// kept in admin_actions). Report photos are opened with the admin's token only; they have no public address.
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, apiBlob } from './api'

type Report = { id: number; targetType: string; targetId: number; reason: string; reasonLabel: string; description: string; status: string; resultNote: string | null
  createdAt: string; summary: string; sameTarget: number; warnings: number; evidence: number[] }
type Appeal = { id: number; kind: string; reasonLabel: string; reason: string; status: string; hostNote: string | null; resultNote: string | null; submittedAt: string
  name: string; subject: string; checkInMethod: string | null; sanctionType: string | null }

const targetWord: Record<string, string> = { ACTIVITY: '활동', POST: '게시글', COMMENT: '댓글', USER: '사용자', PHOTO: '사진' }
const kindWord: Record<string, string> = { NO_SHOW: '불참', RECORD: '활동 기록', SANCTION: '제재' }
const message = (cause: unknown) => cause instanceof ApiError ? (Object.values(cause.fieldErrors)[0] ?? cause.message) : '처리하지 못했습니다.'

function Evidence({ id }: { id: number }) {
  const [url, setUrl] = useState('')
  useEffect(() => { let made = ''; apiBlob('/api/admin/evidences/' + id).then(blob => { made = URL.createObjectURL(blob); setUrl(made) }).catch(() => {}); return () => { if (made) URL.revokeObjectURL(made) } }, [id])
  return url ? <a href={url} target="_blank" rel="noreferrer"><img className="ev-thumb" src={url} alt="신고 증빙 사진" /></a> : <span className="ev-thumb" />
}

export function AdminReports() {
  const [tab, setTab] = useState<'OPEN' | 'DONE'>('OPEN')
  const [list, setList] = useState<Report[] | null>(null)
  const [notice, setNotice] = useState('')
  const load = useCallback(() => { setList(null); api<Report[]>('/api/admin/reports?status=' + tab).then(setList).catch(() => setList([])) }, [tab])
  useEffect(() => { load() }, [load])
  return <>
    <div className="admin-head"><div><p className="crumb"><a href="#/admin">관리자</a> / 신고함</p><h1>신고함</h1><p className="hint">인정하면 글을 숨기고 작성자의 누적 단계가 올라가요 (1회 경고 · 2회 7일 글쓰기 제한 · 3회 30일 제한). 사유는 신고자와 작성자에게 보내져요.</p></div></div>
    {notice && <div className="notice ok" role="status">{notice}</div>}
    <div className="seg-tabs" role="tablist">{(['OPEN', 'DONE'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'OPEN' ? '처리 전' : '처리 완료'}</button>)}</div>
    <section className="admin-card">
      {list === null ? <div className="loading-state" role="status">불러오는 중입니다.</div> : list.length === 0 ? <p className="empty-line">{tab === 'OPEN' ? '처리할 신고가 없습니다.' : '처리한 신고가 없습니다.'}</p>
        : <ul className="review-list">{list.map(r => <ReportItem key={r.id} report={r} onDone={text => { setNotice(text); load() }} />)}</ul>}
    </section>
  </>
}

function ReportItem({ report, onDone }: { report: Report; onDone: (text: string) => void }) {
  const [decision, setDecision] = useState<'ACCEPT' | 'DISMISS'>('ACCEPT')
  const [hide, setHide] = useState(report.targetType === 'POST' || report.targetType === 'COMMENT' || report.targetType === 'PHOTO')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const open = report.status === 'RECEIVED' || report.status === 'REVIEWING'
  async function send() {
    try { await api('/api/admin/reports/' + report.id + '/decision', 'POST', { decision, hide, reason }); onDone(decision === 'ACCEPT' ? '신고를 인정하고 알렸습니다.' : '문제 없음으로 처리했습니다.') }
    catch (cause) { setError(message(cause)) }
  }
  return <li className="safety-item">
    <div><span className="status-chip wait">{report.reasonLabel}</span> <strong>{targetWord[report.targetType] ?? report.targetType} · {report.summary}</strong>
      <span>신고 {report.sameTarget}건 · 작성자 이전 인정 {report.warnings}회 · {report.createdAt}</span>
      {report.description && <small>“{report.description}”</small>}
      {report.evidence.length > 0 && <div className="ev-row">{report.evidence.map(id => <Evidence key={id} id={id} />)}</div>}
      {!open && <small>처리: {report.status === 'ACTION_TAKEN' ? '인정' : '문제 없음'} · {report.resultNote}</small>}</div>
    {open && <div className="safety-form">
      <div className="seg-tabs small">{(['ACCEPT', 'DISMISS'] as const).map(d => <button key={d} aria-selected={decision === d} onClick={() => setDecision(d)}>{d === 'ACCEPT' ? '인정' : '문제 없음'}</button>)}</div>
      {decision === 'ACCEPT' && report.targetType !== 'USER' && report.targetType !== 'ACTIVITY' && <label className="check-line"><input type="checkbox" checked={hide} onChange={e => setHide(e.target.checked)} /> 숨김 처리</label>}
      <input className="text-input" value={reason} maxLength={500} placeholder="처리 사유 (필수 · 당사자에게 보내져요)" onChange={e => { setReason(e.target.value); setError('') }} />
      <button className="primary-button" disabled={!reason.trim()} onClick={send}>처리하기</button>
      {error && <span className="field-error">{error}</span>}
    </div>}
  </li>
}

export function AdminAppeals() {
  const [tab, setTab] = useState<'OPEN' | 'DONE'>('OPEN')
  const [list, setList] = useState<Appeal[] | null>(null)
  const [notice, setNotice] = useState('')
  const load = useCallback(() => { setList(null); api<Appeal[]>('/api/admin/appeals?status=' + tab).then(setList).catch(() => setList([])) }, [tab])
  useEffect(() => { load() }, [load])
  return <>
    <div className="admin-head"><div><p className="crumb"><a href="#/admin">관리자</a> / 이의함</p><h1>이의함</h1><p className="hint">모집자가 그대로 두었거나 3일 안에 답하지 않은 이의, 제재에 대한 이의예요. 인정하면 불참이 출석으로 바뀌고 횟수에서 빠지거나 제재가 풀려요.</p></div></div>
    {notice && <div className="notice ok" role="status">{notice}</div>}
    <div className="seg-tabs" role="tablist">{(['OPEN', 'DONE'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'OPEN' ? '판단 필요' : '처리 완료'}</button>)}</div>
    <section className="admin-card">
      {list === null ? <div className="loading-state" role="status">불러오는 중입니다.</div> : list.length === 0 ? <p className="empty-line">{tab === 'OPEN' ? '판단할 이의가 없습니다.' : '처리한 이의가 없습니다.'}</p>
        : <ul className="review-list">{list.map(a => <AppealItem key={a.id} appeal={a} onDone={text => { setNotice(text); load() }} />)}</ul>}
    </section>
  </>
}

function AppealItem({ appeal, onDone }: { appeal: Appeal; onDone: (text: string) => void }) {
  const [decision, setDecision] = useState<'ACCEPT' | 'REJECT'>('ACCEPT')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const open = appeal.status === 'ESCALATED' || appeal.status === 'SUBMITTED'
  async function send() {
    try { await api('/api/admin/appeals/' + appeal.id + '/decision', 'POST', { decision, reason }); onDone(decision === 'ACCEPT' ? '이의를 인정했습니다.' : '기각했습니다.') }
    catch (cause) { setError(message(cause)) }
  }
  return <li className="safety-item">
    <div><span className="status-chip wait">{kindWord[appeal.kind] ?? appeal.kind}</span> <strong>{appeal.subject} · {appeal.reasonLabel}</strong>
      <span>{appeal.name} · {appeal.submittedAt}{appeal.status === 'SUBMITTED' ? ' · 모집자 답 기다리는 중' : ''}</span>
      <small>신청자: “{appeal.reason}”</small>
      {appeal.hostNote && <small>모집자: “{appeal.hostNote}”</small>}
      {appeal.kind !== 'SANCTION' && <small>출석 기록: {appeal.checkInMethod ? (appeal.checkInMethod === 'QR' ? 'QR 출석' : '수동 확인') : '체크인 없음'}</small>}
      {!open && <small>처리: {appeal.status === 'ACCEPTED' ? '인정' : '기각'} · {appeal.resultNote}</small>}</div>
    {open && <div className="safety-form">
      <div className="seg-tabs small">{(['ACCEPT', 'REJECT'] as const).map(d => <button key={d} aria-selected={decision === d} onClick={() => setDecision(d)}>{d === 'ACCEPT' ? '인정' : '기각'}</button>)}</div>
      <input className="text-input" value={reason} maxLength={500} placeholder="판단 사유 (필수 · 신청자에게 보내져요)" onChange={e => { setReason(e.target.value); setError('') }} />
      <button className="primary-button" disabled={!reason.trim()} onClick={send}>처리하기</button>
      {error && <span className="field-error">{error}</span>}
    </div>}
  </li>
}
