// 홈: greeting, 우리 동네 지금, my nearest activity (+ things to do now), categories, this weekend, suits me, reviews.
// Few boxes: sections are split by type, space and thin lines. 발자취 lives in 마이 / 내 활동.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { LiveActivity, MyParticipation, MyRecord, User } from '../api'
import { categories, categoryTone } from '../categories'
import { CategoryCover } from '../covers'
import { range } from '../explore'
import type { Program } from '../explore'
import { currentPosition, remembered } from '../location'
import { StatsBanner } from './stats'
import { ago } from './community'
import type { PostSummary } from './community'
import { phaseOf, useNow } from '../checkin'
import { ActivityRow, fieldIcon, isNewcomer, seatsLeft, startsAt } from './cards'
import { dayWord, dDay, Loading, MIcon, TopBar } from './ui'
import type { MIconName } from './ui'

type Todo = { key: string; icon: MIconName; text: string; href: string; tone?: 'hot' }
const ACTIVE = ['APPLIED', 'CONFIRMED', 'WAITLISTED', 'OFFERED', 'CHECKED_IN']

export function HomeScreen({ user, actions }: { user: User; actions: ReactNode }) {
  const now = useNow(30_000)
  const [mine, setMine] = useState<MyParticipation[] | null>(null)
  const [hosted, setHosted] = useState<LiveActivity[] | null>(null)
  const [open, setOpen] = useState<LiveActivity[] | null>(null)
  const [records, setRecords] = useState<MyRecord[] | null>(null)
  const [reviews, setReviews] = useState<PostSummary[]>([])
  const [allReviews, setAllReviews] = useState<PostSummary[]>([])
  const [programs, setPrograms] = useState<Program[] | null>(null)
  // 1365 programs in my 관심 분야 near me (only when the person already allowed location; never asks here).
  useEffect(() => {
    if (!user.interests.length || !remembered()) return
    let live = true
    currentPosition().then(at => {
      if (!at || !live) return
      api<{ items: Program[] }>(`/api/volunteer-programs?lat=${at.lat.toFixed(6)}&lng=${at.lng.toFixed(6)}&radiusKm=10&category=${encodeURIComponent(user.interests.join(','))}`)
        .then(result => { if (live) setPrograms(result.items) }).catch(() => {})
    })
    return () => { live = false }
  }, [user.interests])
  useEffect(() => {
    api<MyRecord[]>('/api/me/records').then(setRecords).catch(() => setRecords([]))
    api<PostSummary[]>('/api/community/posts?category=REVIEW&sort=latest').then(list => { setAllReviews(list); setReviews(list.slice(0, 2)) }).catch(() => setReviews([]))
    api<MyParticipation[]>('/api/me/participations').then(setMine).catch(() => setMine([]))
    api<LiveActivity[]>('/api/me/activities').then(setHosted).catch(() => setHosted([]))
    api<LiveActivity[]>('/api/activities').then(setOpen).catch(() => setOpen([]))
  }, [])
  if (!mine || !hosted || !open) return <div className="m-screen"><TopBar brand actions={actions} /><Loading /></div>

  const end = (date: string, time: string, minutes = 90) => new Date(`${date}T${time}:00+09:00`).getTime() + minutes * 60_000
  const joined = mine.filter(p => ACTIVE.includes(p.status) && p.activityStatus !== 'CANCELLED' && end(p.date, p.startTime, p.durationMinutes) > now)
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
  const running = hosted.filter(a => ['RECRUITING', 'IN_PROGRESS'].includes(a.status) && end(a.date, a.startTime, a.durationMinutes) > now)
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))

  // Things to do now: shown only while they are true.
  const todos: Todo[] = []
  for (const p of joined) {
    if (p.status === 'OFFERED') todos.push({ key: 'o' + p.id, icon: 'bolt', tone: 'hot', text: `빈자리 제안이 왔어요 · ${p.title}`, href: '#/activity/' + p.activityId })
    if (p.status === 'CONFIRMED' && phaseOf(p.date, p.startTime, p.durationMinutes ?? 90, now).phase === 'open') todos.push({ key: 'c' + p.id, icon: 'qr', tone: 'hot', text: `체크인이 열렸어요 · ${p.title}`, href: '#/activity/' + p.activityId })
  }
  for (const a of running) {
    const phase = phaseOf(a.date, a.startTime, a.durationMinutes, now).phase
    if (phase === 'open' || phase === 'late') todos.push({ key: 'q' + a.id, icon: 'qr', tone: 'hot', text: `출석 QR을 띄울 시간이에요 · ${a.title}`, href: '#/manage/' + a.id + '?tab=attendance' })
    if ((a.pending ?? 0) > 0) todos.push({ key: 'p' + a.id, icon: 'users', text: `승인할 신청 ${a.pending}건 · ${a.title}`, href: '#/manage/' + a.id })
    if ((a.unanswered ?? 0) > 0) todos.push({ key: 'u' + a.id, icon: 'chat', text: `답변할 질문 ${a.unanswered}개 · ${a.title}`, href: '#/news/' + a.id })
  }
  for (const a of hosted.filter(a => a.status === 'FINISHED' && (a.checkedIn ?? 0) > 0))
    todos.push({ key: 'f' + a.id, icon: 'check', text: `완료 확인할 참가자 ${a.checkedIn}명 · ${a.title}`, href: '#/manage/' + a.id + '?tab=attendance' })

  const next = joined[0]
  const hostNext = running[0]
  const taken = new Set([...mine.map(p => p.activityId), ...hosted.map(a => a.id)])
  const others = open.filter(a => !taken.has(a.id) && a.organizerId !== user.id && seatsLeft(a) > 0)
  // This weekend (Korean dates), shown as its own row: not repeated below.
  const weekend = range('weekend')
  const weekendPicks = others.filter(a => weekend.from && weekend.to && a.date >= weekend.from && a.date <= weekend.to).slice(0, 6)
  // 나에게 맞는 봉사 = my 관심 분야: neighbourhood posts in those fields (soonest first, newcomer-friendly first on ties)
  // and 1365 programs near me in the same fields. No interests yet → a card asking to choose them.
  const mine3 = user.interests
  const picks = mine3.length ? others.filter(a => mine3.includes(a.category)).sort((a, b) => startsAt(a) - startsAt(b) || Number(isNewcomer(b)) - Number(isNewcomer(a))).slice(0, 3) : []
  const valid = (records ?? []).filter(r => r.status === 'VALID')
  // A Volink activity finished in the last 7 days that I have not reviewed yet (my reviews are among the latest 50).
  const reviewed = new Set(allReviews.filter(r => r.mine && r.activityId).map(r => r.activityId))
  const weekAgo = new Date(now + 9 * 3_600_000 - 7 * 86_400_000).toISOString().slice(0, 10)
  const justDone = valid.filter(r => r.date >= weekAgo && !reviewed.has(r.activityId)).sort((a, b) => b.date.localeCompare(a.date))[0]

  // 나의 봉사: the one nearest thing, joined or hosting (whichever starts first).
  const hostFirst = hostNext && (!next || startsAt(hostNext) < startsAt({ date: next.date, startTime: next.startTime }))

  return <div className="m-screen m-home">
    <TopBar brand actions={actions} />
    <div className="m-body">
      <div className="m-hello"><p>{user.name}님, 오늘도 좋은 하루예요</p><h1>우리 동네에서 시작하는 작은 변화</h1></div>

      <StatsBanner />

      <section className="h-sec" aria-label="나의 봉사">
        <div className="h-head"><span><h2>나의 봉사</h2><small>다가오는 일정과 신청 현황</small></span><a href="#/mine">내 활동 보기</a></div>
        {hostFirst && hostNext ? <a className="h-next" href={'#/manage/' + hostNext.id}>
          <span className="h-next-top"><span className="m-badge mint">내가 모집</span><span>{dayWord(hostNext.date)}{dDay(hostNext.date) ? ' · ' + dDay(hostNext.date) : ''}</span><MIcon name="chevron" size={18} /></span>
          <strong>{hostNext.title}</strong>
          <small><MIcon name="users" size={16} />확정 {hostNext.confirmed}/{hostNext.capacity}명 · {hostNext.startTime}{(hostNext.pending ?? 0) > 0 ? ` · 승인 대기 ${hostNext.pending}` : ''}</small>
        </a> : next ? <a className="h-next" href={'#/activity/' + next.activityId}>
          <span className="h-next-top"><span className={'m-badge ' + (next.status === 'OFFERED' ? 'hot' : next.status === 'APPLIED' || next.status === 'WAITLISTED' ? 'amber' : 'mint')}>{statusWord[next.status]}</span>
            <span>{dayWord(next.date)}{dDay(next.date) ? ' · ' + dDay(next.date) : ''}</span><MIcon name="chevron" size={18} /></span>
          <strong>{next.title}</strong>
          <small><MIcon name="pin" size={16} />{[next.placeName, next.startTime].filter(Boolean).join(' · ')}</small>
        </a> : justDone ? <a className="h-next" href={'#/write?category=REVIEW&activity=' + justDone.activityId}>
          <span className="h-next-top"><span className="m-badge mint">활동 완료</span><span>후기를 남겨 주세요</span><MIcon name="chevron" size={18} /></span>
          <strong>{justDone.title}</strong>
          <small><MIcon name="edit" size={16} />후기 쓰기</small>
        </a> : <a className="h-none" href="#/find"><span>아직 예정된 활동이 없어요</span><b>봉사 찾기<MIcon name="chevron" size={16} /></b></a>}
        {todos.length > 0 && <ul className="h-todo" aria-label="지금 할 일">{todos.slice(0, 3).map(todo =>
          <li key={todo.key}><a href={todo.href} className={todo.tone === 'hot' ? 'hot' : ''}><MIcon name={todo.icon} size={18} /><span>{todo.text}</span><MIcon name="chevron" size={16} /></a></li>)}</ul>}
      </section>

      <section className="h-sec" aria-label="분야별 봉사">
        <div className="h-head"><h2>어떤 봉사가 끌리나요?</h2><a href="#/find">전체 보기</a></div>
        <nav className="m-cats">{categories.map(c => <a key={c} href={'#/find?category=' + encodeURIComponent(c)}>
          <span className={'m-row-ico f' + categoryTone(c)}><MIcon name={fieldIcon[c] ?? 'sprout'} size={24} /></span>{c}</a>)}</nav>
      </section>

      {weekendPicks.length > 0 && <section className="h-sec" aria-label="이번 주말 봉사">
        <div className="h-head"><h2>이번 주말, 함께해요</h2><a href="#/find?chip=weekend">더 보기</a></div>
        <div className="m-weekend">{weekendPicks.map(a => <a key={a.id} href={'#/activity/' + a.id} className="m-wk">
          <span className="m-wk-cover"><CategoryCover category={a.category} seed={a.id} />{seatsLeft(a) <= 2 && <span className="m-badge amber">{seatsLeft(a)}자리 남음</span>}</span>
          <strong>{a.title}</strong><small>{a.category} · {dayWord(a.date)} {a.startTime}</small></a>)}</div>
      </section>}

      <section className="h-sec" aria-label="나에게 맞는 봉사">
        <div className="h-head"><h2>나에게 맞는 봉사</h2>{mine3.length > 0 && <a href="#/find">전체 보기</a>}</div>
        {!mine3.length ? <div className="h-ask"><span><strong>관심 분야를 설정해 주세요</strong><small>관심 분야에 맞는 동네 모집글과 1365 봉사를 골라 드려요.</small></span><a className="m-btn sm line" href="#/my?view=interests">설정하러 가기</a></div>
          : picks.length || (programs?.length ?? 0) ? <div className="h-list">
            {picks.map(a => <ActivityRow key={a.id} activity={a} note={'관심 분야 · ' + a.category} />)}
            {(programs ?? []).slice(0, 3).map(p => <a key={p.programNo} className="m-row" href={'#/find?chip=1365&category=' + encodeURIComponent(p.category ?? '')}>
              <span className={'m-row-ico ' + (p.category && categoryTone(p.category) ? 'f' + categoryTone(p.category) : 'p')}><MIcon name={(p.category && fieldIcon[p.category]) || 'flag'} size={21} /></span>
              <span className="m-row-main"><strong>{p.title}</strong><small>{[p.distanceKm != null ? p.distanceKm + 'km' : null, p.category, p.organization].filter(Boolean).join(' · ')}</small></span>
              <span className="m-badge blue">1365</span></a>)}</div>
          : <a className="h-none" href="#/my?view=interests"><span>관심 분야({mine3.join(', ')}) 활동이 아직 없어요</span><b>바꾸기<MIcon name="chevron" size={16} /></b></a>}
      </section>

      <section className="h-sec" aria-label="봉사 이야기">
        <div className="h-head"><h2>이웃들의 봉사 이야기</h2><a href="#/community">커뮤니티</a></div>
        {reviews.length === 0 ? <a href="#/community" className="h-none"><span>아직 올라온 후기가 없어요</span><b>첫 이야기 남기기<MIcon name="chevron" size={16} /></b></a>
          : <div className="h-stories">{reviews.map(r => <a key={r.id} href={'#/post/' + r.id} className="h-story">
            <span className="h-story-top"><span className="m-badge gray">봉사후기</span><small>{ago(r.createdAt)}</small></span>
            <strong>{r.title}</strong>
            {r.preview && <span className="h-story-text">{r.preview}</span>}
            <span className="h-story-meta"><span><MIcon name="heart" size={15} />{r.likes}</span><span><MIcon name="chat" size={15} />{r.comments}</span>{r.verified && <span className="ok"><MIcon name="check" size={14} />참여 확인</span>}</span>
          </a>)}</div>}
      </section>
    </div>
  </div>
}

const statusWord: Record<string, string> = { APPLIED: '승인 대기', CONFIRMED: '참여 확정', WAITLISTED: '대기 중', OFFERED: '자리 제안', CHECKED_IN: '출석 완료' }
