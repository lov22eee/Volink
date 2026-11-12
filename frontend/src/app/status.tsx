// 내 이용 상태 (week 7, 2026-11-09): running limits (신청 / 글쓰기), 최근 90일 불참, warnings, my reports and appeals.
// 이의신청: 7 days after a no-show, a record or a sanction; the organizer answers first, then an admin.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, ApiError } from '../api'
import { Loading, MIcon, Sheet, TextArea, TopBar } from './ui'

type Limit = { until: string | null; reason: string } | null
export type Status = { noShows: number; apply: Limit; write: Limit; host?: Limit; warnings: number
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
    <span><b>{limit.until ? md(limit.until) + '까지 ' : ''}{both ? '신청·글쓰기가 제한돼요' : status.apply ? '신청할 수 없어요' : status.host ? (limit.until ? '글과 모집글을 쓸 수 없어요' : '커뮤니티 이용이 정지됐어요') : '글을 쓸 수 없어요'}</b><small>{limit.reason}</small></span>
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
      <p className="m-help">불참 90일 안 3번이면 14일 신청 제한 · 인정된 신고(1년 안)는 1번 경고, 2번 24시간 글쓰기 제한, 3번 7일 · 4번 14일 · 5번 30일 글·모집글 제한이에요. 신고로는 봉사 신청을 막지 않아요. 이의가 받아들여지면 횟수에서 빠져요.</p>
      {status.noShowList.length > 0 && <><h2 className="m-h3">불참 기록</h2><div className="m-list">{status.noShowList.map(n => <div key={n.participationId} className="m-row">
        <span className="m-row-main"><strong>{n.title}</strong><small>{md(n.date)} · 불참{n.appeal ? ' · ' + appealWord[n.appeal] : ''}</small></span>
        {n.appealable && !n.appeal && <button type="button" className="m-btn line sm" onClick={() => setAppeal({ kind: 'NO_SHOW', participationId: n.participationId, label: `${n.title} · ${md(n.date)} 불참` })}>이의 신청</button>}</div>)}</div></>}
      {status.sanctions.length > 0 && <><h2 className="m-h3">제재 기록</h2><div className="m-list">{status.sanctions.map(s => <div key={s.id} className="m-row">
        <span className="m-row-main"><strong>{s.type === 'WARNING' ? '경고' : s.type === 'SUSPENSION' && !s.endsAt && s.scope === 'POST' ? '커뮤니티 이용 정지' : s.scope === 'APPLY' ? '신청 제한' : s.scope === 'WRITE' ? '글쓰기 제한' : s.scope === 'POST' ? '글·모집글 제한' : '신청·글쓰기 제한'}{s.endsAt ? ` · ${md(s.endsAt)}까지` : ''}</strong>
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

/**
 * 경고 시트 (2026-11-12, user decision, V38): after a report is accepted (1·2·3회) or no-shows add up (2·3회) the next app
 * screen shows one sheet — a soft red ! in the middle, one line of what happened, why it matters, 자세히 보기 for the post or
 * the dates, and [확인] only after 확인했어요 is ticked. It does not close by tapping outside, dragging or Escape.
 */
type SafetyNotice = { id: number; kind: 'REPORT' | 'NOSHOW'; step: number; until: string | null
  targetType?: string; targetTitle?: string | null; targetBody?: string | null; reason?: string; note?: string | null
  noShows?: { title: string; startsAt: string }[] }
const dayTime = (iso: string) => `${md(iso)} ${iso.slice(11, 16)}`

/** "11월 19일까지", or with the time when it ends within two days (the 24시간 step). */
function untilWord(iso: string | null) {
  if (!iso) return ''
  const soon = new Date(iso.replace('T', ' ').replace(/-/g, '/')).getTime() - Date.now() < 2 * 86_400_000
  return md(iso) + (soon ? ' ' + iso.slice(11, 16) : '') + '까지'
}

export function noticeText(n: SafetyNotice): { title: string; lines: string[] } {
  const until = untilWord(n.until)
  if (n.kind === 'NOSHOW') return n.step >= 3
    ? { title: `${until} 신청할 수 없어요`, lines: ['불참이 3번 쌓였어요.', '제한이 끝나면 다시 함께해요. 약속한 봉사는 꼭 지켜 주세요.'] }
    : { title: '불참이 2번이에요', lines: ['불참이 누적되면 신청이 제한돼요.', '못 가게 되면 미리 취소해 주세요.'] }
  // Reports limit the community only (2026-11-12): 1 경고 · 2 24시간 글 · 3+ 글·모집글 7·14·30일 · 관리자 정지(기간 없음).
  if (n.step >= 3 && !n.until) return { title: '커뮤니티 이용이 정지됐어요', lines: ['신고가 여러 번 쌓여 관리자 확인을 거쳐 정지됐어요.', '봉사 신청·참여는 그대로 할 수 있어요.'] }
  if (n.step >= 3) return { title: `${until} 글과 모집글을 쓸 수 없어요`, lines: ['신고가 누적되어 제한이 길어졌어요.', '봉사 신청·참여는 그대로 할 수 있어요. 바른 활동을 기다릴게요.'] }
  if (n.step === 2) return { title: `${until} 글을 쓸 수 없어요`, lines: ['신고가 누적되면 이용이 더 제한돼요.', '봉사 신청·참여는 그대로 할 수 있어요. 활동에서 만나요!'] }
  return { title: '경고를 받았어요', lines: ['신고가 누적되면 커뮤니티 이용이 제한돼요.', '서로 존중하는 봉사 공간을 함께 만들어 주세요.'] }
}

const targetWord: Record<string, string> = { POST: '숨겨진 글', COMMENT: '숨겨진 댓글', PHOTO: '숨겨진 사진', ACTIVITY: '신고된 활동', USER: '신고 내용' }
const nextWord = (n: SafetyNotice) => n.kind === 'NOSHOW'
  ? (n.step >= 3 ? '이미 확정된 활동은 참여할 수 있어요' : '한 번 더 불참하면 14일 동안 신청할 수 없어요')
  : n.step === 1 ? '한 번 더 인정되면 24시간 동안 글을 쓸 수 없어요' : n.step === 2 ? '한 번 더 인정되면 7일 동안 글과 모집글을 쓸 수 없어요' : '봉사 신청·참여는 그대로 할 수 있어요'


export function SafetyNoticeSheet({ notice, onDone }: { notice: SafetyNotice; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const text = noticeText(notice)
  useEffect(() => { document.documentElement.classList.add('m-locked'); return () => document.documentElement.classList.remove('m-locked') }, [])
  async function confirm() {
    setBusy(true)
    try { await api('/api/me/safety-notice/' + notice.id + '/ack', 'POST'); onDone() } catch { setBusy(false) }
  }
  return createPortal(<div className="m-sheet-wrap">
    <div className="m-dim" />
    <section className="m-sheet sn-sheet" role="alertdialog" aria-modal="true" aria-labelledby="sn-title" aria-describedby="sn-text">
      <span className="m-grab" aria-hidden="true" />
      <div className="sn-body">
        <span className="sn-mark" aria-hidden="true">!</span>
        <h2 id="sn-title">{text.title}</h2>
        <p id="sn-text">{text.lines.map((line, i) => <span key={i}>{line}</span>)}</p>
        <button type="button" className="sn-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '접기' : '자세히 보기'}<MIcon name="chevron" size={14} /></button>
        {open && <dl className="sn-detail">
          {notice.kind === 'REPORT' ? <>
            {(notice.targetTitle || notice.targetBody) && <div><dt>{targetWord[notice.targetType ?? ''] ?? '신고 내용'}</dt><dd>{notice.targetTitle && <b>{notice.targetTitle}</b>}{notice.targetBody && <span>{notice.targetBody}</span>}</dd></div>}
            <div><dt>사유</dt><dd>{notice.reason}{notice.note ? ' · ' + notice.note : ''}</dd></div>
          </> : <>
            {notice.noShows?.[0] && <div><dt>불참한 활동</dt><dd><b>{notice.noShows[0].title}</b><span>{dayTime(notice.noShows[0].startsAt)} · 출석 확인 없음</span></dd></div>}
            {notice.noShows && notice.noShows.length > 0 && <div><dt>최근 90일 불참</dt><dd>{notice.noShows.length}번 ({notice.noShows.map(x => `${Number(x.startsAt.slice(5, 7))}/${Number(x.startsAt.slice(8, 10))}`).reverse().join(', ')})</dd></div>}
          </>}
          <div><dt>{notice.step >= 3 ? '제한 중에도' : '다음 단계'}</dt><dd>{nextWord(notice)}</dd></div>
        </dl>}
        <label className="m-check sn-check"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /><span className="m-box" />확인했어요</label>
        <button type="button" className="m-btn" disabled={!checked || busy} onClick={confirm}>확인</button>
        <a className="sn-appeal" href="#/my?view=status" onClick={() => { if (checked) void confirm() }}>이의 신청은 마이 › 내 이용 상태에서 (7일 안)</a>
      </div>
    </section>
  </div>, document.body)
}

/** Looks for a warning when the app opens, comes back to the front, or moves to another screen. */
export function SafetyNoticeHost({ tick }: { tick: string }) {
  const [notice, setNotice] = useState<SafetyNotice | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const look = () => { if (document.visibilityState === 'visible') api<SafetyNotice | Record<string, never>>('/api/me/safety-notice').then(x => setNotice('id' in x ? x as SafetyNotice : null)).catch(() => {}) }
    look()
    document.addEventListener('visibilitychange', look)
    return () => document.removeEventListener('visibilitychange', look)
  }, [tick, version])
  if (!notice) return null
  return <SafetyNoticeSheet key={notice.id} notice={notice} onDone={() => { setNotice(null); setVersion(v => v + 1) }} />
}
