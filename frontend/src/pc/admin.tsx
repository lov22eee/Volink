// 관리자 콘솔 (PC, 2026-11-11). 할 일 = one queue of everything waiting for a decision (신고 · 이의 · 활동 검토 · 기관 확인),
// oldest first; a decision always has a reason and opens the next item. 찾기 (회원), 현황 (numbers and the server), 기록
// (admin_actions) and 장소. Decisions use the existing admin APIs only.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError, apiBlob } from '../api'
import type { LiveActivity, PlaceInfo, User } from '../api'
import { PlaceEditor } from '../App'
import { ago, hoursSince, Loading, Logo, Panel, PcIcon, minutesWord, when } from './ui'

type Report = { id: number; targetType: string; targetId: number; reason: string; reasonLabel: string; description: string; status: string; createdAt: string; summary: string; sameTarget: number; warnings: number; evidence: number[] }
type Appeal = { id: number; kind: string; reasonLabel: string; reason: string; status: string; hostNote: string | null; submittedAt: string; name: string; subject: string; checkInMethod: string | null; sanctionType: string | null }
type Org = { id: number; name: string; orgType?: string | null; contact: string; address?: string | null; vmsRegistered?: boolean | null; vmsCode?: string | null; managerName: string; managerEmail: string; requestedAt: string }
type Item = { key: string; kind: 'REPORT' | 'APPEAL' | 'ACTIVITY' | 'ORG'; title: string; sub: string; at: string | null; report?: Report; appeal?: Appeal; activity?: LiveActivity; org?: Org }
type Action = { id: number; at: string; admin: string; targetType: string; targetId: number; action: string; reason: string; targetName: string | null }

const kindTag: Record<Item['kind'], [string, string]> = { REPORT: ['신고', 'red'], APPEAL: ['이의', 'blu'], ACTIVITY: ['검토', 'amb'], ORG: ['기관', 'g'] }
const targetWord: Record<string, string> = { ACTIVITY: '활동', POST: '게시글', COMMENT: '댓글', USER: '회원', PHOTO: '사진' }
const appealWord: Record<string, string> = { NO_SHOW: '불참 이의', RECORD: '활동 기록 이의', SANCTION: '제재 이의' }
const orgTypeWord: Record<string, string> = { VOLUNTEER_CENTER: '자원봉사센터', WELFARE: '복지관·복지시설', SCHOOL: '학교·교육기관', NONPROFIT: '비영리단체', PUBLIC: '공공기관', OTHER: '기타' }
export const reasonWord: Record<string, string> = { CONTACT: '연락처·외부 유도', DANGER: '위험한 활동', ABUSE: '욕설·혐오', SPAM: '광고·도배', FALSE_RECORD: '노쇼·허위 기록', PRIVACY: '개인정보 노출', OTHER: '기타', SAFETY: '안전', HARASSMENT: '괴롭힘', INAPPROPRIATE: '부적절한 내용' }
const ladder = ['', '경고', '7일 글쓰기 제한', '30일 글쓰기 제한']
const failText = (cause: unknown) => cause instanceof ApiError ? (Object.values(cause.fieldErrors)[0] ?? cause.message) : '처리하지 못했어요.'

export function AdminConsole({ parts, query, user, onSignOut }: { parts: string[]; query: URLSearchParams; user: User; onSignOut: () => void }) {
  const section = parts[1] ?? ''
  const [count, setCount] = useState<number | null>(null)
  const [words, setWords] = useState(query.get('q') ?? '')
  const nav: [string, string][] = [['', '할 일'], ['find', '찾기'], ['stats', '현황'], ['log', '기록'], ['places', '장소']]
  return <div className="pc">
    <header className="pc-hd dark">
      <Logo sub="관리자" href="#/admin" />
      <nav className="pc-nav" aria-label="관리자 메뉴">{nav.map(([key, label]) => <a key={key} href={'#/admin' + (key ? '/' + key : '')} aria-current={section === key ? 'page' : undefined}>{label}{key === '' && count ? ` ${count}` : ''}</a>)}</nav>
      <div className="pc-sp" />
      <form onSubmit={e => { e.preventDefault(); window.location.hash = '#/admin/find?q=' + encodeURIComponent(words.trim()) }} style={{ position: 'relative' }}>
        <label><span className="sr">회원 찾기</span><input value={words} onChange={e => setWords(e.target.value)} placeholder="회원 이메일·이름·닉네임" style={{ width: 250, height: 34, borderRadius: 8, border: '1px solid #3b443f', background: '#2c332f', color: '#fff', padding: '0 10px 0 32px' }} /></label>
        <span style={{ position: 'absolute', left: 10, top: 9, color: '#8f9993' }}><PcIcon name="search" /></span></form>
      <div className="pc-who"><span>{user.name}</span><button type="button" onClick={onSignOut}>로그아웃</button></div>
    </header>
    {section === '' && <Queue onCount={setCount} />}
    {section === 'find' && (parts[2] ? <Member id={Number(parts[2])} /> : <Find q={query.get('q') ?? ''} />)}
    {section === 'stats' && <Stats />}
    {section === 'log' && <Log type={query.get('type') ?? ''} />}
    {section === 'places' && <Places />}
  </div>
}

/* ---------------- 할 일 ---------------- */

function Queue({ onCount }: { onCount: (n: number) => void }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [waitingHost, setWaitingHost] = useState(0)
  const [failed, setFailed] = useState(false)
  const [pick, setPick] = useState(0)
  const [filter, setFilter] = useState<Item['kind'] | ''>('')
  const [handled, setHandled] = useState(0)
  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [reports, appeals, activities, orgs] = await Promise.all([
        api<Report[]>('/api/admin/reports?status=OPEN'), api<Appeal[]>('/api/admin/appeals?status=OPEN'),
        api<LiveActivity[]>('/api/admin/activities'), api<Org[]>('/api/admin/organizations?status=PENDING')])
      const list: Item[] = []
      const seen = new Set<string>()
      for (const r of [...reports].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        const target = r.targetType + ':' + r.targetId
        if (seen.has(target)) continue
        seen.add(target)
        list.push({ key: 'r' + r.id, kind: 'REPORT', title: `${targetWord[r.targetType] ?? r.targetType} · ${r.summary}`, sub: `${r.reasonLabel} · 신고 ${r.sameTarget}건`, at: r.createdAt, report: r })
      }
      const ready = appeals.filter(a => a.status === 'ESCALATED' || a.kind === 'SANCTION')
      setWaitingHost(appeals.length - ready.length)
      for (const a of ready) list.push({ key: 'a' + a.id, kind: 'APPEAL', title: `${a.subject}`, sub: `${appealWord[a.kind] ?? '이의'} · ${a.reasonLabel}${a.hostNote ? ' · 모집자 답변 있음' : ''}`, at: a.submittedAt, appeal: a })
      for (const a of activities) list.push({ key: 'v' + a.id, kind: 'ACTIVITY', title: a.title, sub: `검토 사유 · ${a.riskReasons || '확인 필요'}`, at: null, activity: a })
      for (const o of orgs) list.push({ key: 'o' + o.id, kind: 'ORG', title: o.name, sub: `${o.orgType ? orgTypeWord[o.orgType] ?? o.orgType : '기관'} · 가입 신청`, at: o.requestedAt, org: o })
      list.sort((x, y) => (x.at ?? '9').localeCompare(y.at ?? '9'))
      setItems(list)
      onCount(list.length)
    } catch { setFailed(true); setItems([]) }
  }, [onCount])
  useEffect(() => { void load() }, [load])
  const shown = useMemo(() => (items ?? []).filter(i => !filter || i.kind === filter), [items, filter])
  const current = shown[Math.min(pick, Math.max(0, shown.length - 1))]
  function done() {
    setHandled(n => n + 1)
    setItems(old => {
      const next = (old ?? []).filter(i => i.key !== current?.key)
      onCount(next.length)
      return next
    })
  }
  if (items === null) return <main className="pc-main"><Loading /></main>
  if (failed) return <main className="pc-main"><p className="pc-err">처리할 일을 불러오지 못했어요. <button className="pc-link" onClick={() => void load()}>다시 시도</button></p></main>
  if (!items.length) return <main className="pc-main"><AllDone handled={handled} waitingHost={waitingHost} /></main>
  const counts = (k: Item['kind']) => items.filter(i => i.kind === k).length
  return <main className="pc-main">
    <div className="pc-queue">
      <section className="pc-pn list" aria-label="처리할 일 목록">
        <div className="pc-ph" style={{ flexWrap: 'wrap' }}><h2>남은 일 {items.length}건</h2>{handled > 0 && <small>방금 {handled}건 처리</small>}
          <div className="pc-chips" style={{ width: '100%', marginTop: 4 }}>{([['', '전체', items.length], ['REPORT', '신고', counts('REPORT')], ['APPEAL', '이의', counts('APPEAL')], ['ACTIVITY', '검토', counts('ACTIVITY')], ['ORG', '기관', counts('ORG')]] as [Item['kind'] | '', string, number][])
            .map(([k, label, n]) => <button key={label} type="button" aria-pressed={filter === k} onClick={() => { setFilter(k); setPick(0) }}>{label} {n}</button>)}</div></div>
        {shown.map((item, i) => {
          const late = item.at ? hoursSince(item.at) >= 24 : false
          return <button key={item.key} type="button" className={'row' + (item === current ? ' on' : '')} onClick={() => setPick(i)}>
            <span className="n">{i + 1}</span><span className={'pc-tag ' + kindTag[item.kind][1]}>{kindTag[item.kind][0]}</span>
            <span className="m"><b>{item.title}</b><small>{item.sub}</small></span>
            <span className={'age' + (late ? ' late' : '')}>{item.at ? ago(item.at) : '새 글'}</span></button>
        })}
        {waitingHost > 0 && <p className="pc-note" style={{ padding: '10px 14px' }}>모집자 답변을 기다리는 이의 {waitingHost}건은 3일이 지나면 여기로 와요.</p>}
      </section>
      {current && <Case key={current.key} item={current} position={`${shown.indexOf(current) + 1} / ${shown.length}`} onDone={done} />}
    </div>
  </main>
}

function Case({ item, position, onDone }: { item: Item; position: string; onDone: () => void }) {
  const [choice, setChoice] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const r = item.report, a = item.appeal, v = item.activity, o = item.org
  const hideable = r && ['POST', 'COMMENT', 'PHOTO'].includes(r.targetType)
  const choices: [string, string][] = r ? [...(hideable ? [['HIDE', '인정 · 숨김'] as [string, string]] : []), ['ACCEPT', hideable ? '인정 · 숨기지 않음' : '인정'], ['DISMISS', '문제 없음']]
    : a ? [['ACCEPT', '인정'], ['REJECT', '기각']] : [['APPROVE', '승인'], ['REJECT', '반려']]
  const pickNow = choice || choices[0][0]
  const reasonNeeded = !(v || o) || pickNow === 'REJECT'
  async function send() {
    if (reasonNeeded && !reason.trim()) { setError('사유를 적어 주세요. 당사자에게 보내져요.'); return }
    setBusy(true); setError('')
    try {
      if (r) await api('/api/admin/reports/' + r.id + '/decision', 'POST', { decision: pickNow === 'DISMISS' ? 'DISMISS' : 'ACCEPT', hide: pickNow === 'HIDE', reason })
      else if (a) await api('/api/admin/appeals/' + a.id + '/decision', 'POST', { decision: pickNow, reason })
      else if (v) await api('/api/admin/activities/' + v.id + (pickNow === 'APPROVE' ? '/approve' : '/reject'), 'POST', { reason })
      else if (o) await api('/api/admin/organizations/' + o.id + (pickNow === 'APPROVE' ? '/approve' : '/reject'), 'POST', { reason })
      onDone()
    } catch (cause) { setError(failText(cause)) } finally { setBusy(false) }
  }
  const [tagText, tagTone] = kindTag[item.kind]
  let left: ReactNode = null
  if (r) left = <>
    <div><h3>신고된 {targetWord[r.targetType] ?? '내용'}</h3><div className="pc-q">{r.summary}</div></div>
    <div><h3>신고 내용</h3><div className="pc-kv"><span>이유</span><b>{r.reasonLabel}</b></div><div className="pc-kv"><span>같은 대상 신고</span><b>{r.sameTarget}건</b></div><div className="pc-kv"><span>처음 신고</span><b>{r.createdAt}</b></div>
      {r.description && <div className="pc-q" style={{ marginTop: 8 }}>“{r.description}”</div>}</div>
    {r.evidence.length > 0 && <div><h3>증빙 사진</h3><div className="pc-ev">{r.evidence.map(id => <Evidence key={id} id={id} />)}</div></div>}
    <div><h3>작성자 기록</h3><div className="pc-kv"><span>이전 인정</span><b>{r.warnings}회</b></div></div>
  </>
  if (a) left = <>
    <div><h3>{appealWord[a.kind] ?? '이의'} · {a.subject}</h3><div className="pc-kv"><span>신청한 사람</span><b>{a.name}</b></div><div className="pc-kv"><span>신청</span><b>{a.submittedAt}</b></div><div className="pc-kv"><span>이유</span><b>{a.reasonLabel}</b></div>
      {a.kind !== 'SANCTION' && <div className="pc-kv"><span>출석 기록</span><b>{a.checkInMethod ? (a.checkInMethod === 'QR' ? 'QR 출석' : '수동 확인') : '체크인 없음'}</b></div>}
      {a.sanctionType && <div className="pc-kv"><span>제재</span><b>{a.sanctionType}</b></div>}</div>
    <div><h3>신청한 사람의 말</h3><div className="pc-q">{a.reason}</div></div>
    {a.hostNote && <div><h3>모집자 답변</h3><div className="pc-q">{a.hostNote}</div></div>}
  </>
  if (v) left = <>
    <div><h3>검토 사유</h3><div className="pc-q" style={{ color: 'var(--pc-amb)' }}>{v.riskReasons || '자동 분류에서 확인이 필요하다고 나왔어요.'}</div></div>
    <div><h3>모집글</h3><div className="pc-kv"><span>모집자</span><b>{v.activityType === 'INSTITUTION' ? v.organizationName : v.organizerName}</b></div><div className="pc-kv"><span>분야</span><b>{v.category}</b></div>
      <div className="pc-kv"><span>일시</span><b>{when(v.date, v.startTime)} · {minutesWord(v.durationMinutes)}</b></div><div className="pc-kv"><span>장소</span><b>{v.placeName ?? '장소 미정'}{v.meetingPoint ? ' · ' + v.meetingPoint : ''}</b></div><div className="pc-kv"><span>인원</span><b>{v.capacity}명</b></div></div>
    <div><h3>소개</h3><div className="pc-q">{v.description}</div></div>
  </>
  if (o) left = <>
    <div><h3>기관 정보</h3><div className="pc-kv"><span>기관명</span><b>{o.name}</b></div><div className="pc-kv"><span>유형</span><b>{o.orgType ? orgTypeWord[o.orgType] ?? o.orgType : '-'}</b></div>
      <div className="pc-kv"><span>연락처</span><b>{o.contact}</b></div><div className="pc-kv"><span>주소</span><b>{o.address || '-'}</b></div><div className="pc-kv"><span>1365 수요처</span><b>{o.vmsRegistered ? '등록됨' + (o.vmsCode ? ` (${o.vmsCode})` : '') : o.vmsRegistered === false ? '아님' : '-'}</b></div></div>
    <div><h3>담당자</h3><div className="pc-kv"><span>이름</span><b>{o.managerName}</b></div><div className="pc-kv"><span>이메일</span><b>{o.managerEmail}</b></div><div className="pc-kv"><span>신청</span><b>{o.requestedAt}</b></div></div>
  </>
  const effect = r && pickNow !== 'DISMISS' && r.warnings < 3 ? `인정하면 작성자는 인정 ${r.warnings + 1}회로 ${ladder[Math.min(3, r.warnings + 1)]} 단계가 돼요.`
    : a && pickNow === 'ACCEPT' ? (a.kind === 'SANCTION' ? '인정하면 제재가 바로 풀려요.' : a.kind === 'NO_SHOW' ? '인정하면 불참이 출석으로 바뀌고 횟수에서 빠져요.' : '인정하면 활동 기록이 다시 유효해져요.')
    : v ? (pickNow === 'APPROVE' ? '승인하면 바로 공개돼요.' : '반려하면 모집자에게 사유가 전달돼요.')
    : o ? (pickNow === 'APPROVE' ? '승인하면 기관센터와 기관 주관 모집이 열려요.' : '반려하면 담당자에게 사유가 전달돼요.') : ''
  return <section className="pc-pn" aria-label="처리">
    <div className="pc-ph"><span className={'pc-tag ' + tagTone}>{tagText}</span><h2>{item.title}</h2><span className="r mu">{position}</span></div>
    <div className="pc-case">
      <div>{left}</div>
      <div>
        <h3>처리</h3>
        <div className="pc-radio" role="radiogroup" aria-label="처리 방법">{choices.map(([k, label]) =>
          <label key={k} className={pickNow === k ? 'on' : ''}><input type="radio" name="choice" checked={pickNow === k} onChange={() => setChoice(k)} className="pc-cb" />{label}</label>)}</div>
        {effect && <p className="pc-q" style={{ fontSize: 13 }}>{effect}</p>}
        <label className="pc-f"><span>사유 <small>{reasonNeeded ? '(필수 · 당사자에게 보내져요)' : '(선택)'}</small></span>
          <textarea className="pc-ta" value={reason} maxLength={500} onChange={e => { setReason(e.target.value); setError('') }} /></label>
        {error && <p className="pc-err" role="alert" style={{ margin: 0 }}>{error}</p>}
        <button type="button" className="pc-btn lg wide" disabled={busy} onClick={() => void send()}>{busy ? '처리하는 중…' : '처리하고 다음 건'}</button>
      </div>
    </div>
  </section>
}

function Evidence({ id }: { id: number }) {
  const [url, setUrl] = useState('')
  useEffect(() => { let made = ''; apiBlob('/api/admin/evidences/' + id).then(blob => { made = URL.createObjectURL(blob); setUrl(made) }).catch(() => {}); return () => { if (made) URL.revokeObjectURL(made) } }, [id])
  return url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="증빙 사진" /></a> : null
}

const actionWord: Record<string, string> = { APPROVE: '승인', REJECT: '반려', REPORT_HIDE: '신고 인정 · 숨김', REPORT_ACCEPT: '신고 인정', REPORT_DISMISS: '문제 없음', APPEAL_ACCEPT: '이의 인정', APPEAL_REJECT: '이의 기각', SET_COORDINATES: '좌표 입력' }
const actionTone = (a: string) => a.includes('REJECT') || a === 'REPORT_HIDE' || a === 'REPORT_ACCEPT' ? 'red' : a.startsWith('APPEAL') ? 'blu' : 'g'
const typeWord: Record<string, string> = { ORGANIZATION: '기관', ACTIVITY: '활동', REPORT: '신고', APPEAL: '이의', USER: '회원', PLACE: '장소' }
function actionTarget(a: Action) {
  if (a.targetType === 'REPORT' && a.targetName) { const [t, why] = a.targetName.split(':'); return `${targetWord[t] ?? t} · ${reasonWord[why] ?? why}` }
  if (a.targetType === 'APPEAL' && a.targetName) return appealWord[a.targetName] ?? '이의'
  return a.targetName ?? `${typeWord[a.targetType] ?? a.targetType} #${a.targetId}`
}

function AllDone({ handled, waitingHost }: { handled: number; waitingHost: number }) {
  const [today, setToday] = useState<Action[] | null>(null)
  useEffect(() => { api<Action[]>('/api/admin/actions?today=true&limit=100').then(setToday).catch(() => setToday([])) }, [handled])
  const by = (t: string) => (today ?? []).filter(a => a.targetType === t).length
  return <section className="pc-pn pc-done" aria-label="처리할 일 없음">
    <span className="mark"><PcIcon name="check" size={28} /></span>
    <h1>지금 처리할 일이 없어요</h1><p className="mu">새로 들어오면 여기에 바로 쌓여요{waitingHost ? ` · 모집자 답변을 기다리는 이의 ${waitingHost}건` : ''}</p>
    <div className="pc-stats" style={{ width: '100%' }}>{[['신고', 'REPORT'], ['이의', 'APPEAL'], ['활동 검토', 'ACTIVITY'], ['기관', 'ORGANIZATION']].map(([label, t]) => <div key={t} className="pc-stat"><span>오늘 {label}</span><b>{today ? by(t) : '–'}건</b></div>)}</div>
    {today && today.length > 0 && <div style={{ width: '100%', textAlign: 'left' }}><h2 style={{ marginBottom: 6 }}>오늘 처리</h2><div className="pc-pn"><table className="pc-tbl"><tbody>{today.slice(0, 5).map(a =>
      <tr key={a.id}><td className="mu nw">{a.at.slice(11)}</td><td><span className={'pc-tag ' + actionTone(a.action)}>{actionWord[a.action] ?? a.action}</span></td><td>{actionTarget(a)}</td></tr>)}</tbody></table></div></div>}
    <div style={{ display: 'flex', gap: 8 }}><a className="pc-btn line" href="#/admin/log">처리 기록</a><a className="pc-btn dark" href="#/admin/stats">현황 보기</a></div>
  </section>
}

/* ---------------- 기록 ---------------- */

function Log({ type }: { type: string }) {
  const [list, setList] = useState<Action[] | null>(null)
  useEffect(() => { setList(null); api<Action[]>('/api/admin/actions?limit=200' + (type ? '&type=' + type : '')).then(setList).catch(() => setList([])) }, [type])
  const types: [string, string][] = [['', '전체'], ['REPORT', '신고'], ['APPEAL', '이의'], ['ACTIVITY', '활동'], ['ORGANIZATION', '기관'], ['PLACE', '장소']]
  return <main className="pc-main">
    <div className="pc-head"><h1>처리 기록</h1><span className="mu">관리자가 한 결정은 모두 사유와 함께 남아요</span></div>
    <Panel title="최근 200건" right={<div className="pc-chips">{types.map(([k, label]) => <button key={k || 'all'} type="button" aria-pressed={type === k} onClick={() => { window.location.hash = '#/admin/log' + (k ? '?type=' + k : '') }}>{label}</button>)}</div>}>
      {list === null ? <Loading /> : list.length === 0 ? <p className="pc-empty">기록이 없어요.</p>
        : <table className="pc-tbl"><thead><tr><th>시각</th><th>관리자</th><th>처리</th><th>대상</th><th>사유</th></tr></thead><tbody>{list.map(a =>
          <tr key={a.id}><td className="mu nw">{a.at}</td><td className="nw">{a.admin}</td><td><span className={'pc-tag ' + actionTone(a.action)}>{actionWord[a.action] ?? a.action}</span></td><td>{actionTarget(a)}</td><td className="mu">{a.reason}</td></tr>)}</tbody></table>}
    </Panel>
  </main>
}

/* ---------------- 현황 ---------------- */

type Overview = { members: number; newMembers: number; recruiting: number; recruitingInstitution: number; weeks: { from: string; applications: number }[]; attended: number; noShows: number
  institutions: number; institutionsPending: number; speed: { kind: string; count: number; averageMinutes: number | null; longestMinutes: number | null }[]; reasons: { reason: string; total: number; accepted: number }[] }
type System = { checkedAt: string; version: string | null; startedAt: string; uptimeMinutes: number; database: { ok: boolean; millis?: number; schema?: string | null }; scheduler: { lastRun: string | null; secondsAgo: number | null }
  volunteer1365: { limit: number; used: number | null }; push: { enabled: boolean; tokens: number }; disk: { totalBytes: number; freeBytes: number; photoBytes: number }; memory: { usedBytes: number; maxBytes: number } }
const span = (m: number | null) => m == null ? '–' : m < 60 ? `${m}분` : m < 1440 ? `${Math.round(m / 6) / 10}시간` : `${Math.round(m / 144) / 10}일`
const gb = (b: number) => b >= 1e9 ? (b / 1e9).toFixed(1) + 'GB' : Math.round(b / 1e6) + 'MB'

function Stats() {
  const [o, setO] = useState<Overview | null>(null)
  const [s, setS] = useState<System | null>(null)
  const load = useCallback(() => { api<Overview>('/api/admin/overview').then(setO).catch(() => {}); api<System>('/api/admin/system').then(setS).catch(() => {}) }, [])
  useEffect(() => { load(); const t = window.setInterval(() => api<System>('/api/admin/system').then(setS).catch(() => {}), 30_000); return () => window.clearInterval(t) }, [load])
  if (!o) return <main className="pc-main"><Loading /></main>
  const thisWeek = o.weeks[o.weeks.length - 1]?.applications ?? 0, lastWeek = o.weeks[o.weeks.length - 2]?.applications ?? 0
  const rate = o.attended + o.noShows ? Math.round(o.attended / (o.attended + o.noShows) * 100) : null
  const max = Math.max(1, ...o.weeks.map(w => w.applications))
  const rows: [string, 'g' | 'amb' | 'red' | '', string, string][] = s ? [
    ['API 서버', 'g', '정상', `켜진 지 ${span(s.uptimeMinutes)} · ${s.startedAt.replace('T', ' ')} 시작`],
    ['데이터베이스', s.database.ok ? 'g' : 'red', s.database.ok ? '정상' : '응답 없음', s.database.ok ? `응답 ${s.database.millis}ms · 스키마 V${s.database.schema ?? '?'}` : ''],
    ['1분 작업', s.scheduler.secondsAgo == null ? '' : s.scheduler.secondsAgo > 180 ? 'red' : 'g', s.scheduler.secondsAgo == null ? '꺼짐' : s.scheduler.secondsAgo > 180 ? '멈춤' : '정상', s.scheduler.secondsAgo == null ? '이 서버에서는 실행하지 않아요' : `${s.scheduler.secondsAgo}초 전 실행`],
    ['1365 연동', s.volunteer1365.used == null ? '' : s.volunteer1365.used >= s.volunteer1365.limit * 0.8 ? 'amb' : 'g', s.volunteer1365.used == null ? '꺼짐' : s.volunteer1365.used >= s.volunteer1365.limit * 0.8 ? '주의' : '정상', s.volunteer1365.used == null ? '' : `오늘 ${s.volunteer1365.used} / ${s.volunteer1365.limit}회`],
    ['휴대폰 알림', s.push.enabled ? 'g' : '', s.push.enabled ? '정상' : '꺼짐', `알림 받는 기기 ${s.push.tokens}대`],
    ['디스크', s.disk.freeBytes / Math.max(1, s.disk.totalBytes) < 0.2 ? 'amb' : 'g', s.disk.freeBytes / Math.max(1, s.disk.totalBytes) < 0.2 ? '주의' : '정상', `남은 공간 ${gb(s.disk.freeBytes)} / ${gb(s.disk.totalBytes)} · 사진 ${gb(s.disk.photoBytes)}`],
    ['메모리', s.memory.usedBytes / s.memory.maxBytes > 0.85 ? 'amb' : 'g', s.memory.usedBytes / s.memory.maxBytes > 0.85 ? '주의' : '정상', `${gb(s.memory.usedBytes)} / ${gb(s.memory.maxBytes)}`],
  ] : []
  return <main className="pc-main">
    <div className="pc-head"><h1>현황</h1><div className="r">{s && <span className="mu">{s.version ? `배포 ${s.version} · ` : ''}{s.checkedAt.slice(11, 16)} 기준</span>}<button className="pc-btn sm line" onClick={load}><PcIcon name="refresh" />새로고침</button></div></div>
    <div className="pc-stats">
      <div className="pc-stat"><span>회원</span><b>{o.members.toLocaleString()}명</b><small className="up">이번 주 +{o.newMembers}</small></div>
      <div className="pc-stat"><span>모집 중</span><b>{o.recruiting}개</b><small>기관 {o.recruitingInstitution} · 개인 {o.recruiting - o.recruitingInstitution}</small></div>
      <div className="pc-stat"><span>이번 주 신청</span><b>{thisWeek}건</b><small className={thisWeek >= lastWeek ? 'up' : ''}>지난주 {lastWeek}건</small></div>
      <div className="pc-stat"><span>출석률 (최근 30일)</span><b>{rate == null ? '–' : rate + '%'}</b><small>출석 {o.attended} · 불참 {o.noShows}</small></div>
      <div className="pc-stat"><span>승인된 기관</span><b>{o.institutions}곳</b><small>확인 대기 {o.institutionsPending}</small></div>
    </div>
    <div className="pc-grid2">
      <Panel title="주별 신청" note="최근 12주">
        <div style={{ padding: '10px 16px 14px' }}><div className="pc-bars" role="img" aria-label={`최근 12주 신청 수, 이번 주 ${thisWeek}건`}>{o.weeks.map(w => <div key={w.from}><span>{w.applications}</span><i style={{ height: Math.max(2, w.applications / max * 110) }} /><span>{w.from.slice(5).replace('-', '/')}</span></div>)}</div></div>
      </Panel>
      <Panel title="서버 상태" note="30초마다 확인">
        {!s ? <Loading /> : <table className="pc-tbl"><tbody>{rows.map(([name, tone, state, detail]) => <tr key={name}><td className="nw">{name}</td><td><span className={'pc-tag ' + tone}>{state}</span></td><td className="mu">{detail}</td></tr>)}</tbody></table>}
      </Panel>
    </div>
    <div className="pc-grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Panel title="처리 속도" note="최근 30일 · 접수부터 결정까지">
        <table className="pc-tbl"><thead><tr><th>종류</th><th className="r">건수</th><th className="r">평균</th><th className="r">가장 오래</th></tr></thead><tbody>{o.speed.map(x => <tr key={x.kind}><td>{x.kind}</td><td className="r">{x.count}</td><td className="r">{span(x.averageMinutes)}</td><td className="r mu">{span(x.longestMinutes)}</td></tr>)}</tbody></table>
      </Panel>
      <Panel title="신고 이유" note="최근 30일">
        {o.reasons.length === 0 ? <p className="pc-empty">최근 30일 동안 들어온 신고가 없어요.</p> : <table className="pc-tbl"><thead><tr><th>이유</th><th className="r">건수</th><th className="r">인정</th></tr></thead><tbody>{o.reasons.map(x => <tr key={x.reason}><td>{reasonWord[x.reason] ?? x.reason}</td><td className="r">{x.total}</td><td className="r">{x.accepted}</td></tr>)}</tbody></table>}
      </Panel>
    </div>
  </main>
}

/* ---------------- 찾기 ---------------- */

type MemberRow = { id: number; name: string; nickname: string | null; email: string; memberType: string; role: string; status: string; joinedAt: string }
type MemberDetail = MemberRow & { organizationName: string | null; organizationStatus: string | null; completed: number; noShows90: number; hosted: number; reportsAccepted: number
  sanctions: { id: number; type: string; scope: string; source: string; reason: string; startsAt: string; endsAt: string | null; revoked: boolean | number; active: boolean | number }[]
  participations: { id: number; title: string; date: string; status: string }[]; reports: { id: number; targetType: string; reason: string; status: string; at: string }[] }
const statusWord: Record<string, string> = { ACTIVE: '정상', RESTRICTED: '제한', SUSPENDED: '정지' }
const partWord: Record<string, string> = { APPLIED: '승인 대기', CONFIRMED: '확정', WAITLISTED: '대기', OFFERED: '자리 제안', CHECKED_IN: '출석', COMPLETED: '완료', NO_SHOW: '불참', CANCELLED: '취소', REJECTED: '거절', EXPIRED: '만료' }
const scopeWord: Record<string, string> = { APPLY: '신청 제한', WRITE: '글쓰기 제한', ALL: '이용 제한', NONE: '경고' }
const sourceWord: Record<string, string> = { NOSHOW: '불참 누적', REPORT: '신고 인정', ADMIN: '관리자' }

function Find({ q }: { q: string }) {
  const [list, setList] = useState<MemberRow[] | null>(null)
  useEffect(() => { if (q.trim().length >= 2) { setList(null); api<MemberRow[]>('/api/admin/members?q=' + encodeURIComponent(q)).then(setList).catch(() => setList([])) } else setList([]) }, [q])
  return <main className="pc-main">
    <div className="pc-head"><h1>회원 찾기</h1><span className="mu">위쪽 검색 칸에 이메일, 이름 또는 닉네임을 두 글자 이상 넣어 주세요</span></div>
    <Panel title={q ? `“${q}” 검색 결과` : '검색 결과'}>
      {list === null ? <Loading /> : list.length === 0 ? <p className="pc-empty">{q.trim().length >= 2 ? '맞는 회원이 없어요.' : '검색어를 입력해 주세요.'}</p>
        : <table className="pc-tbl"><thead><tr><th>이름</th><th>닉네임</th><th>이메일</th><th>유형</th><th>상태</th><th>가입</th></tr></thead><tbody>{list.map(m =>
          <tr key={m.id} className="go" onClick={() => { window.location.hash = '#/admin/find/' + m.id }}><td><a className="t" href={'#/admin/find/' + m.id}>{m.name}</a></td><td>{m.nickname ?? '-'}</td><td className="mu">{m.email}</td>
            <td>{m.role === 'ADMIN' ? '관리자' : m.memberType === 'INSTITUTION' ? '기관' : '개인'}</td><td><span className={'pc-tag ' + (m.status === 'ACTIVE' ? 'g' : 'red')}>{statusWord[m.status] ?? m.status}</span></td><td className="mu nw">{m.joinedAt}</td></tr>)}</tbody></table>}
    </Panel>
  </main>
}

function Member({ id }: { id: number }) {
  const [m, setM] = useState<MemberDetail | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => { api<MemberDetail>('/api/admin/members/' + id).then(setM).catch(() => setMissing(true)) }, [id])
  if (missing) return <main className="pc-main"><p className="pc-err">회원을 찾을 수 없어요.</p></main>
  if (!m) return <main className="pc-main"><Loading /></main>
  return <main className="pc-main">
    <div className="pc-head"><button type="button" className="pc-link" style={{ color: 'var(--pc-mu)' }} onClick={() => window.history.back()}>‹ 찾기</button><h1>{m.name}</h1><span className="mu">{m.nickname ? m.nickname + ' · ' : ''}{m.email}</span><span className={'pc-tag ' + (m.status === 'ACTIVE' ? 'g' : 'red')}>{statusWord[m.status] ?? m.status}</span></div>
    <div className="pc-stats">
      <div className="pc-stat"><span>참여 완료</span><b>{m.completed}회</b></div><div className="pc-stat"><span>최근 90일 불참</span><b>{m.noShows90}회</b></div>
      <div className="pc-stat"><span>모집한 활동</span><b>{m.hosted}개</b></div><div className="pc-stat"><span>인정된 신고</span><b>{m.reportsAccepted}건</b></div>
      <div className="pc-stat"><span>가입</span><b style={{ fontSize: 17 }}>{m.joinedAt}</b><small>{m.memberType === 'INSTITUTION' ? `기관 · ${m.organizationName ?? ''}` : '개인 회원'}</small></div>
    </div>
    <div className="pc-grid2">
      <Panel title="이용 제한·경고">{m.sanctions.length === 0 ? <p className="pc-empty">기록이 없어요.</p> : <table className="pc-tbl"><thead><tr><th>내용</th><th>원인</th><th>기간</th><th>상태</th></tr></thead><tbody>{m.sanctions.map(s =>
        <tr key={s.id}><td>{scopeWord[s.scope] ?? s.type}<small>{s.reason}</small></td><td className="nw">{sourceWord[s.source] ?? s.source}</td><td className="nw mu">{s.startsAt}{s.endsAt ? ` ~ ${s.endsAt}` : ''}</td>
          <td>{s.revoked ? <span className="pc-tag">풀림</span> : s.active ? <span className="pc-tag red">진행 중</span> : <span className="pc-tag">끝남</span>}</td></tr>)}</tbody></table>}</Panel>
      <Panel title="받은 신고">{m.reports.length === 0 ? <p className="pc-empty">받은 신고가 없어요.</p> : <table className="pc-tbl"><tbody>{m.reports.map(r =>
        <tr key={r.id}><td className="mu nw">{r.at}</td><td>{targetWord[r.targetType] ?? r.targetType} · {reasonWord[r.reason] ?? r.reason}</td><td><span className={'pc-tag ' + (r.status === 'ACTION_TAKEN' ? 'red' : r.status === 'DISMISSED' ? '' : 'amb')}>{r.status === 'ACTION_TAKEN' ? '인정' : r.status === 'DISMISSED' ? '문제 없음' : '처리 전'}</span></td></tr>)}</tbody></table>}</Panel>
    </div>
    <Panel title="최근 신청">{m.participations.length === 0 ? <p className="pc-empty">신청한 활동이 없어요.</p> : <table className="pc-tbl"><thead><tr><th>날짜</th><th>활동</th><th>상태</th></tr></thead><tbody>{m.participations.map(p =>
      <tr key={p.id}><td className="mu nw">{p.date}</td><td>{p.title}</td><td><span className={'pc-tag ' + (p.status === 'NO_SHOW' ? 'red' : ['CHECKED_IN', 'COMPLETED', 'CONFIRMED'].includes(p.status) ? 'g' : '')}>{partWord[p.status] ?? p.status}</span></td></tr>)}</tbody></table>}</Panel>
  </main>
}

/* ---------------- 장소 ---------------- */

function Places() {
  const [places, setPlaces] = useState<PlaceInfo[] | null>(null)
  const [ok, setOk] = useState('')
  const load = useCallback(() => { api<PlaceInfo[]>('/api/places').then(setPlaces).catch(() => setPlaces([])) }, [])
  useEffect(load, [load])
  const missing = (places ?? []).filter(p => p.latitude == null).length
  return <main className="pc-main">
    <div className="pc-head"><h1>장소</h1><span className="mu">좌표가 있어야 거리 검색과 지도에 나와요</span>{missing > 0 && <span className="pc-tag amb">좌표 없음 {missing}</span>}</div>
    {ok && <p className="pc-ok" role="status">{ok}</p>}
    <div className="pc-legacy">{places === null ? <Loading /> : <ul className="place-list">{places.map(place => <PlaceEditor key={place.id + ':' + place.latitude + ':' + place.longitude} place={place} onSaved={text => { setOk(text); load() }} />)}</ul>}</div>
  </main>
}
