// 기관센터 (PC, 2026-11-11): 할 일 · 모집 관리 · 신청자 · 완료·기록 · 기관 정보. 현장 출석(QR)은 같은 계정으로 앱에서.
// Writing and editing a post and one post's full page reuse the web screens (CreateActivity, LiveDetail) inside this frame.
import { MyDocs } from './docs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { OrgCreate, OrgManage } from './orgPost'
import { api, ApiError } from '../api'
import type { Applicant, LiveActivity, User } from '../api'
import { appUrl, AppQr, Loading, Logo, Panel, PcIcon, when } from './ui'

const isFinished = (a: LiveActivity) => a.status === 'FINISHED'
const startOf = (a: LiveActivity) => new Date(`${a.date}T${a.startTime}:00+09:00`).getTime()
const statusTag = (a: LiveActivity) => {
  const map: Record<string, [string, string]> = { RECRUITING: ['모집 중', 'g'], DRAFT: ['검토 중', 'amb'], IN_PROGRESS: ['진행 중', 'blu'], FINISHED: ['끝남', ''], CANCELLED: ['취소', 'red'] }
  const [text, tone] = map[a.status] ?? [a.status, '']
  return <span className={'pc-tag ' + tone}>{text}</span>
}
const failText = (cause: unknown) => cause instanceof ApiError ? (Object.values(cause.fieldErrors)[0] ?? cause.message) : '처리하지 못했어요.'

export function OrgCenter({ parts, query, user, onSignOut, onChange }: { parts: string[]; query: URLSearchParams; user: User; onSignOut: () => void; onChange: () => void }) {
  const [mine, setMine] = useState<LiveActivity[] | null>(null)
  const load = useCallback(() => { api<LiveActivity[]>('/api/me/activities').then(setMine).catch(() => setMine([])) }, [])
  useEffect(() => { load() }, [load, parts.join('/')])
  const section = parts[1] ?? ''
  const todo = useMemo(() => todos(mine ?? []), [mine])
  const nav: [string, string, number?][] = [['', '할 일', todo.length], ['activities', '모집 관리'], ['applicants', '신청자'], ['records', '완료·기록'], ['profile', '기관 정보']]
  const current = section === 'activity' || section === 'create' ? 'activities' : section
  let page: ReactNode
  if (section === '') page = <Todo items={todo} mine={mine} />
  else if (section === 'activities') page = <Activities mine={mine} />
  else if (section === 'applicants') page = <Applicants mine={mine} id={Number(query.get('activity')) || undefined} onChanged={load} />
  else if (section === 'records') page = <Records mine={mine} onChanged={load} />
  else if (section === 'profile') page = <Profile user={user} />
  else if (section === 'create') page = <OrgCreate key={'c' + (query.get('from') ?? '')} user={user} fromId={Number(query.get('from')) || undefined} />
  else if (section === 'activity' && parts[2] && parts[3] === 'edit') page = <OrgCreate key={'e' + parts[2]} user={user} editId={Number(parts[2])} />
  else if (section === 'activity' && parts[2]) page = <OrgManage key={parts[2]} id={Number(parts[2])} onChanged={() => { onChange(); load() }} />
  else page = <p className="pc-empty">없는 화면이에요. <a className="pc-link" href="#/org">할 일로</a></p>
  return <div className="pc">
    <header className="pc-hd"><Logo sub="기관센터" href="#/org" /><div className="pc-sp" /><a className="pc-btn" href="#/org/create"><PcIcon name="plus" />모집 만들기</a>
      <div className="pc-who"><span>{user.organization?.name ?? user.name}</span><button type="button" onClick={onSignOut}>로그아웃</button></div></header>
    <div className="pc-body">
      <nav className="pc-side" aria-label="기관센터 메뉴">{nav.map(([key, label, n]) => <a key={key} href={'#/org' + (key ? '/' + key : '')} aria-current={current === key ? 'page' : undefined}>{label}{n ? <b>{n}</b> : null}</a>)}
        <div className="foot">현장 출석(QR)은 같은 계정으로<br />Volink 앱에서 열어요</div></nav>
      <main className="pc-main">{page}</main>
    </div>
  </div>
}

type Todo = { key: string; tone: string; kind: string; activity: LiveActivity; text: string; due: string; href: string; button: string; primary: boolean }

function todos(mine: LiveActivity[]): Todo[] {
  const out: Todo[] = []
  for (const a of mine) {
    if (isFinished(a) && (a.checkedIn ?? 0) > 0) out.push({ key: 'f' + a.id, tone: 'red', kind: '완료', activity: a, text: `출석한 ${a.checkedIn}명 완료 처리`, due: `${when(a.date)} 끝남`, href: '#/org/records', button: '완료하기', primary: true })
    if (a.status === 'RECRUITING' && (a.pending ?? 0) > 0) out.push({ key: 'p' + a.id, tone: 'red', kind: '승인', activity: a, text: `신청 ${a.pending}명이 승인을 기다려요`, due: `${when(a.date, a.startTime)} 활동`, href: '#/org/applicants?activity=' + a.id, button: '승인하기', primary: true })
    if ((a.unanswered ?? 0) > 0) out.push({ key: 'u' + a.id, tone: 'amb', kind: '답변', activity: a, text: `답하지 않은 질문 ${a.unanswered}개`, due: '활동 소식', href: '#/org/activity/' + a.id, button: '답하기', primary: false })
    if (a.status === 'DRAFT') out.push({ key: 'd' + a.id, tone: '', kind: '검토', activity: a, text: a.reviewNote ? '운영자가 반려했어요 · 수정해서 다시 올려 주세요' : '운영자 검토 뒤 공개돼요', due: '-', href: '#/org/activity/' + a.id, button: '보기', primary: false })
    if (a.status === 'RECRUITING' && a.confirmed === 0 && (a.pending ?? 0) === 0 && startOf(a) - Date.now() < 4 * 86_400_000 && startOf(a) > Date.now())
      out.push({ key: 'z' + a.id, tone: '', kind: '홍보', activity: a, text: '아직 신청이 없어요 · 모집 인원이나 소개를 다시 확인해 보세요', due: `${when(a.date, a.startTime)} 활동`, href: '#/org/activity/' + a.id, button: '모집글 보기', primary: false })
  }
  const order: Record<string, number> = { red: 0, amb: 1, '': 2 }
  return out.sort((x, y) => order[x.tone] - order[y.tone] || startOf(x.activity) - startOf(y.activity))
}

function Todo({ items, mine }: { items: Todo[]; mine: LiveActivity[] | null }) {
  if (!mine) return <Loading />
  const upcoming = mine.filter(a => ['RECRUITING', 'IN_PROGRESS'].includes(a.status) && startOf(a) + a.durationMinutes * 60_000 > Date.now()).sort((a, b) => startOf(a) - startOf(b)).slice(0, 6)
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7)
  const thisMonth = mine.filter(a => a.date.startsWith(month) && a.status !== 'CANCELLED')
  const finished = thisMonth.filter(isFinished)
  return <>
    <div className="pc-head"><h1>할 일 {items.length}건</h1><span className="mu">{items.length ? '급한 것부터 보여요' : ''}</span></div>
    <Panel>{items.length === 0 ? <p className="pc-empty">지금 처리할 일이 없어요. 새 신청이나 질문이 오면 여기에 보여요.</p>
      : <table className="pc-tbl"><thead><tr><th>종류</th><th>활동</th><th>내용</th><th>기한</th><th /></tr></thead><tbody>{items.map(t =>
        <tr key={t.key}><td><span className={'pc-tag ' + t.tone}>{t.kind}</span></td><td className="t">{t.activity.title}</td><td>{t.text}</td><td className="mu nw">{t.due}</td>
          <td className="r"><a className={'pc-btn sm' + (t.primary ? '' : ' line')} href={t.href}>{t.button}</a></td></tr>)}</tbody></table>}</Panel>
    <div className="pc-grid2">
      <Panel title="다가오는 활동" right={<a className="pc-link" href="#/org/activities">모집 관리 ›</a>}>{upcoming.length === 0 ? <p className="pc-empty">예정된 활동이 없어요. <a className="pc-link" href="#/org/create">모집 만들기</a></p>
        : <table className="pc-tbl"><thead><tr><th>활동</th><th>일시</th><th>확정</th><th>승인 대기</th></tr></thead><tbody>{upcoming.map(a =>
          <tr key={a.id} className="go" onClick={() => { window.location.hash = '#/org/activity/' + a.id }}><td className="t">{a.title}</td><td className="nw">{when(a.date, a.startTime)}</td><td className="nw">{a.confirmed}/{a.capacity}명</td><td>{a.pending ? <span className="pc-tag red">{a.pending}명</span> : <span className="mu">-</span>}</td></tr>)}</tbody></table>}</Panel>
      <Panel title="이번 달">
        <div className="pc-stats" style={{ padding: 14 }}>
          <div className="pc-stat"><span>모집</span><b>{thisMonth.length}개</b></div>
          <div className="pc-stat"><span>확정된 참여자</span><b>{thisMonth.reduce((s, a) => s + a.confirmed, 0)}명</b></div>
          <div className="pc-stat"><span>끝난 활동</span><b>{finished.length}개</b></div>
        </div></Panel>
    </div>
  </>
}

function Activities({ mine }: { mine: LiveActivity[] | null }) {
  const [tab, setTab] = useState<'open' | 'done' | 'all'>('open')
  if (!mine) return <Loading />
  const list = mine.filter(a => a.status !== 'DELETED' && (tab === 'all' || (tab === 'open' ? !isFinished(a) && a.status !== 'CANCELLED' : isFinished(a) || a.status === 'CANCELLED')))
    .sort((a, b) => tab === 'open' ? startOf(a) - startOf(b) : startOf(b) - startOf(a))
  return <>
    <div className="pc-head"><h1>모집 관리</h1><div className="r"><a className="pc-btn" href="#/org/create"><PcIcon name="plus" />모집 만들기</a></div></div>
    <section className="pc-pn">
      <div className="pc-tabs" role="tablist">{([['open', '진행 중'], ['done', '끝남·취소'], ['all', '전체']] as const).map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}</div>
      {list.length === 0 ? <p className="pc-empty">{tab === 'open' ? '진행 중인 모집이 없어요.' : '해당하는 모집이 없어요.'}</p>
        : <table className="pc-tbl"><thead><tr><th>상태</th><th>활동</th><th>일시</th><th>확정</th><th>승인 대기</th><th>대기</th><th /></tr></thead><tbody>{list.map(a =>
          <tr key={a.id}><td>{statusTag(a)}</td><td><a className="t" href={'#/org/activity/' + a.id}>{a.title}</a><small>{a.category} · {a.placeName ?? '장소 미정'}</small></td><td className="nw">{when(a.date, a.startTime)}</td>
            <td className="nw">{a.confirmed}/{a.capacity}명</td><td>{a.pending ? <span className="pc-tag red">{a.pending}</span> : '-'}</td><td>{a.waiting || '-'}</td>
            <td className="r nw"><a className="pc-btn sm line" href={'#/org/applicants?activity=' + a.id}>신청자</a> <a className="pc-btn sm line" href={'#/org/activity/' + a.id}>관리</a></td></tr>)}</tbody></table>}
    </section>
  </>
}

const applicantWord: Record<string, [string, string]> = { APPLIED: ['승인 대기', 'amb'], CONFIRMED: ['확정', 'g'], WAITLISTED: ['대기', ''], OFFERED: ['자리 제안 중', 'blu'], CHECKED_IN: ['출석', 'g'], COMPLETED: ['완료', 'g'], NO_SHOW: ['불참', 'red'], CANCELLED: ['취소', ''], REJECTED: ['거절', ''], EXPIRED: ['만료', ''] }

function Applicants({ mine, id, onChanged }: { mine: LiveActivity[] | null; id?: number; onChanged: () => void }) {
  const choices = (mine ?? []).filter(a => a.status !== 'CANCELLED' && a.status !== 'DELETED').sort((a, b) => startOf(b) - startOf(a))
  const pick = id ?? choices.find(a => (a.pending ?? 0) > 0)?.id ?? choices.find(a => !isFinished(a))?.id ?? choices[0]?.id
  const activity = choices.find(a => a.id === pick)
  const [data, setData] = useState<{ capacity: number; confirmed: number; items: Applicant[] } | null>(null)
  const [tab, setTab] = useState('APPLIED')
  const [checked, setChecked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok?: string; error?: string }>({})
  const load = useCallback(() => { if (pick) api<{ capacity: number; confirmed: number; items: Applicant[] }>('/api/activities/' + pick + '/participations').then(setData).catch(() => setData(null)) }, [pick])
  useEffect(() => { setData(null); setChecked([]); setNote({}); load() }, [load])
  if (!mine) return <Loading />
  if (!activity) return <><div className="pc-head"><h1>신청자</h1></div><Panel><p className="pc-empty">모집한 활동이 없어요. <a className="pc-link" href="#/org/create">모집 만들기</a></p></Panel></>
  const groups: [string, string, string[]][] = [['APPLIED', '승인 대기', ['APPLIED']], ['CONFIRMED', '확정', ['CONFIRMED', 'CHECKED_IN', 'COMPLETED']], ['WAITLISTED', '대기', ['WAITLISTED', 'OFFERED']], ['OTHER', '취소·거절', ['CANCELLED', 'REJECTED', 'EXPIRED', 'NO_SHOW']]]
  const group = groups.find(g => g[0] === tab) ?? groups[0]
  const rows = (data?.items ?? []).filter(i => group[2].includes(i.status))
  const selectable = tab === 'APPLIED' && !isFinished(activity)
  async function decide(approve: boolean) {
    setBusy(true); setNote({})
    let ok = 0; const failed: string[] = []
    for (const pid of checked) {
      try { await api('/api/participations/' + pid + '/' + (approve ? 'approve' : 'reject'), 'POST', {}); ok++ }
      catch (cause) { failed.push(failText(cause)) }
    }
    setBusy(false); setChecked([])
    setNote({ ok: ok ? `${ok}명을 ${approve ? '확정했어요. 각자에게 알림이 가요' : '거절했어요'}.` : undefined, error: failed.length ? `${failed.length}명은 처리하지 못했어요: ${failed[0]}` : undefined })
    load(); onChanged()
  }
  const room = data ? Math.max(0, data.capacity - data.confirmed) : 0
  return <>
    <div className="pc-head"><h1>신청자</h1>
      <label className="pc-f" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 12 }}><span className="sr">활동</span>
        <select className="pc-in" style={{ height: 36, width: 340 }} value={pick} onChange={e => { window.location.hash = '#/org/applicants?activity=' + e.target.value }}>
          {choices.map(a => <option key={a.id} value={a.id}>{when(a.date, a.startTime)} · {a.title}{a.pending ? ` (승인 대기 ${a.pending})` : ''}</option>)}</select></label>
      <div className="r"><a className="pc-btn sm line" href={'#/org/activity/' + activity.id}>활동 관리</a></div></div>
    <div className="pc-pn" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 16 }}>
      {statusTag(activity)}<b>{activity.title}</b><span className="mu">{when(activity.date, activity.startTime)} · {activity.placeName ?? ''}</span>
      <div className="pc-sp" /><span className="mu">확정</span><b>{data ? `${data.confirmed} / ${data.capacity}명` : '–'}</b>
      <div className="pc-prog" style={{ width: 160 }}><i style={{ width: data ? Math.min(100, data.confirmed / Math.max(1, data.capacity) * 100) + '%' : 0 }} /></div></div>
    {note.ok && <p className="pc-ok" role="status">{note.ok}</p>}{note.error && <p className="pc-err" role="alert">{note.error}</p>}
    <section className="pc-pn">
      <div className="pc-tabs" role="tablist">{groups.map(([k, label, states]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setChecked([]) }}>{label} {(data?.items ?? []).filter(i => states.includes(i.status)).length}</button>)}</div>
      {!data ? <Loading /> : rows.length === 0 ? <p className="pc-empty">{tab === 'APPLIED' ? '승인을 기다리는 신청이 없어요.' : '해당하는 사람이 없어요.'}</p>
        : <table className="pc-tbl"><thead><tr>{selectable && <th><input type="checkbox" className="pc-cb" aria-label="모두 고르기" checked={checked.length === rows.length} onChange={e => setChecked(e.target.checked ? rows.map(r => r.id) : [])} /></th>}<th>이름</th><th>신청</th>{activity.applyQuestion && <th>답</th>}<th>상태</th><th>출석</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id} className={checked.includes(r.id) ? 'on' : ''}>
            {selectable && <td style={{ width: 40 }}><input type="checkbox" className="pc-cb" aria-label={r.name + ' 고르기'} checked={checked.includes(r.id)} onChange={e => setChecked(old => e.target.checked ? [...old, r.id] : old.filter(x => x !== r.id))} /></td>}
            <td className="t">{r.name}</td><td className="mu nw">{r.appliedAt}</td>{activity.applyQuestion && <td>{r.answer ?? '-'}</td>}
            <td><span className={'pc-tag ' + (applicantWord[r.status]?.[1] ?? '')}>{applicantWord[r.status]?.[0] ?? r.status}{r.status === 'WAITLISTED' && r.waitOrder ? ` ${r.waitOrder}번` : ''}</span></td>
            <td className="mu">{r.checkInMethod ? (r.checkInMethod === 'MANUAL' ? '수동 확인' : r.checkInMethod === 'CODE' ? '숫자 코드' : 'QR') + (r.checkedInAt ? ' ' + r.checkedInAt : '') : '-'}</td></tr>)}</tbody></table>}
      {selectable && checked.length > 0 && <div className="pc-bulk"><b>{checked.length}명 선택</b><span className="mu">{checked.length > room ? `남은 자리는 ${room}명이에요. 넘는 신청은 확정되지 않아요` : `승인하면 확정 ${(data?.confirmed ?? 0) + checked.length} / ${data?.capacity}명`}</span>
        <div className="pc-sp" /><button className="pc-btn line" disabled={busy} onClick={() => void decide(false)}>거절</button><button className="pc-btn" disabled={busy} onClick={() => void decide(true)}>{busy ? '처리하는 중…' : `${checked.length}명 승인`}</button></div>}
    </section>
    <p className="pc-note">이름은 일부만 보이고 연락처는 공개하지 않아요. 확정자가 취소하면 대기 1번에게 자동으로 자리를 제안해요.</p>
  </>
}

type HostAppeal = { id: number; kind: string; reasonLabel: string; reason: string; status: string; hostNote: string | null; hostDueAt: string | null; name: string }

function Records({ mine, onChanged }: { mine: LiveActivity[] | null; onChanged: () => void }) {
  const [busy, setBusy] = useState<number | null>(null)
  const [note, setNote] = useState<{ ok?: string; error?: string }>({})
  const [appeals, setAppeals] = useState<(HostAppeal & { activity: LiveActivity })[] | null>(null)
  const finished = useMemo(() => (mine ?? []).filter(isFinished).sort((a, b) => startOf(b) - startOf(a)), [mine])
  const loadAppeals = useCallback(() => {
    const recent = finished.filter(a => Date.now() - startOf(a) < 21 * 86_400_000)
    Promise.all(recent.map(a => api<HostAppeal[]>('/api/activities/' + a.id + '/appeals').then(list => list.map(x => ({ ...x, activity: a }))).catch(() => [])))
      .then(lists => setAppeals(lists.flat().filter(x => x.status === 'SUBMITTED')))
  }, [finished])
  useEffect(() => { if (mine) loadAppeals() }, [mine, loadAppeals])
  if (!mine) return <Loading />
  async function complete(a: LiveActivity) {
    setBusy(a.id); setNote({})
    try { await api('/api/activities/' + a.id + '/complete', 'POST', {}); setNote({ ok: `${a.title} · 출석한 ${a.checkedIn}명을 완료 처리했어요. 활동 기록이 만들어졌어요.` }); onChanged() }
    catch (cause) { setNote({ error: failText(cause) }) } finally { setBusy(null) }
  }
  return <>
    <div className="pc-head"><h1>완료·기록</h1><span className="mu">활동이 끝나면 출석한 사람을 완료 처리해 주세요. 완료해야 참여자의 활동 기록이 만들어져요</span></div>
    {note.ok && <p className="pc-ok" role="status">{note.ok}</p>}{note.error && <p className="pc-err" role="alert">{note.error}</p>}
    {appeals && appeals.length > 0 && <Panel title={`답할 이의 ${appeals.length}건`} note="3일 안에 답하지 않으면 운영자가 판단해요">
      <table className="pc-tbl"><tbody>{appeals.map(x => <AppealRow key={x.id} appeal={x} onDone={() => { loadAppeals(); onChanged() }} />)}</tbody></table></Panel>}
    <Panel title="끝난 활동">{finished.length === 0 ? <p className="pc-empty">아직 끝난 활동이 없어요.</p>
      : <table className="pc-tbl"><thead><tr><th>날짜</th><th>활동</th><th>확정</th><th>출석 · 완료 대기</th><th /></tr></thead><tbody>{finished.map(a =>
        <tr key={a.id}><td className="nw mu">{when(a.date, a.startTime)}</td><td><a className="t" href={'#/org/activity/' + a.id}>{a.title}</a></td><td className="nw">{a.confirmed}명</td>
          <td>{(a.checkedIn ?? 0) > 0 ? <span className="pc-tag red">{a.checkedIn}명</span> : <span className="mu">없음</span>}</td>
          <td className="r">{(a.checkedIn ?? 0) > 0 ? <button className="pc-btn sm" disabled={busy != null} onClick={() => void complete(a)}>{busy === a.id ? '처리하는 중…' : `${a.checkedIn}명 완료 처리`}</button> : <a className="pc-btn sm line" href={'#/org/activity/' + a.id}>보기</a>}</td></tr>)}</tbody></table>}</Panel>
  </>
}

const kindWord: Record<string, string> = { NO_SHOW: '불참 이의', RECORD: '기록 이의' }
function AppealRow({ appeal, onDone }: { appeal: HostAppeal & { activity: LiveActivity }; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [keep, setKeep] = useState('')
  const [error, setError] = useState('')
  async function answer(decision: 'ACCEPT' | 'KEEP') {
    try { await api('/api/appeals/' + appeal.id + '/answer', 'POST', { decision, note: decision === 'KEEP' ? keep : '' }); onDone() } catch (cause) { setError(failText(cause)) }
  }
  return <tr><td style={{ width: '60%' }}><span className="pc-tag blu">{kindWord[appeal.kind] ?? '이의'}</span> <b>{appeal.activity.title}</b> · {appeal.name}<small>{appeal.reasonLabel} · “{appeal.reason}”{appeal.hostDueAt ? ` · ${appeal.hostDueAt.replace('T', ' ')}까지` : ''}</small>
    {open && <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><input className="pc-in" style={{ height: 34 }} value={keep} maxLength={500} placeholder="그대로 두는 이유 (참여자와 운영자에게 보여요)" onChange={e => { setKeep(e.target.value); setError('') }} />
      <button className="pc-btn sm dark" onClick={() => void answer('KEEP')}>보내기</button></div>}
    {error && <p className="pc-err" style={{ margin: '6px 0 0' }}>{error}</p>}</td>
    <td className="r nw"><button className="pc-btn sm" onClick={() => void answer('ACCEPT')}>출석으로 바꾸기</button> <button className="pc-btn sm line" onClick={() => setOpen(v => !v)}>그대로 두기</button></td></tr>
}

/** 기관 공개 페이지 (#/o/{id}): the introduction shown there, and the link to share. */
function PublicPagePanel({ id }: { id?: number }) {
  const [intro, setIntro] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok?: string; error?: string }>({})
  useEffect(() => { if (id) api<{ intro: string | null }>('/api/organizations/' + id).then(p => setIntro(old => old ?? p.intro ?? '')).catch(() => setIntro(old => old ?? '')) }, [id])
  if (!id) return null
  const url = window.location.origin + '/#/o/' + id
  async function save() {
    try { await api('/api/me/organization/intro', 'PUT', { intro }); setNote({ ok: '소개를 저장했어요' }) } catch (cause) { setNote({ error: failText(cause) }) }
  }
  return <Panel title="기관 공개 페이지" right={<a className="pc-link" href={'#/o/' + id} target="_blank" rel="noreferrer">페이지 보기 ›</a>}>
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label className="pc-f"><span>소개 <small>{(intro ?? '').length} / 300 · 연락처는 적을 수 없어요</small></span><textarea className="pc-ta" maxLength={300} value={intro ?? ''} disabled={intro === null} onChange={e => { setIntro(e.target.value); setNote({}) }} /></label>
      {note.ok && <p className="pc-ok" role="status" style={{ margin: 0 }}>{note.ok}</p>}{note.error && <p className="pc-err" role="alert" style={{ margin: 0 }}>{note.error}</p>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="pc-btn" onClick={() => void save()}>소개 저장</button>
        <button className="pc-btn line" onClick={() => { void navigator.clipboard?.writeText(url).then(() => setNote({ ok: '페이지 링크를 복사했어요' })) }}>링크 복사</button><span className="mu" style={{ fontSize: 12.5 }}>{url}</span></div>
    </div></Panel>
}

function Profile({ user }: { user: User }) {
  return <>
    <div className="pc-head"><h1>기관 정보</h1></div>
    <div className="pc-grid2">
      <Panel title="기관"><div style={{ padding: '4px 16px 10px' }}>
        <div className="pc-kv"><span>기관명</span><b>{user.organization?.name}</b></div>
        <div className="pc-kv"><span>상태</span><b><span className="pc-tag g">확인 완료</span></b></div>
        <div className="pc-kv"><span>담당자</span><b>{user.name}</b></div>
        <div className="pc-kv" style={{ borderBottom: 0 }}><span>로그인 이메일</span><b>{user.email}</b></div>
        <p className="pc-note" style={{ marginTop: 8 }}>기관 이름·연락처를 바꾸려면 운영자에게 문의해 주세요.</p></div></Panel>
      <PublicPagePanel id={user.organization?.id} />
      <Panel title="현장에서는 앱으로"><div style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'center' }}><AppQr size={104} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><p>출석 시작, QR 띄우기, 수동 출석은 같은 계정으로 앱에 로그인해서 해요.</p><a className="pc-btn sm" href={appUrl()}><PcIcon name="download" />앱 받기</a></div></div></Panel>
    </div>
  </>
}

/** 기관 확인 전 (대기 · 반려 · 중지): only this page. */
export function OrgPending({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const org = user.organization
  const rejected = org?.status === 'REJECTED', stopped = org?.status === 'SUSPENDED'
  return <div className="pc">
    <header className="pc-hd"><Logo sub="기관센터" href="#/org" /><div className="pc-sp" /><div className="pc-who"><span>{org?.name ?? user.name}</span><button type="button" onClick={onSignOut}>로그아웃</button></div></header>
    <div className="pc-center"><div className="pc-pn pc-card wide">
      <span className={'pc-tag ' + (rejected || stopped ? 'red' : 'amb')} style={{ alignSelf: 'flex-start' }}>{rejected ? '반려됨' : stopped ? '이용 중지' : '확인 중'}</span>
      <h1>{rejected ? '기관 확인이 반려됐어요' : stopped ? '기관 이용이 중지됐어요' : '기관 확인을 기다리고 있어요'}</h1>
      {rejected && org?.rejectReason && <p className="pc-q">반려 사유: {org.rejectReason}</p>}
      {!rejected && !stopped && <div className="pc-steps">
        <div><b>가입 신청</b><small>{org?.name}</small></div>
        <div className="now"><b>운영자 확인</b><small>보통 1~2일 걸려요. 결과는 앱 알림으로도 알려 드려요</small></div>
        <div className="next"><b>모집 시작</b><small>확인되면 이 화면이 기관센터로 바뀌어요</small></div></div>}
      {!stopped && <MyDocs canEdit={!stopped} />}
      <p className="mu">{rejected || stopped ? '궁금한 점은 운영자에게 문의해 주세요.' : '그동안 같은 계정으로 앱에 로그인해 둘 수 있어요.'}</p>
      <div style={{ display: 'flex', gap: 8 }}><a className="pc-btn line" href={appUrl()}><PcIcon name="download" />앱 받기</a><button className="pc-btn line" onClick={() => window.location.reload()}><PcIcon name="refresh" />다시 확인</button></div>
    </div></div>
  </div>
}
