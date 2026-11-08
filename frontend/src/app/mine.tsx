// 내 활동 (2026-11-08): 일정 (a month calendar of what I joined, 1365 and what I opened) / 나의 모집 (activities I opened).
// 완료 기록 is reached from 마이 › 활동 기록 (#/mine?tab=done) and no longer a tab here.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { LiveActivity, MyParticipation, MyRecord } from '../api'
import { durationLabel } from '../create'
import { dayWord, Empty, Loading, MIcon, RecruitFab, TopBar } from './ui'
import { RecordRow, useRecords } from './record'
import { useImport1365 } from './lab'
import { plansOf, Schedule, todayKst } from './schedule'

type View = 'join' | 'host'
export const statusWord: Record<string, { text: string; tone: string }> = {
  APPLIED: { text: '승인 대기', tone: 'amber' }, CONFIRMED: { text: '참가 확정', tone: 'mint' }, WAITLISTED: { text: '대기 중', tone: 'amber' },
  OFFERED: { text: '자리 제안', tone: 'hot' }, CHECKED_IN: { text: '출석 완료', tone: 'mint' }, COMPLETED: { text: '활동 완료', tone: 'mint' },
  REJECTED: { text: '함께하지 못해요', tone: 'gray' }, CANCELLED: { text: '취소함', tone: 'gray' }, EXPIRED: { text: '마감', tone: 'gray' }, NO_SHOW: { text: '불참', tone: 'gray' },
}

/**
 * Activities I ran that count as my volunteering too (2026-11-08, personal members): finished, with at least one participant
 * whose completion the organizer confirmed (so it really took place). Their length is added to Volink 활동 time.
 */
export const hostedRecords = (hosted: LiveActivity[]) => hosted.filter(a => a.status === 'FINISHED' && Number((a as LiveActivity & { completed?: number }).completed ?? 0) > 0)

/** A record of an activity I ran (활동 기록). */
function HostedRow({ a }: { a: LiveActivity }) {
  const n = Number((a as LiveActivity & { completed?: number }).completed ?? 0)
  return <a className="m-row" href={'#/manage/' + a.id}>
    <span className="m-row-ico host"><MIcon name="users" size={20} /></span>
    <span className="m-row-main"><strong>{a.title}</strong><small>{a.date.slice(5).replace('-', '/')} {a.startTime} · {durationLabel(a.durationMinutes)} · 모집 · {n}명 참여</small></span>
    <span className="m-badge host">모집 완료</span></a>
}

const isLive = (a: LiveActivity) => ['RECRUITING', 'IN_PROGRESS', 'DRAFT'].includes(a.status)

/** One of my recruitments (내 모집현황). */
function HostCard({ a }: { a: LiveActivity }) {
  const live = isLive(a)
  const word = a.status === 'DRAFT' ? (a.reviewNote ? '반려' : '검토 중') : a.status === 'RECRUITING' ? '모집 중' : a.status === 'IN_PROGRESS' ? '진행 중' : a.status === 'FINISHED' ? '종료' : '취소'
  return <a className={'m-card' + (live ? '' : ' dim')} href={'#/manage/' + a.id}>
    <div className="m-card-top"><strong>{a.title}</strong><span className={'m-badge ' + (a.status === 'RECRUITING' ? 'mint' : a.status === 'DRAFT' ? 'amber' : 'gray')}>{word}</span></div>
    <p>{dayWord(a.date)} · {a.startTime} · 확정 {a.confirmed}/{a.capacity}명</p>
    {((a.pending ?? 0) > 0 || (a.unanswered ?? 0) > 0) && <p className="m-card-alert"><MIcon name="bell" size={15} />{[a.pending ? `승인 대기 ${a.pending}건` : '', a.unanswered ? `답변할 질문 ${a.unanswered}개` : ''].filter(Boolean).join(' · ')}</p>}
    <span className={'m-btn sm' + (live && a.status !== 'DRAFT' ? '' : ' line')}>{a.status === 'DRAFT' ? '내용 보기' : live ? '모집 관리' : '결과 보기'}</span>
  </a>
}

/** One Volink record row (완료 기록). */
function VolinkRow({ x }: { x: MyRecord }) {
  return <a className="m-row" href={'#/activity/' + x.activityId}>
    <span className="m-row-ico"><MIcon name="record" size={21} /></span>
    <span className="m-row-main"><strong>{x.title}</strong><small>{x.date.slice(5).replace('-', '/')} {x.startTime} · {durationLabel(x.durationMinutes)} · {x.checkInMethod === 'QR' ? 'QR 출석' : '모집자 확인'}</small></span>
    <span className={'m-badge ' + (x.status === 'VALID' ? 'mint' : 'amber')}>{x.status === 'VALID' ? '완료' : x.status === 'HELD' ? '보류' : '무효'}</span></a>
}

export function MineScreen({ actions, initial, all }: { actions: ReactNode; initial?: string; all?: string }) {
  void all
  if (initial === 'done') return <RecordsScreen />
  return <MineTabs actions={actions} initial={initial} />
}

function MineTabs({ actions, initial }: { actions: ReactNode; initial?: string }) {
  const [view, setView] = useState<View>(initial === 'host' ? 'host' : 'join')
  const [joined, setJoined] = useState<MyParticipation[] | null>(null)
  const [hosted, setHosted] = useState<LiveActivity[] | null>(null)
  const [records, setRecords] = useState<MyRecord[] | null>(null)
  useEffect(() => {
    api<MyParticipation[]>('/api/me/participations').then(setJoined).catch(() => setJoined([]))
    api<LiveActivity[]>('/api/me/activities').then(setHosted).catch(() => setHosted([]))
    api<MyRecord[]>('/api/me/records').then(setRecords).catch(() => setRecords([]))
  }, [])
  // 1365 activities I marked (V27): still to come or waiting for "다녀왔어요?" under 참여 예정, the ones I went to under 완료 기록.
  const [recordsVersion, setRecordsVersion] = useState(0)
  const external = useRecords(recordsVersion)
  const extPlanned = (external ?? []).filter(r => r.status === 'PLANNED').sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
  const hostLive = (hosted ?? []).filter(isLive)
  // Empty 참여 예정 / 완료 기록 [가져오기] (2026-11-07): 1365에서 가져오기 / 직접 추가하기 right here.
  const [importSheet, importFrom] = useImport1365(() => setRecordsVersion(v => v + 1))
  const now = Date.now()
  const tabs: [View, string][] = [['join', '일정'], ['host', '나의 모집']]
  const plans = joined && hosted && records && external ? plansOf(joined, hosted, records, external, now) : null
  // 1365 activities whose day has passed and still ask "다녀왔어요?" / 실적 확인 대기: on top, not hidden in a past day.
  const today = todayKst()
  const toCheck = extPlanned.filter(r => r.date < today)
  const [morePast, setMorePast] = useState(false)
  const hostPast = (hosted ?? []).filter(a => !isLive(a))
  return <div className="m-screen">
    <TopBar title="내 활동" actions={actions} />
    <div className="mg-tabs m-mine-tabs" role="tablist" aria-label="내 활동 보기">{tabs.map(([id, label]) =>
      <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>{label}</button>)}</div>
    <div className="m-body">
      {view === 'join' && (!plans ? <Loading /> : <Schedule plans={plans}
        after={toCheck.length > 0 && <section className="m-section sc-check"><div className="m-section-head"><h2>확인이 필요해요</h2></div>
          <div className="m-list">{toCheck.map(r => <RecordRow key={r.id} r={r} />)}</div></section>}
        empty={<Empty bare icon="calendar" title="아직 일정이 없어요" text="마음에 드는 봉사를 찾아 신청해 보세요"
          action={<div className="m-empty-two"><a className="m-btn sm" href="#/find">봉사 찾아보기</a><button type="button" className="m-btn sm blue" onClick={() => importFrom('A')}>1365 가져오기</button></div>} />} />)}
      {/* 나의 모집 (2026-11-08): 진행 중 (with what needs doing) on top, 지난 모집 folded. */}
      {view === 'host' && (!hosted ? <Loading /> : hosted.length ? <>
        <div className="m-newbtns"><a className="main" href="#/create"><MIcon name="plus" size={22} /><span>새 활동 만들기</span></a>
          {hostPast.length > 0 && <a href="#/host"><MIcon name="refresh" size={22} /><span>다시 모집</span></a>}</div>
        {hostLive.length > 0 ? <section className="m-section"><div className="m-section-head"><h2>진행 중 {hostLive.length}</h2></div>
          <div className="m-cards">{hostLive.map(a => <HostCard key={a.id} a={a} />)}</div></section>
          : <p className="m-help sc-none">진행 중인 모집이 없어요. 지난 모집을 다시 열거나 새 활동을 만들어 보세요.</p>}
        {hostPast.length > 0 && <section className="m-section"><div className="m-section-head"><h2>지난 모집 {hostPast.length}</h2>
          {hostPast.length > 3 && <button type="button" className="m-more" onClick={() => setMorePast(!morePast)}>{morePast ? '접기' : '전체보기 ›'}</button>}</div>
          <div className="m-cards">{(morePast ? hostPast : hostPast.slice(0, 3)).map(a => <HostCard key={a.id} a={a} />)}</div></section>}
      </> : <Empty bare icon="plus" title="아직 모집한 활동이 없어요" text="이웃과 함께할 봉사를 직접 열어 보세요"
          action={<a className="m-btn sm" href="#/create"><MIcon name="plus" size={18} />새 활동 만들기</a>} />)}
    </div>
    {importSheet}
    <RecruitFab />
  </div>
}

/**
 * 마이 › 활동 기록 (2026-11-08, was the 완료 기록 tab): every finished activity — 1365 (from the 1365 실적 list or marked
 * 다녀왔어요) and Volink records — newest first, this year by month and earlier years by year. Chips 전체 / 1365 / Volink.
 */
export function RecordsScreen({ user }: { user?: { memberType?: string } }) {
  const kindParam = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('kind')
  const [kind, setKind] = useState<'all' | '1365' | 'volink'>(kindParam === '1365' || kindParam === 'volink' ? kindParam : 'all')
  const [records, setRecords] = useState<MyRecord[] | null>(null)
  const [version, setVersion] = useState(0)
  const [hosted, setHosted] = useState<LiveActivity[] | null>(null)
  useEffect(() => {
    api<MyRecord[]>('/api/me/records').then(setRecords).catch(() => setRecords([]))
    api<LiveActivity[]>('/api/me/activities').then(setHosted).catch(() => setHosted([]))
  }, [])
  const led = user?.memberType === 'INSTITUTION' ? [] : hostedRecords(hosted ?? [])
  const external = useRecords(version)
  const [importSheet, importFrom] = useImport1365(() => setVersion(v => v + 1))
  const ext = (external ?? []).filter(r => r.status === 'ATTENDED')
  const volink = records ?? []
  type Item = { kind: '1365'; key: string; r: NonNullable<typeof external>[number] } | { kind: 'volink'; key: string; x: MyRecord } | { kind: 'led'; key: string; a: LiveActivity }
  const items: Item[] = [
    ...(kind !== 'volink' ? ext.map(r => ({ kind: '1365' as const, key: r.date + r.startTime, r })) : []),
    ...(kind !== '1365' ? volink.map(x => ({ kind: 'volink' as const, key: x.date + x.startTime, x })) : []),
    ...(kind !== '1365' ? led.map(a => ({ kind: 'led' as const, key: a.date + a.startTime, a })) : []),
  ].sort((a, b) => b.key.localeCompare(a.key))
  const year = todayKst().slice(0, 4)
  const groupOf = (key: string) => key.slice(0, 4) === year ? `${key.slice(0, 4)}년 ${Number(key.slice(5, 7))}월` : `${key.slice(0, 4)}년`
  const groups: [string, Item[]][] = []
  for (const item of items) { const g = groupOf(item.key); const last = groups[groups.length - 1]; if (last && last[0] === g) last[1].push(item); else groups.push([g, [item]]) }
  const loading = !records || !external || !hosted
  return <div className="m-screen">
    <TopBar title="활동 기록" back="#/my" />
    <div className="m-body">
      {loading ? <Loading /> : !ext.length && !volink.length && !led.length
        ? <Empty bare icon="record" title="아직 활동 기록이 없어요" text="함께한 봉사가 여기에 모여요"
            action={<div className="m-empty-two"><button type="button" className="m-btn sm blue" onClick={() => importFrom('S')}>1365 가져오기</button><a className="m-btn sm" href="#/find">봉사 찾아보기</a></div>} />
        : <>
          <div className="m-chips done-chips" role="radiogroup" aria-label="활동 기록 보기">{([['all', '전체', ext.length + volink.length + led.length], ['1365', '1365', ext.length], ['volink', 'Volink', volink.length + led.length]] as const).map(([key, label, n]) =>
            <button key={key} type="button" role="radio" aria-checked={kind === key} className={'m-chip' + (kind === key ? ' on' : '')} onClick={() => setKind(key)}>{label} {n}</button>)}</div>
          {groups.map(([title, list]) => <section key={title} className="m-section rec-group"><div className="m-section-head"><h2>{title}</h2></div>
            <div className="m-list">{list.map(item => item.kind === '1365' ? <RecordRow key={'e' + item.r.id} r={item.r} /> : item.kind === 'led' ? <HostedRow key={'h' + item.a.id} a={item.a} /> : <VolinkRow key={'v' + item.x.id} x={item.x} />)}</div></section>)}
          {!items.length && <p className="m-help">이 종류의 기록은 아직 없어요.</p>}
          <p className="m-help">1365 기록은 1365 화면에서 가져온 값이고, Volink 기록은 자체 기록이에요. 공식 봉사실적·보험은 1365 기준이에요.</p>
        </>}
    </div>
    {importSheet}
  </div>
}
