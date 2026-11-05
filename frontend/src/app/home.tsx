// 홈: greeting, things to do now, my next activity, categories, my record, this weekend, suits me, urgent, reviews.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { LiveActivity, MyParticipation, MyRecord, User } from '../api'
import { categories, categoryTone } from '../categories'
import { CategoryCover } from '../covers'
import { range } from '../explore'
import type { Program } from '../explore'
import { currentPosition, remembered } from '../location'
import type { PostSummary } from './community'
import { phaseOf, useNow } from '../checkin'
import { ActivityRow, fieldIcon, isNewcomer, seatsLeft, startsAt } from './cards'
import { dayWord, dDay, Empty, Loading, MIcon, TopBar } from './ui'
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
  const urgent = others.filter(a => startsAt(a) - now < 48 * 3_600_000).slice(0, 3)
  const urgentIds = new Set(urgent.map(a => a.id))
  // This weekend (Korean dates), shown as its own row: not repeated below.
  const weekend = range('weekend')
  const weekendPicks = others.filter(a => !urgentIds.has(a.id) && weekend.from && weekend.to && a.date >= weekend.from && a.date <= weekend.to).slice(0, 6)
  // 나에게 맞는 봉사 = my 관심 분야: neighbourhood posts in those fields (soonest first, newcomer-friendly first on ties)
  // and 1365 programs near me in the same fields. No interests yet → a card asking to choose them.
  const mine3 = user.interests
  const picks = mine3.length ? others.filter(a => mine3.includes(a.category)).sort((a, b) => startsAt(a) - startsAt(b) || Number(isNewcomer(b)) - Number(isNewcomer(a))).slice(0, 3) : []
  const valid = (records ?? []).filter(r => r.status === 'VALID')
  const hours = Math.round(valid.reduce((sum, r) => sum + r.durationMinutes, 0) / 6) / 10
  const month = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7)
  const thisMonth = valid.filter(r => r.date.startsWith(month)).length
  // A Volink activity finished in the last 7 days that I have not reviewed yet (my reviews are among the latest 50).
  const reviewed = new Set(allReviews.filter(r => r.mine && r.activityId).map(r => r.activityId))
  const weekAgo = new Date(now + 9 * 3_600_000 - 7 * 86_400_000).toISOString().slice(0, 10)
  const justDone = valid.filter(r => r.date >= weekAgo && !reviewed.has(r.activityId)).sort((a, b) => b.date.localeCompare(a.date))[0]

  return <div className="m-screen">
    <TopBar brand actions={actions} />
    <div className="m-body">
      <div className="m-hello"><p>{user.name}님, 반가워요</p><h1>작은 참여가 큰 변화를 만들어요</h1></div>

      {todos.length > 0 && <section className="m-todo" aria-label="지금 할 일">{todos.slice(0, 4).map(todo =>
        <a key={todo.key} href={todo.href} className={'m-todo-item' + (todo.tone === 'hot' ? ' hot' : '')}><MIcon name={todo.icon} size={20} /><span>{todo.text}</span><MIcon name="chevron" size={17} /></a>)}</section>}

      <MainCard next={next} hostNext={hostNext} done={justDone} />

      <section className="m-section" aria-label="분야별 봉사">
        <div className="m-section-head"><h2>어떤 봉사에 관심 있나요?</h2><a href="#/find">전체 보기</a></div>
        <nav className="m-cats">{categories.map(c => <a key={c} href={'#/find?category=' + encodeURIComponent(c)}>
          <span className={'m-row-ico f' + categoryTone(c)}><MIcon name={fieldIcon[c] ?? 'sprout'} size={24} /></span>{c}</a>)}</nav>
      </section>

      <a className="m-steps" href="#/mine?tab=done" aria-label="나의 봉사 발자취">
        <span className="m-steps-head"><b>나의 봉사 발자취</b><MIcon name="chevron" size={18} /></span>
        {records && valid.length === 0 ? <span className="m-steps-empty">첫 봉사를 기다리고 있어요</span>
          : <span className="m-steps-nums"><span><b>{records ? valid.length : '–'}회</b><small>완료한 활동</small></span><span><b>{records ? hours : '–'}h</b><small>참여 시간</small></span><span><b>{records ? thisMonth : '–'}회</b><small>이번 달</small></span></span>}
        <small className="m-steps-note">Volink 활동 기록 기준 · 공식 1365 실적이 아니에요</small>
      </a>

      {weekendPicks.length > 0 && <section className="m-section" aria-label="이번 주말 봉사">
        <div className="m-section-head"><h2>이번 주말, 함께해요</h2><a href="#/find?chip=weekend">더보기</a></div>
        <div className="m-weekend">{weekendPicks.map(a => <a key={a.id} href={'#/activity/' + a.id} className="m-wk">
          <span className="m-wk-cover"><CategoryCover category={a.category} seed={a.id} /></span>
          <span className="m-wk-main"><span className={'m-badge ' + (seatsLeft(a) <= 2 ? 'amber' : 'mint')}>{seatsLeft(a) <= 2 ? `${seatsLeft(a)}자리 남음` : '모집 중'}</span>
            <strong>{a.title}</strong><small>{dayWord(a.date)} {a.startTime} · {a.category}</small></span></a>)}</div>
      </section>}

      <section className="m-section" aria-label="나에게 맞는 봉사">
        <div className="m-section-head"><h2>나에게 맞는 봉사</h2><a href="#/find">전체 보기</a></div>
        {!mine3.length ? <div className="m-interest-ask"><span className="m-interest-text"><MIcon name="heart" size={22} /><strong>관심 분야를 설정해 주세요</strong>
          <span>관심 분야에 맞는 동네 모집글과 1365 봉사를 골라 드려요.</span></span><a className="m-btn sm" href="#/my?view=interests">설정하러 가기</a></div>
          : picks.length || (programs?.length ?? 0) ? <div className="m-list">
            {picks.map(a => <ActivityRow key={a.id} activity={a} note={'관심 분야 · ' + a.category} />)}
            {(programs ?? []).slice(0, 3).map(p => <a key={p.programNo} className="m-row" href={'#/find?chip=1365&category=' + encodeURIComponent(p.category ?? '')}>
              <span className={'m-row-ico ' + (p.category && categoryTone(p.category) ? 'f' + categoryTone(p.category) : 'p')}><MIcon name={(p.category && fieldIcon[p.category]) || 'flag'} size={21} /></span>
              <span className="m-row-main"><strong>{p.title}</strong><small>{[p.distanceKm != null ? p.distanceKm + 'km' : null, p.category, p.organization].filter(Boolean).join(' · ')}</small></span>
              <span className="m-badge blue">1365</span></a>)}</div>
          : <Empty icon="sprout" title={'관심 분야(' + mine3.join(', ') + ') 활동이 아직 없어요'} text="새 활동이 올라오면 여기에 보여 드릴게요." action={<a className="m-btn sm line" href="#/my?view=interests">관심 분야 바꾸기</a>} />}
      </section>

      {urgent.length > 0 && <section className="m-section" aria-label="긴급 모집">
        <div className="m-section-head"><h2>지금 도움이 필요해요</h2><small>48시간 안에 시작해요</small></div>
        <div className="m-list">{urgent.map(a => <ActivityRow key={a.id} activity={a} />)}</div>
      </section>}

      <section className="m-section" aria-label="봉사 이야기">
        <div className="m-section-head"><h2>우리들의 봉사 이야기</h2><a href="#/community">커뮤니티</a></div>
        {reviews.length === 0 ? <a href="#/community" className="m-review">
          <strong>아직 올라온 후기가 없어요</strong>
          <span>봉사를 마치면 첫 이야기를 남겨 주세요.</span>
        </a> : <div className="m-list">{reviews.map(r => <a key={r.id} href={'#/post/' + r.id} className="m-review">
          <small>{r.author} · {r.createdAt.slice(5, 10).replace('-', '/')}</small>
          <strong>{r.title}</strong>
          {r.preview && <span>{r.preview}</span>}
          {r.activityTitle && <em><MIcon name="check" size={13} />{r.activityTitle}{r.verified ? ' · 참여 확인' : ''}</em>}
        </a>)}</div>}
      </section>
    </div>
  </div>
}

const statusWord: Record<string, string> = { APPLIED: '승인 대기', CONFIRMED: '참여 확정', WAITLISTED: '대기 중', OFFERED: '자리 제안', CHECKED_IN: '출석 완료' }

/**
 * The main card changes with where the person is: applied (waiting) → offered → confirmed → just finished → hosting →
 * nothing yet. One card, one main action.
 */
function MainCard({ next, hostNext, done }: { next?: MyParticipation; hostNext?: LiveActivity; done?: MyRecord }) {
  if (next) {
    const waiting = next.status === 'APPLIED' || next.status === 'WAITLISTED'
    const offered = next.status === 'OFFERED'
    const tone = offered ? ' hot' : waiting ? ' wait' : ''
    return <section className={'m-hero' + tone} aria-label="나의 다음 봉사">
      <div className="m-hero-top"><span>{waiting ? '신청한 봉사가 있어요' : offered ? '빈자리가 났어요' : '다가오는 나의 봉사'}</span>
        <b className={'m-hero-state' + tone}>{statusWord[next.status]}{!waiting && !offered && dDay(next.date) ? ' · ' + dDay(next.date) : ''}</b></div>
      <h2>{next.title}</h2>
      <p>{dayWord(next.date)} {next.startTime}{next.placeName ? ' · ' + next.placeName : ''}</p>
      <p className="m-hero-sub">{waiting ? (next.status === 'APPLIED' ? '모집자가 확정하면 알림으로 알려 드려요.' : '자리가 나면 순서대로 알려 드려요.')
        : offered ? '정해진 시간 안에 수락하면 참여가 확정돼요.' : '일정·장소·모집자 공지를 한눈에 확인하세요.'}</p>
      <a className="m-btn" href={'#/activity/' + next.activityId}>{offered ? '자리 제안 확인하기' : waiting ? '내 신청 보기' : '활동 일정 확인'}</a>
    </section>
  }
  if (done) return <section className="m-hero" aria-label="봉사 완료">
    <div className="m-hero-top"><span>봉사 완료!</span><b className="m-hero-state">활동 완료</b></div>
    <h2>오늘도 따뜻한 변화를 만들었어요</h2>
    <p>{done.title}</p>
    <p className="m-hero-sub">활동 후기를 남기고 다음 봉사도 찾아보세요.</p>
    <div className="m-hero-pair"><a className="m-btn" href={'#/write?category=REVIEW&activity=' + done.activityId}>후기 작성</a>
      <a className="m-btn line" href="#/mine?tab=done">내 활동 보기</a></div>
  </section>
  if (hostNext) return <section className="m-hero" aria-label="내가 모집 중인 활동">
    <div className="m-hero-top"><span>내가 모집 중</span>{dDay(hostNext.date) && <b className="m-hero-state">{dDay(hostNext.date)}</b>}</div>
    <h2>{hostNext.title}</h2>
    <p>{dayWord(hostNext.date)} {hostNext.startTime} · 확정 {hostNext.confirmed}/{hostNext.capacity}명</p>
    <a className="m-btn" href={'#/manage/' + hostNext.id}>모집 관리하기</a>
  </section>
  return <section className="m-hero" aria-label="나의 다음 봉사">
    <div className="m-hero-top"><span>나의 다음 봉사</span><MIcon name="calendar" size={22} /></div>
    <h2>아직 예정된 활동이 없어요</h2>
    <p className="m-hero-sub">가까운 곳에서 첫 봉사를 찾아볼까요?</p>
    <div className="m-hero-row"><a className="m-btn" href="#/find">봉사 찾아보기</a>
      <a className="m-btn line m-hero-plus" href="#/host" aria-label="활동 만들기"><MIcon name="plus" size={22} /></a></div>
  </section>
}
