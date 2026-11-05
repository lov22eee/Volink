// 내 활동: 참여 예정 (my applications) / 내가 모집 (activities I opened) / 완료 기록 (Volink records).
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { LiveActivity, MyParticipation, MyRecord } from '../api'
import { durationLabel } from '../create'
import { dayWord, dDay, Empty, Loading, MIcon, TopBar } from './ui'

type View = 'join' | 'host' | 'done'
export const statusWord: Record<string, { text: string; tone: string }> = {
  APPLIED: { text: '승인 대기', tone: 'amber' }, CONFIRMED: { text: '참가 확정', tone: 'mint' }, WAITLISTED: { text: '대기 중', tone: 'amber' },
  OFFERED: { text: '자리 제안', tone: 'hot' }, CHECKED_IN: { text: '출석 완료', tone: 'mint' }, COMPLETED: { text: '활동 완료', tone: 'mint' },
  REJECTED: { text: '함께하지 못해요', tone: 'gray' }, CANCELLED: { text: '취소함', tone: 'gray' }, EXPIRED: { text: '마감', tone: 'gray' }, NO_SHOW: { text: '불참', tone: 'gray' },
}

export function MineScreen({ actions, initial }: { actions: ReactNode; initial?: string }) {
  const [view, setView] = useState<View>(initial === 'host' || initial === 'done' ? initial : 'join')
  const [joined, setJoined] = useState<MyParticipation[] | null>(null)
  const [hosted, setHosted] = useState<LiveActivity[] | null>(null)
  const [records, setRecords] = useState<MyRecord[] | null>(null)
  useEffect(() => {
    api<MyParticipation[]>('/api/me/participations').then(setJoined).catch(() => setJoined([]))
    api<LiveActivity[]>('/api/me/activities').then(setHosted).catch(() => setHosted([]))
    api<MyRecord[]>('/api/me/records').then(setRecords).catch(() => setRecords([]))
  }, [])
  const now = Date.now()
  const ends = (date: string, time: string, minutes = 90) => new Date(`${date}T${time}:00+09:00`).getTime() + minutes * 60_000
  const upcoming = (joined ?? []).filter(p => ['APPLIED', 'CONFIRMED', 'WAITLISTED', 'OFFERED', 'CHECKED_IN'].includes(p.status) && p.activityStatus !== 'CANCELLED' && ends(p.date, p.startTime, p.durationMinutes) > now)
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
  const ended = (joined ?? []).filter(p => !upcoming.includes(p) && p.status !== 'COMPLETED').slice(0, 6)
  const tabs: [View, string][] = [['join', '참여 예정'], ['host', '내가 모집'], ['done', '완료 기록']]
  return <div className="m-screen">
    <TopBar title="내 활동" actions={actions} />
    <div className="m-seg-tabs" role="tablist" aria-label="내 활동 보기">{tabs.map(([id, label]) =>
      <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>{label}</button>)}</div>
    <div className="m-body">
      {view === 'join' && (!joined ? <Loading /> : <>
        {upcoming.length ? <div className="m-cards">{upcoming.map(p => <a key={p.id} className="m-card" href={'#/activity/' + p.activityId}>
          <div className="m-card-top"><strong>{p.title}</strong><span className={'m-badge ' + statusWord[p.status].tone}>{p.status === 'WAITLISTED' && p.waitOrder ? `대기 ${p.waitOrder}번` : statusWord[p.status].text}</span></div>
          <p>{dayWord(p.date)} · {p.startTime}{p.placeName ? ' · ' + p.placeName : ''}</p>
          {dDay(p.date) && <span className="m-dday">{dDay(p.date)}</span>}
          <span className="m-btn sm">{p.status === 'OFFERED' ? '자리 제안 확인' : '활동 상세 보기'}</span>
        </a>)}</div> : <Empty icon="calendar" title="참여 예정인 활동이 없어요" action={<a className="m-btn sm" href="#/find">봉사 찾아보기</a>} />}
        {ended.length > 0 && <section className="m-section"><div className="m-section-head"><h2>지난 신청</h2></div><div className="m-list">{ended.map(p =>
          <a key={p.id} className="m-row dim" href={'#/activity/' + p.activityId}><span className="m-row-main"><strong>{p.title}</strong>
            <small>{p.date.slice(5).replace('-', '/')} {p.startTime}{p.activityStatus === 'CANCELLED' ? ' · 모집자가 활동을 취소했어요' : ''}</small></span>
            <span className={'m-badge ' + (statusWord[p.status]?.tone ?? 'gray')}>{p.activityStatus === 'CANCELLED' ? '활동 취소' : statusWord[p.status]?.text ?? p.status}</span></a>)}</div></section>}
      </>)}
      {view === 'host' && (!hosted ? <Loading /> : hosted.length ? <div className="m-cards">{hosted.map(a => {
        const live = ['RECRUITING', 'IN_PROGRESS', 'DRAFT'].includes(a.status)
        const word = a.status === 'DRAFT' ? (a.reviewNote ? '반려' : '검토 중') : a.status === 'RECRUITING' ? '모집 중' : a.status === 'IN_PROGRESS' ? '진행 중' : a.status === 'FINISHED' ? '종료' : '취소'
        return <a key={a.id} className={'m-card' + (live ? '' : ' dim')} href={'#/manage/' + a.id}>
          <div className="m-card-top"><strong>{a.title}</strong><span className={'m-badge ' + (a.status === 'RECRUITING' ? 'mint' : a.status === 'DRAFT' ? 'amber' : 'gray')}>{word}</span></div>
          <p>{dayWord(a.date)} · {a.startTime} · 확정 {a.confirmed}/{a.capacity}명</p>
          {((a.pending ?? 0) > 0 || (a.unanswered ?? 0) > 0) && <p className="m-card-alert"><MIcon name="bell" size={15} />{[a.pending ? `승인 대기 ${a.pending}건` : '', a.unanswered ? `답변할 질문 ${a.unanswered}개` : ''].filter(Boolean).join(' · ')}</p>}
          <span className={'m-btn sm' + (live ? '' : ' line')}>{live ? '모집 관리' : '결과 보기'}</span>
        </a>
      })}</div> : <Empty icon="plus" title="아직 모집한 활동이 없어요" action={<a className="m-btn sm" href="#/create">새 활동 만들기</a>} />)}
      {view === 'done' && (!records ? <Loading /> : records.length ? <>
        <div className="m-stats"><div><b>{records.filter(x => x.status === 'VALID').length}</b><span>완료 활동</span></div>
          <div><b>{Math.round(records.filter(x => x.status === 'VALID').reduce((sum, x) => sum + x.durationMinutes, 0) / 6) / 10}h</b><span>함께한 시간</span></div></div>
        <div className="m-list">{records.map(x => <a key={x.id} className="m-row" href={'#/activity/' + x.activityId}>
          <span className="m-row-ico"><MIcon name="record" size={21} /></span>
          <span className="m-row-main"><strong>{x.title}</strong><small>{x.date.slice(5).replace('-', '/')} {x.startTime} · {durationLabel(x.durationMinutes)} · {x.checkInMethod === 'QR' ? 'QR 출석' : '모집자 확인'}</small></span>
          <span className={'m-badge ' + (x.status === 'VALID' ? 'mint' : 'amber')}>{x.status === 'VALID' ? '완료' : x.status === 'HELD' ? '보류' : '무효'}</span></a>)}</div>
        <p className="m-help">Volink 자체 기록이에요. 공식 봉사실적이 아니에요.</p>
      </> : <Empty icon="record" title="아직 활동 기록이 없어요" text="현장에서 QR로 체크인하고, 활동이 끝나 모집자가 완료를 확인하면 여기에 남아요." />)}
    </div>
  </div>
}
