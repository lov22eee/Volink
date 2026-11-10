// 홈 (2026-11-06, B안): date and greeting, the latest review over its field photo, my next activity in one line (+ things
// to do now), urgent, this weekend, suits me, categories, 봉사 앨범 (reviews), my record. Space and lines, few boxes.
import { hostedRecords } from './mine'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { LiveActivity, MyParticipation, MyRecord, User } from '../api'
import { categories, categoryTone } from '../categories'
import { CategoryPhoto } from '../covers'
import { range } from '../explore'
import type { Program } from '../explore'
import { currentPosition, remembered } from '../location'
import type { PostSummary } from './community'
import { phaseOf, useNow } from '../checkin'
import { fieldIcon, isNewcomer, seatsLeft, startsAt } from './cards'
import { dayWord, Loading, MIcon, TopBar } from './ui'
import { ActivitySheet } from './detail'
import { ProgramSheet } from './find'
import type { MIconName } from './ui'

type Todo = { key: string; icon: MIconName; text: string; href: string; tone?: 'hot' | 'ok' }
const ACTIVE = ['APPLIED', 'CONFIRMED', 'WAITLISTED', 'OFFERED', 'CHECKED_IN']

export function HomeScreen({ user, actions }: { user: User; actions: ReactNode }) {
  const now = useNow(30_000)
  const [mine, setMine] = useState<MyParticipation[] | null>(null)
  const [hosted, setHosted] = useState<LiveActivity[] | null>(null)
  const [open, setOpen] = useState<LiveActivity[] | null>(null)
  const [records, setRecords] = useState<MyRecord[] | null>(null)
  const [allReviews, setAllReviews] = useState<PostSummary[]>([])
  const [programs, setPrograms] = useState<Program[] | null>(null)
  // 2026-11-11: a recommended post opens over 홈 (Volink → summary sheet, 1365 → the 1365 sheet), not the 찾기 list.
  const [peek, setPeek] = useState<{ activity?: LiveActivity; program?: Program } | null>(null)
  const closePeek = useCallback(() => setPeek(null), [])
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
  // This weekend (Korean dates), shown as its own row: not repeated below.
  const weekend = range('weekend')
  const weekendPicks = others.filter(a => !urgentIds.has(a.id) && weekend.from && weekend.to && a.date >= weekend.from && a.date <= weekend.to).slice(0, 6)
  // 나에게 맞는 봉사 = my 관심 분야: neighbourhood posts in those fields (soonest first, newcomer-friendly first on ties)
  // and 1365 programs near me in the same fields. No interests yet → a card asking to choose them.
  const mine3 = user.interests
  const picks = mine3.length ? others.filter(a => mine3.includes(a.category)).sort((a, b) => startsAt(a) - startsAt(b) || Number(isNewcomer(b)) - Number(isNewcomer(a))).slice(0, 3) : []
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

  const featured = allReviews[0]
  const album = allReviews.slice(featured ? 1 : 0, (featured ? 1 : 0) + 4)
  const today = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Seoul' }).format(new Date(now))
  const seats = (a: LiveActivity) => seatsLeft(a) <= 2 ? `${seatsLeft(a)}자리 남음` : '모집 중'

  return <div className="m-screen m-home-b">
    <TopBar brand actions={actions} />
    <div className="m-body hb">
      <header className="hb-hello"><p>{today}</p><h1>{user.name}님,<br />{next || hostNext || valid.length ? '오늘도 작은 변화를 만들어 볼까요?' : '첫 봉사를 시작해 볼까요?'}</h1></header>

      {/* 대표 봉사 이야기: the latest review (real), over its field photo. */}
      <a className="hb-feature" href={featured ? '#/post/' + featured.id : '#/community'} aria-label="대표 봉사 이야기">
        <CategoryPhoto category={featured?.activityCategory ?? '지역사회'} seed={featured?.id ?? 1} />
        <span className="hb-over"><em>이웃들의 봉사 이야기</em>
          {featured ? <><b>{featured.title}</b><small>{featured.author} · ♡ {featured.likes}{featured.activityTitle ? ' · ' + featured.activityTitle : ''}</small></>
            : <><b>아직 올라온 이야기가 없어요</b><small>봉사를 마치면 첫 이야기의 주인공이 되어 보세요</small></>}</span>
      </a>

      <Sec title="나의 다음 봉사" more={next || hostNext ? ['내 활동', '#/mine'] : undefined}>
        <NextLine next={next} hostNext={hostNext} done={justDone} />
        {todos.length > 0 && <ul className="hb-todo" aria-label="지금 할 일">{todos.slice(0, 3).map(todo =>
          <li key={todo.key}><a href={todo.href} className={todo.tone ?? ''}><MIcon name={todo.icon} size={18} /><span>{todo.text}</span><MIcon name="chevron" size={16} /></a></li>)}</ul>}
      </Sec>

      {urgent.length > 0 && <Sec title="지금 도움이 필요해요" note="48시간 안" more={['전체 보기', '#/find']}>
        <ul className="hb-list">{urgent.map(a => <li key={a.id}><a href={'#/activity/' + a.id} onClick={peekActivity(a)}>
          <span><small>{a.category}</small><b>{a.title}</b><small>{dayWord(a.date)} {a.startTime} · {a.placeName}</small></span><em className={seatsLeft(a) <= 2 ? 'hot' : ''}>{seats(a)}</em></a></li>)}</ul>
      </Sec>}

      {weekendPicks.length > 0 && <Sec title="이번 주말, 함께해요" more={['더 보기', '#/find?chip=weekend']}>
        <div className="hb-weekend">{weekendPicks.map(a => <a key={a.id} href={'#/activity/' + a.id} onClick={peekActivity(a)}>
          <span className="hb-pic"><CategoryPhoto category={a.category} seed={a.id} /></span>
          <b>{a.title}</b><small>{dayWord(a.date)} {a.startTime} · {a.category}</small><em className={seatsLeft(a) <= 2 ? 'hot' : ''}>{seats(a)}</em></a>)}</div>
      </Sec>}

      <Sec title="나에게 맞는 봉사" more={mine3.length ? ['관심 분야', '#/my?view=interests'] : undefined}>
        {!mine3.length ? <a className="hb-line" href="#/my?view=interests"><span>관심 분야를 설정하면 맞는 동네 모집과 1365 봉사를 골라 드려요</span><b>설정하러 가기<MIcon name="chevron" size={15} /></b></a>
          : picks.length || (programs?.length ?? 0) ? <ul className="hb-list">
            {picks.map(a => <li key={a.id}><a href={'#/activity/' + a.id} onClick={peekActivity(a)}><span><small>{a.category}</small><b>{a.title}</b><small>{dayWord(a.date)} {a.startTime} · {a.placeName}</small></span><em className={seatsLeft(a) <= 2 ? 'hot' : ''}>{seats(a)}</em></a></li>)}
            {(programs ?? []).slice(0, 3).map(p => <li key={p.programNo}><a href={'#/find?chip=1365&category=' + encodeURIComponent(p.category ?? '')} onClick={event => { event.preventDefault(); setPeek({ program: p }) }}>
              <span><small>{p.category ?? '1365'} · <i className="hb-1365">1365</i></small><b>{p.title}</b><small>{[p.distanceKm != null ? p.distanceKm + 'km' : null, p.organization].filter(Boolean).join(' · ')}</small></span><MIcon name="chevron" size={16} /></a></li>)}</ul>
          : <a className="hb-line" href="#/my?view=interests"><span>관심 분야({mine3.join(', ')}) 활동이 아직 없어요</span><b>바꾸기<MIcon name="chevron" size={15} /></b></a>}
      </Sec>

      <Sec title="어떤 봉사에 관심 있나요?" more={['전체 보기', '#/find']}>
        <nav className="m-cats">{categories.map(c => <a key={c} href={'#/find?category=' + encodeURIComponent(c)}>
          <span className={'m-row-ico f' + categoryTone(c)}><MIcon name={fieldIcon[c] ?? 'sprout'} size={24} /></span>{c}</a>)}</nav>
      </Sec>

      <Sec title="봉사 앨범" more={['커뮤니티', '#/community']}>
        {album.length ? <div className="hb-album">{album.map(r => <a key={r.id} href={'#/post/' + r.id}>
          <span className="hb-pic"><CategoryPhoto category={r.activityCategory ?? '지역사회'} seed={r.id} /></span>
          <b>{r.title}</b><small>{r.author} · ♡ {r.likes}</small></a>)}</div>
          : <p className="hb-empty">{featured ? '다음 봉사 이야기를 기다리고 있어요' : '첫 봉사 이야기를 기다리고 있어요'}</p>}
      </Sec>

      <Sec title="나의 봉사 발자취" more={done.length ? ['전체', '#/records'] : undefined}>
        {records && done.length === 0 ? <p className="hb-empty">첫 봉사를 마치면 여기에 쌓여요</p>
          : <><div className="hb-stats"><div><b>{records ? done.length : '–'}</b><small>완료한 활동</small></div><div><b>{records ? hours + 'h' : '–'}</b><small>참여 시간</small></div><div><b>{records ? thisMonth : '–'}</b><small>이번 달</small></div></div>
            <p className="hb-fine">Volink 활동 기록 기준 · 공식 1365 실적이 아니에요</p></>}
      </Sec>
    </div>
    {peek?.activity && <ActivitySheet activity={peek.activity} onClose={closePeek} />}
    {peek?.program && <ProgramSheet program={peek.program} onClose={closePeek} />}
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

/** 나의 다음 봉사 in one line (date box): applied / offered / confirmed / hosting / just finished / nothing yet. */
function NextLine({ next, hostNext, done }: { next?: MyParticipation; hostNext?: LiveActivity; done?: MyRecord }) {
  const box = (date: string) => <span className="hb-date"><b>{Number(date.slice(8))}</b><small>{weekday(date)}</small></span>
  if (next) {
    const tone = next.status === 'OFFERED' ? 'hot' : next.status === 'APPLIED' || next.status === 'WAITLISTED' ? 'wait' : 'ok'
    return <a className="hb-next" href={'#/activity/' + next.activityId}>{box(next.date)}
      <span><b>{next.title}</b><small><MIcon name="pin" size={14} />{[next.placeName, next.startTime].filter(Boolean).join(' · ')} · <i className={tone}>{statusWord[next.status]}</i></small></span><MIcon name="chevron" size={18} /></a>
  }
  if (hostNext) return <a className="hb-next" href={'#/manage/' + hostNext.id}>{box(hostNext.date)}
    <span><b>{hostNext.title}</b><small><MIcon name="users" size={14} />{hostNext.startTime} · 확정 {hostNext.confirmed}/{hostNext.capacity}명 · <i className="ok">내가 모집</i></small></span><MIcon name="chevron" size={18} /></a>
  if (done) return <a className="hb-next" href={'#/write?category=REVIEW&activity=' + done.activityId}>{box(done.date)}
    <span><b>{done.title}</b><small><MIcon name="edit" size={14} />봉사 완료 · <i className="ok">후기 남기기</i></small></span><MIcon name="chevron" size={18} /></a>
  return <div className="hb-none"><span>아직 예정된 활동이 없어요</span>
    <span className="hb-two"><a className="m-btn" href="#/find">봉사 찾기</a><a className="m-btn line" href="#/host"><MIcon name="plus" size={18} />활동 만들기</a></span></div>
}
