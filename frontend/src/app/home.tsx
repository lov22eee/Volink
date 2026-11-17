// 홈 (2026-11-22 개편, user decision): greeting, 오늘 카드 (my next activity · the one I run · a review to write · how to
// start), things to do now (휴대폰 인증 first), four shortcuts, 나에게 맞는 봉사 (Volink + 1365 side by side), 곧 마감,
// 이웃 이야기, and my record in one line. The big review photo moved down to 이웃 이야기.
import { hostedRecords } from './mine'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, serverUrl } from '../api'
import type { LiveActivity, MyParticipation, MyRecord, User } from '../api'
import { categories } from '../categories'
import { CategoryPhoto } from '../covers'
import type { Program } from '../explore'
import { currentPosition, remembered } from '../location'
import type { PostSummary } from './community'
import { phaseOf, useNow } from '../checkin'
import { isNewcomer, seatsLeft, startsAt } from './cards'
import { dayWord, Loading, MIcon, TopBar } from './ui'
import { ActivitySheet } from './detail'
import { ProgramSheet } from './find'
import { ProofSheet } from './proof'
import type { MIconName } from './ui'
import { phoneLine, usePhoneStatus } from './phone'

type Todo = { key: string; icon: MIconName; text: string; href: string; tone?: 'hot' | 'ok' }
const ACTIVE = ['APPLIED', 'CONFIRMED', 'WAITLISTED', 'OFFERED', 'CHECKED_IN']

export function HomeScreen({ user, actions }: { user: User; actions: ReactNode }) {
  const now = useNow(30_000)
  const phone = usePhoneStatus()
  const [mine, setMine] = useState<MyParticipation[] | null>(null)
  const [hosted, setHosted] = useState<LiveActivity[] | null>(null)
  const [open, setOpen] = useState<LiveActivity[] | null>(null)
  const [records, setRecords] = useState<MyRecord[] | null>(null)
  const [allReviews, setAllReviews] = useState<PostSummary[]>([])
  const [programs, setPrograms] = useState<Program[] | null>(null)
  // 2026-11-11: a recommended post opens over 홈 (Volink → summary sheet, 1365 → the 1365 sheet), not the 찾기 list.
  const [peek, setPeek] = useState<{ activity?: LiveActivity; program?: Program } | null>(null)
  const closePeek = useCallback(() => setPeek(null), [])
  const [proof, setProof] = useState(false)
  const peekActivity = (a: LiveActivity) => (event: { preventDefault: () => void }) => { event.preventDefault(); setPeek({ activity: a }) }
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
    api<PostSummary[]>('/api/community/posts?category=REVIEW&sort=latest').then(setAllReviews).catch(() => setAllReviews([]))
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
  // 1인 1계정 (V42): the phone line first while it is needed.
  const askPhone = phoneLine(phone)
  if (askPhone) todos.push({ key: 'phone', icon: 'phone', tone: phone?.required ? 'hot' : undefined, text: askPhone.short, href: '#/phone?next=' + encodeURIComponent('#/home') })
  for (const p of joined) {
    if (p.status === 'OFFERED') todos.push({ key: 'o' + p.id, icon: 'bolt', tone: 'hot', text: `빈자리 제안이 왔어요 · ${p.title}`, href: '#/activity/' + p.activityId })
    if (p.status === 'CONFIRMED' && phaseOf(p.date, p.startTime, p.durationMinutes ?? 90, now, Boolean(p.checkinOpen)).phase === 'open') todos.push({ key: 'c' + p.id, icon: 'qr', tone: 'hot', text: `출석이 시작됐어요 · ${p.title}`, href: '#/activity/' + p.activityId + '?scan=1' })
  }
  for (const a of running) {
    const phase = phaseOf(a.date, a.startTime, a.durationMinutes, now, Boolean(a.checkinOpenedAt)).phase
    if (phase === 'wait') todos.push({ key: 'q' + a.id, icon: 'qr', tone: 'hot', text: `출석을 시작할 수 있어요 · ${a.title}`, href: '#/manage/' + a.id + '?tab=attendance' })
    // 2026-11-08: by the time and by who is here — 진행 중 n/m, 모두 출석 (green, no QR prompt), after the QR window only who is missing.
    const expected = a.confirmed ?? 0, here = Math.min(expected, a.checkedIn ?? 0), missing = expected - here
    if (phase === 'open') todos.push(expected > 0 && missing === 0
      ? { key: 'q' + a.id, icon: 'checkCircle', tone: 'ok', text: `모두 출석했어요 · ${here}/${expected}명 · ${a.title}`, href: '#/manage/' + a.id + '?tab=attendance' }
      : { key: 'q' + a.id, icon: 'qr', tone: 'hot', text: `출석 진행 중 · ${here}/${expected}명 · ${a.title}`, href: '#/manage/' + a.id + '?tab=attendance' })
    else if (phase === 'late' && missing > 0) todos.push({ key: 'q' + a.id, icon: 'alert', tone: 'hot', text: `QR 출석 마감 · 미출석 ${missing}명 · ${a.title}`, href: '#/manage/' + a.id + '?tab=attendance' })
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
  // 나에게 맞는 봉사 = my 관심 분야: neighbourhood posts in those fields (soonest first, newcomer-friendly first on ties)
  // and 1365 programs near me in the same fields. No interests yet → a card asking to choose them.
  const mine3 = user.interests
  const picks = mine3.length ? others.filter(a => mine3.includes(a.category) && !urgentIds.has(a.id)).sort((a, b) => startsAt(a) - startsAt(b) || Number(isNewcomer(b)) - Number(isNewcomer(a))).slice(0, 3) : []
  const valid = (records ?? []).filter(r => r.status === 'VALID')
  // Activities I ran count too (2026-11-08, personal members): finished with at least one completed participant.
  const led = user.memberType === 'INSTITUTION' ? [] : hostedRecords(hosted)
  const done = [...valid, ...led]
  const hours = Math.round(done.reduce((sum, r) => sum + r.durationMinutes, 0) / 6) / 10
  const month = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7)
  const thisMonth = done.filter(r => r.date.startsWith(month)).length
  // A Volink activity finished in the last 7 days that I have not reviewed yet (my reviews are among the latest 50).
  const reviewed = new Set(allReviews.filter(r => r.mine && r.activityId).map(r => r.activityId))
  const weekAgo = new Date(now + 9 * 3_600_000 - 7 * 86_400_000).toISOString().slice(0, 10)
  const justDone = valid.filter(r => r.date >= weekAgo && !reviewed.has(r.activityId)).sort((a, b) => b.date.localeCompare(a.date))[0]

  const today = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Seoul' }).format(new Date(now))
  const seats = (a: LiveActivity) => seatsLeft(a) <= 2 ? `${seatsLeft(a)}자리 남음` : '모집 중'
  // 나에게 맞는 봉사 (관심 분야) or, without interests, this week's neighbourhood posts; 1365 programs fill in so it is not empty.
  const weekPicks = others.filter(a => !urgentIds.has(a.id)).sort((a, b) => startsAt(a) - startsAt(b)).slice(0, 4)
  const suits = mine3.length ? picks : weekPicks
  const stories = allReviews.slice(0, 6)
  const first = !next && !hostNext && done.length === 0
  const hello = next || hostNext ? '이번 주도 함께해요' : done.length ? '오늘도 작은 변화를 만들어 볼까요?' : '첫 봉사를 시작해 볼까요?'

  return <div className="m-screen m-home-b">
    <TopBar brand actions={actions} />
    <div className="m-body hb">
      <header className="hb-hello"><p>{today}</p><h1>{user.name}님, {hello}</h1></header>

      <TodayCard next={next} hostNext={hostNext} done={justDone} first={first} now={now} />
      {todos.length > 0 && <ul className="hb-todo hb-todo-box" aria-label="지금 할 일">{todos.slice(0, 3).map(todo =>
        <li key={todo.key}><a href={todo.href} className={todo.tone ?? ''}><MIcon name={todo.icon} size={18} /><span>{todo.text}</span><MIcon name="chevron" size={16} /></a></li>)}</ul>}

      <nav className="hb-quick" aria-label="바로가기">
        <a href="#/find?chip=near"><i className="g"><MIcon name="pin" size={22} /></i>내 주변</a>
        <a href="#/host"><i className="o"><MIcon name="plus" size={22} /></i>봉사 열기</a>
        {user.memberType !== 'INSTITUTION' && <button type="button" onClick={() => setProof(true)}><i className="p"><MIcon name="docPlus" size={22} /></i>기록 넣기</button>}
        <a href="#/lab1365"><i className="b"><MIcon name="refresh" size={22} /></i>1365</a>
      </nav>

      <Sec title={mine3.length ? '나에게 맞는 봉사' : '이번 주 동네 봉사'} note={mine3.length ? mine3.join(' · ') : undefined} more={['더 보기', mine3.length ? '#/find?category=' + encodeURIComponent(mine3[0]) : '#/find']}>
        {suits.length || (programs?.length ?? 0) ? <div className="hb-weekend">
          {suits.map(a => <a key={a.id} href={'#/activity/' + a.id} onClick={peekActivity(a)}>
            <span className="hb-pic"><CategoryPhoto category={a.category} seed={a.id} /></span>
            <small>{a.category} · {dayWord(a.date)} {a.startTime}</small><b>{a.title}</b><em className={seatsLeft(a) <= 2 ? 'hot' : ''}>{seats(a)}</em></a>)}
          {(programs ?? []).slice(0, 3).map(p => <a key={p.programNo} href={'#/find?chip=1365&category=' + encodeURIComponent(p.category ?? '')} onClick={event => { event.preventDefault(); setPeek({ program: p }) }}>
            <span className="hb-pic"><CategoryPhoto category={p.category ?? '지역사회'} seed={Number(p.programNo) || 1} /></span>
            <small>{p.category ?? '봉사'} · <i className="hb-1365">1365</i></small><b>{p.title}</b><small>{[p.distanceKm != null ? p.distanceKm + 'km' : null, p.organization].filter(Boolean).join(' · ')}</small></a>)}
        </div> : <p className="hb-empty">{mine3.length ? `관심 분야(${mine3.join(', ')}) 모집이 아직 없어요` : '이번 주 동네 모집이 아직 없어요'}</p>}
        {!mine3.length && <div className="hb-interest"><span>관심 분야를 고르면 맞는 봉사를 먼저 보여 드려요</span>
          <div className="m-chips wrap">{categories.map(c => <a key={c} className="m-chip" href="#/my?view=interests">{c}</a>)}</div></div>}
      </Sec>

      {urgent.length > 0 && <Sec title="곧 마감" note="48시간 안" more={['전체', '#/find']}>
        <ul className="hb-list">{urgent.map(a => <li key={a.id}><a href={'#/activity/' + a.id} onClick={peekActivity(a)}>
          <span><small>{a.category}</small><b>{a.title}</b><small>{dayWord(a.date)} {a.startTime} · {a.placeName}</small></span><em className={seatsLeft(a) <= 2 ? 'hot' : ''}>{seats(a)}</em></a></li>)}</ul>
      </Sec>}

      <Sec title="이웃 이야기" more={['커뮤니티', '#/community']}>
        {stories.length ? <div className="hb-weekend hb-stories">{stories.map(r => <a key={r.id} href={'#/post/' + r.id}>
          {/* the first photo the writer put up; the field picture only when there is none (2026-11-22) */}
          <span className="hb-pic">{r.photo ? <img className="cover" src={serverUrl(r.photo)} alt="" loading="lazy" /> : <CategoryPhoto category={r.activityCategory ?? '지역사회'} seed={r.id} />}</span>
          <b>{r.title}</b><small>{r.author} · ♡ {r.likes}</small></a>)}</div>
          : <p className="hb-empty">봉사를 마치면 첫 이야기의 주인공이 되어 보세요</p>}
      </Sec>

      {!first && <a className="hb-foot" href={done.length ? '#/records' : '#/my'}>
        <span><b>{records ? done.length + '회' : '–'}</b><small>완료한 활동</small></span>
        <span><b>{records ? hours + 'h' : '–'}</b><small>참여 시간</small></span>
        <span><b>{records ? thisMonth + '회' : '–'}</b><small>이번 달</small></span>
        <MIcon name="chevron" size={18} /></a>}
      {!first && <p className="hb-fine">Volink 활동 기록 기준 · 공식 1365 실적이 아니에요</p>}
    </div>
    {peek?.activity && <ActivitySheet activity={peek.activity} onClose={closePeek} />}
    {peek?.program && <ProgramSheet program={peek.program} onClose={closePeek} />}
    {proof && <ProofSheet onClose={() => setProof(false)} onSaved={saved => { setProof(false); window.location.hash = '#/record/' + saved.id }} />}
  </div>
}

function Sec({ title, note, more, children }: { title: string; note?: string; more?: [string, string]; children: ReactNode }) {
  return <section className="hb-sec" aria-label={title}>
    <div className="hb-head"><h2>{title}{note && <small>{note}</small>}</h2>{more && <a href={more[1]}>{more[0]}</a>}</div>
    {children}
  </section>
}

const statusWord: Record<string, string> = { APPLIED: '승인 대기', CONFIRMED: '참여 확정', WAITLISTED: '대기 중', OFFERED: '자리 제안', CHECKED_IN: '출석 완료' }
const weekday = (date: string) => new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(date + 'T12:00:00+09:00'))

/**
 * 오늘 카드 (2026-11-22, user decision): the one thing that matters now, on top — my next activity (D-day, where, and
 * 출석하기 when attendance is open), the activity I run, a finished one to review, or how a first activity goes.
 */
function TodayCard({ next, hostNext, done, first, now }: { next?: MyParticipation; hostNext?: LiveActivity; done?: MyRecord; first: boolean; now: number }) {
  const dday = (date: string) => {
    const days = Math.round((new Date(date + 'T00:00:00+09:00').getTime() - new Date(new Date(now + 9 * 3_600_000).toISOString().slice(0, 10) + 'T00:00:00+09:00').getTime()) / 86_400_000)
    return days <= 0 ? '오늘' : days === 1 ? '내일' : 'D-' + days
  }
  const when = (date: string, time: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일(${weekday(date)}) ${time}`
  if (next) {
    const open = next.status === 'CONFIRMED' && phaseOf(next.date, next.startTime, next.durationMinutes ?? 90, now, Boolean(next.checkinOpen)).phase === 'open'
    return <section className="hb-today" aria-label="나의 다음 봉사">
      <span className="hb-dd">{dday(next.date)}</span><i className={'hb-st ' + (next.status === 'OFFERED' ? 'hot' : next.status === 'CONFIRMED' || next.status === 'CHECKED_IN' ? '' : 'wait')}>{statusWord[next.status]}</i>
      <b>{next.title}</b><small>{when(next.date, next.startTime)}{next.placeName ? ' · ' + next.placeName : ''}</small>
      <div className="hb-acts">{open ? <a className="on" href={'#/activity/' + next.activityId + '?scan=1'}><MIcon name="qr" size={17} />출석하기</a>
        : <>{next.status === 'CONFIRMED' && <a href={'#/news/' + next.activityId}>소식</a>}<a className="on" href={'#/activity/' + next.activityId}>상세 보기</a></>}</div>
    </section>
  }
  if (hostNext) return <section className="hb-today" aria-label="내가 모집하는 봉사">
    <span className="hb-dd">{dday(hostNext.date)}</span><i className="hb-st">내가 모집</i>
    <b>{hostNext.title}</b><small>{when(hostNext.date, hostNext.startTime)} · 확정 {hostNext.confirmed}/{hostNext.capacity}명</small>
    <div className="hb-acts"><a href={'#/news/' + hostNext.id}>소식</a><a className="on" href={'#/manage/' + hostNext.id}>모집 관리</a></div>
  </section>
  if (done) return <section className="hb-today soft" aria-label="후기 남기기">
    <span className="hb-dd">완료</span><b>{done.title}</b><small>{when(done.date, done.startTime ?? '')} · 수고하셨어요</small>
    <div className="hb-acts"><a className="on" href={'#/write?category=REVIEW&activity=' + done.activityId}><MIcon name="edit" size={16} />후기 남기기</a></div>
  </section>
  if (first) return <section className="hb-first" aria-label="첫 봉사 안내">
    <b>3단계면 첫 봉사 끝</b><p>가까운 봉사를 찾아 신청하고 현장에서 QR로 출석해요</p>
    <ol><li><b>1 찾기</b>내 주변 모집</li><li><b>2 신청</b>모집자 승인</li><li><b>3 출석</b>QR 찍기</li></ol>
    <a className="m-btn" href="#/find?chip=near">내 주변 봉사 보기</a>
  </section>
  return <section className="hb-first" aria-label="다음 봉사">
    <b>예정된 봉사가 없어요</b><p>이번 주 동네 봉사를 찾아보거나 직접 열어 보세요</p>
    <span className="hb-two"><a className="m-btn" href="#/find">봉사 찾기</a><a className="m-btn line" href="#/host"><MIcon name="plus" size={18} />활동 만들기</a></span>
  </section>
}
