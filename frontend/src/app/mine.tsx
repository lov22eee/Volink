// 내 활동: 참여 예정 (my applications) / 내 모집현황 (activities I opened) / 완료 기록 (Volink records).
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { LiveActivity, MyParticipation, MyRecord } from '../api'
import { durationLabel } from '../create'
import { dayWord, dDay, Empty, Loading, MIcon, RecruitFab, TopBar } from './ui'
import { RecordRow, useRecords } from './record'
import { hoursText, useConnect1365, useImport1365 } from './lab'
import type { LabSummary } from './lab'

type View = 'join' | 'host' | 'done'
export const statusWord: Record<string, { text: string; tone: string }> = {
  APPLIED: { text: '승인 대기', tone: 'amber' }, CONFIRMED: { text: '참가 확정', tone: 'mint' }, WAITLISTED: { text: '대기 중', tone: 'amber' },
  OFFERED: { text: '자리 제안', tone: 'hot' }, CHECKED_IN: { text: '출석 완료', tone: 'mint' }, COMPLETED: { text: '활동 완료', tone: 'mint' },
  REJECTED: { text: '함께하지 못해요', tone: 'gray' }, CANCELLED: { text: '취소함', tone: 'gray' }, EXPIRED: { text: '마감', tone: 'gray' }, NO_SHOW: { text: '불참', tone: 'gray' },
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
    <span className={'m-btn sm' + (live ? '' : ' line')}>{live ? '모집 관리' : '결과 보기'}</span>
  </a>
}

/** One Volink record row (완료 기록). */
function VolinkRow({ x }: { x: MyRecord }) {
  return <a className="m-row" href={'#/activity/' + x.activityId}>
    <span className="m-row-ico"><MIcon name="record" size={21} /></span>
    <span className="m-row-main"><strong>{x.title}</strong><small>{x.date.slice(5).replace('-', '/')} {x.startTime} · {durationLabel(x.durationMinutes)} · {x.checkInMethod === 'QR' ? 'QR 출석' : '모집자 확인'}</small></span>
    <span className={'m-badge ' + (x.status === 'VALID' ? 'mint' : 'amber')}>{x.status === 'VALID' ? '완료' : x.status === 'HELD' ? '보류' : '무효'}</span></a>
}

/** 전체보기: every finished 1365 record or every Volink record, newest first. */
function DoneAll({ kind }: { kind: '1365' | 'volink' }) {
  const external = useRecords()
  const [records, setRecords] = useState<MyRecord[] | null>(null)
  useEffect(() => { if (kind === 'volink') api<MyRecord[]>('/api/me/records').then(setRecords).catch(() => setRecords([])) }, [kind])
  const ext = (external ?? []).filter(r => r.status === 'ATTENDED').sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime))
  const volink = (records ?? []).slice().sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime))
  const valid = volink.filter(x => x.status === 'VALID')
  return <div className="m-screen"><TopBar title={kind === '1365' ? '1365 활동' : 'Volink 활동'} back="#/mine?tab=done" />
    <div className="m-body">{kind === '1365'
      ? (!external ? <Loading /> : <><p className="m-help">{ext.length}건 · 본인 기록·실적확인서 기준이에요. 공식 실적은 1365에서 확인해 주세요.</p><div className="m-list">{ext.map(r => <RecordRow key={r.id} r={r} />)}</div></>)
      : (!records ? <Loading /> : <><div className="m-stats"><div><b>{valid.length}</b><span>완료 활동</span></div>
          <div><b>{Math.round(valid.reduce((sum, x) => sum + x.durationMinutes, 0) / 6) / 10}h</b><span>함께한 시간</span></div></div>
        <div className="m-list">{volink.map(x => <VolinkRow key={x.id} x={x} />)}</div>
        <p className="m-help">Volink 자체 기록이에요. 공식 봉사실적이 아니에요. 완료한 활동은 커뮤니티에 ‘참여 확인’ 후기로 남길 수 있어요.</p></>)}</div>
  </div>
}

export function MineScreen({ actions, initial, all }: { actions: ReactNode; initial?: string; all?: string }) {
  if (all === '1365' || all === 'volink') return <DoneAll kind={all} />
  return <MineTabs actions={actions} initial={initial} />
}

function MineTabs({ actions, initial }: { actions: ReactNode; initial?: string }) {
  const [view, setView] = useState<View>(initial === 'host' || initial === 'done' ? initial : 'join')
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
  const extDone = (external ?? []).filter(r => r.status === 'ATTENDED').sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime))
  const hostLive = (hosted ?? []).filter(isLive)
  const volinkDone = (records ?? []).slice().sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime))
  // Lab (V28): my 1365 total as read from my own 1365 page (not checked by Volink).
  const [connectSheet, connect] = useConnect1365()
  // Empty 참여 예정 / 완료 기록 [가져오기] (2026-11-07): 1365에서 가져오기 / 직접 추가하기 right here.
  const [importSheet, importFrom] = useImport1365(() => setRecordsVersion(v => v + 1))
  const [summary, setSummary] = useState<(LabSummary & { fetchedAt: string }) | null>(null)
  useEffect(() => { api<LabSummary & { fetchedAt?: string }>('/api/me/external/summary').then(s => setSummary(s.fetchedAt ? s as LabSummary & { fetchedAt: string } : null)).catch(() => {}) }, [])
  // 완료 기록 (B): one list, newest first, filtered by the chip.
  const [doneKind, setDoneKind] = useState<'all' | '1365' | 'volink'>('all')
  const volinkValid = (records ?? []).filter(x => x.status === 'VALID')
  const volinkMinutes = volinkValid.reduce((sum, x) => sum + x.durationMinutes, 0)
  const extMinutes = summary ? summary.totalMinutes : (external ?? []).filter(r => r.certified).reduce((sum, r) => sum + (r.certMinutes ?? 0), 0)
  const allMinutes = volinkMinutes + extMinutes
  type DoneItem = { kind: '1365'; key: string; r: NonNullable<typeof external>[number] } | { kind: 'volink'; key: string; x: MyRecord }
  const doneList: DoneItem[] = [
    ...(doneKind !== 'volink' ? extDone.map(r => ({ kind: '1365' as const, key: r.date + r.startTime, r })) : []),
    ...(doneKind !== '1365' ? volinkDone.map(x => ({ kind: 'volink' as const, key: x.date + x.startTime, x })) : []),
  ].sort((a, b) => b.key.localeCompare(a.key))
  const now = Date.now()
  const ends = (date: string, time: string, minutes = 90) => new Date(`${date}T${time}:00+09:00`).getTime() + minutes * 60_000
  const upcoming = (joined ?? []).filter(p => ['APPLIED', 'CONFIRMED', 'WAITLISTED', 'OFFERED', 'CHECKED_IN'].includes(p.status) && p.activityStatus !== 'CANCELLED' && ends(p.date, p.startTime, p.durationMinutes) > now)
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
  const ended = (joined ?? []).filter(p => !upcoming.includes(p) && p.status !== 'COMPLETED').slice(0, 6)
  const tabs: [View, string][] = [['join', '참여 예정'], ['host', '내 모집현황'], ['done', '완료 기록']]
  return <div className="m-screen">
    <TopBar title="내 활동" actions={actions} />
    <div className="mg-tabs m-mine-tabs" role="tablist" aria-label="내 활동 보기">{tabs.map(([id, label]) =>
      <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>{label}</button>)}</div>
    <div className="m-body">
      {view === 'join' && (!joined ? <Loading /> : <>
        {upcoming.length ? <div className="m-cards">{upcoming.map(p => <a key={p.id} className="m-card" href={'#/activity/' + p.activityId}>
          <div className="m-card-top"><strong>{p.title}</strong><span className={'m-badge ' + statusWord[p.status].tone}>{p.status === 'WAITLISTED' && p.waitOrder ? `대기 ${p.waitOrder}번` : statusWord[p.status].text}</span></div>
          <p>{dayWord(p.date)} · {p.startTime}{p.placeName ? ' · ' + p.placeName : ''}</p>
          {dDay(p.date) && <span className="m-dday">{dDay(p.date)}</span>}
          <span className="m-btn sm">{p.status === 'OFFERED' ? '자리 제안 확인' : '활동 상세 보기'}</span>
        </a>)}</div> : !extPlanned.length && <Empty bare icon="calendar" title="참여 예정인 활동이 없어요"
          action={<div className="m-empty-two"><button type="button" className="m-btn sm blue" onClick={() => importFrom('A')}>가져오기</button><a className="m-btn sm" href="#/find">봉사 찾아보기</a></div>} />}
        {extPlanned.length > 0 && <section className="m-section"><div className="m-section-head"><h2>1365 활동</h2><button type="button" className="m-more" onClick={connect}>1365 가져오기 ›</button></div>
          <div className="m-list">{extPlanned.map(r => <RecordRow key={r.id} r={r} />)}</div></section>}
        {ended.length > 0 && <section className="m-section"><div className="m-section-head"><h2>지난 신청</h2></div><div className="m-list">{ended.map(p =>
          <a key={p.id} className="m-row dim" href={'#/activity/' + p.activityId}><span className="m-row-main"><strong>{p.title}</strong>
            <small>{p.date.slice(5).replace('-', '/')} {p.startTime}{p.activityStatus === 'CANCELLED' ? ' · 모집자가 활동을 취소했어요' : ''}</small></span>
            <span className={'m-badge ' + (statusWord[p.status]?.tone ?? 'gray')}>{p.activityStatus === 'CANCELLED' ? '활동 취소' : statusWord[p.status]?.text ?? p.status}</span></a>)}</div></section>}
      </>)}
      {/* 2026-11-06: no live recruitment → no card, in the middle: [새 활동 만들기] (+ [다시 모집] when there is a past one to reuse). */}
      {view === 'host' && (!hosted ? <Loading /> : hostLive.length ? <>
        <div className="m-newbtns"><a className="main" href="#/create"><MIcon name="plus" size={22} /><span>새 활동 만들기</span></a>
          <a href="#/host"><MIcon name="refresh" size={22} /><span>다시 모집</span></a></div>
        <div className="m-cards">{hosted.map(a => <HostCard key={a.id} a={a} />)}</div></> : <>
        <Empty bare icon="plus" title={hosted.length ? '진행 중인 모집이 없어요' : '아직 모집한 활동이 없어요'}
          text={hosted.length ? '지난 모집을 다시 열거나 새 활동을 만들어 보세요.' : '이웃과 함께할 활동을 열어 보세요.'}
          action={<div className="m-empty-two"><a className="m-btn sm" href="#/create"><MIcon name="plus" size={18} />새 활동 만들기</a>
            {hosted.length > 0 && <a className="m-btn sm line" href="#/host"><MIcon name="refresh" size={18} />다시 모집</a>}</div>} />
        {hosted.length > 0 && <section className="m-section"><div className="m-section-head"><h2>지난 모집</h2></div><div className="m-cards">{hosted.map(a => <HostCard key={a.id} a={a} />)}</div></section>}
      </>)}
      {/* 2026-11-06 (B): 함께한 시간 (1365 + Volink) · 1365 연결/새로고침 · chips [전체 · 1365 · Volink] · one list, newest first. */}
      {view === 'done' && (!records || !external ? <Loading /> : !records.length && !extDone.length && !summary
        ? <Empty bare icon="record" title="아직 완료 기록이 없어요" text="1365에서 했던 봉사가 있다면 연결해서 한곳에 모아 보세요."
            action={<div className="m-empty-two"><button type="button" className="m-btn sm blue" onClick={() => importFrom('S')}>가져오기</button><a className="m-btn sm" href="#/find">봉사 찾아보기</a></div>} />
        : <>
          <section className="my-total" aria-label="함께한 시간">
            <small>함께한 시간</small>
            <b>{Math.floor(allMinutes / 60)}<em>시간</em>{allMinutes % 60 ? <> {allMinutes % 60}<em>분</em></> : null}</b>
            {allMinutes > 0 && <i className="my-split"><span className="ext" style={{ width: (extMinutes / allMinutes * 100) + '%' }} /><span style={{ width: (volinkMinutes / allMinutes * 100) + '%' }} /></i>}
            <span className="my-sum">1365 {hoursText(extMinutes)}{summary ? ' (공식 실적)' : ''} + Volink {hoursText(volinkMinutes)}</span>
          </section>
          {summary ? <button type="button" className="my-conn" onClick={connect}><MIcon name="refresh" size={18} /><span><b>1365 연결됨</b> · {summary.fetchedAt.slice(5, 10).replace('-', '/')} 가져온 1365 공식 실적</span><em>갱신하기</em></button>
            : <button type="button" className="my-conn" onClick={connect}><MIcon name="outward" size={18} /><span><b>1365 봉사실적 연결하기</b> · 1365에서 한 봉사도 함께 모아요</span><em>연결</em></button>}
          <div className="m-chips done-chips" role="radiogroup" aria-label="완료 기록 보기">{([['all', '전체', extDone.length + volinkDone.length], ['1365', '1365', extDone.length], ['volink', 'Volink', volinkDone.length]] as const).map(([key, label, n]) =>
            <button key={key} type="button" role="radio" aria-checked={doneKind === key} className={'m-chip' + (doneKind === key ? ' on' : '')} onClick={() => setDoneKind(key)}>{label} {n}</button>)}</div>
          {doneList.length ? <div className="m-list">{doneList.map(item => item.kind === '1365' ? <RecordRow key={'e' + item.r.id} r={item.r} /> : <VolinkRow key={'v' + item.x.id} x={item.x} />)}</div>
            : null}
        </>)}
    </div>
    {connectSheet}
    {importSheet}
    {view !== 'done' && <RecruitFab />}
  </div>
}
