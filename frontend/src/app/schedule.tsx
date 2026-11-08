// 내 활동 › 일정 (2026-11-08): one month calendar of everything ahead and behind, dots by kind, the picked day below.
// 초록 = a Volink activity I joined, 파랑 = a 1365 activity I applied for, 주황 = an activity I opened (나의 모집),
// 회색 = past (done). The chips narrow it to 참여 (Volink + 1365) or 나의 모집.
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LiveActivity, MyParticipation, MyRecord } from '../api'
import type { ExternalRecord } from './record'
import { recordWhen } from './record'
import { dDay, MIcon } from './ui'

export type Kind = 'join' | 'ext' | 'host' | 'past'
export type Plan = { key: string; kind: Kind; mine: boolean; date: string; time: string; title: string; sub: string; chip: string; tone: string; href: string; hostAlert?: string }
type Filter = 'all' | 'join' | 'host'
const FILTER = 'volink.schedule.filter'
const WEEK = ['일', '월', '화', '수', '목', '금', '토']
export const todayKst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
const md = (day: string) => `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일 (${WEEK[new Date(day + 'T12:00:00Z').getUTCDay()]})`
const pad = (n: number) => String(n).padStart(2, '0')

const joinWord: Record<string, [string, string]> = {
  APPLIED: ['승인 대기', 'amber'], CONFIRMED: ['참가 확정', 'mint'], WAITLISTED: ['대기 중', 'amber'], OFFERED: ['자리 제안', 'hot'], CHECKED_IN: ['출석 완료', 'mint'],
}
const LIVE = ['RECRUITING', 'IN_PROGRESS', 'DRAFT']

/** Everything the calendar shows, from what 내 활동 already loads. */
export function plansOf(joined: MyParticipation[], hosted: LiveActivity[], records: MyRecord[], external: ExternalRecord[], now = Date.now()): Plan[] {
  const out: Plan[] = []
  const ends = (date: string, time: string, minutes = 90) => new Date(`${date}T${time}:00+09:00`).getTime() + minutes * 60_000
  const doneIds = new Set(records.map(r => r.activityId))
  for (const p of joined) {
    if (p.activityStatus === 'CANCELLED' || !joinWord[p.status] || doneIds.has(p.activityId)) continue
    const over = ends(p.date, p.startTime, p.durationMinutes) <= now
    if (over && p.status !== 'CHECKED_IN') continue
    const [chip, tone] = p.status === 'WAITLISTED' && p.waitOrder ? [`대기 ${p.waitOrder}번`, 'amber'] : joinWord[p.status]
    out.push({ key: 'p' + p.id, kind: over ? 'past' : 'join', mine: false, date: p.date, time: p.startTime, title: p.title, sub: p.startTime + (p.placeName ? ' · ' + p.placeName : ''), chip, tone, href: '#/activity/' + p.activityId })
  }
  for (const r of records) out.push({ key: 'v' + r.id, kind: 'past', mine: false, date: r.date, time: r.startTime, title: r.title, sub: r.startTime + ' · 활동 완료', chip: r.status === 'VALID' ? '완료' : r.status === 'HELD' ? '보류' : '무효', tone: 'gray', href: '#/activity/' + r.activityId })
  for (const r of external) {
    if (r.status === 'MISSED') continue
    if (r.status === 'ATTENDED') { out.push({ key: 'e' + r.id, kind: 'past', mine: false, date: r.date, time: r.startTime, title: r.title, sub: '1365 · ' + (r.extKind === 'ACTIVITY' ? '활동인증' : '봉사 실적'), chip: '1365', tone: 'gray', href: '#/record/' + r.id }); continue }
    const label = r.labStatus && /승인|대기|완료/.test(r.labStatus) ? '1365 ' + r.labStatus.replace(/\s+/g, '') : '1365 신청'
    out.push({ key: 'e' + r.id, kind: 'ext', mine: false, date: r.date, time: r.timeKnown === false ? '' : r.startTime, title: r.title, sub: recordWhen(r).replace(/^\d{2}\/\d{2}\s·?\s?/, '') + ' · 1365', chip: label, tone: 'blue', href: '#/record/' + r.id })
  }
  for (const a of hosted) {
    if (a.status === 'CANCELLED' || a.status === 'DELETED') continue
    const live = LIVE.includes(a.status)
    const extra = a as LiveActivity & { pending?: number; unanswered?: number }
    const alert = [extra.pending ? `새 신청 ${extra.pending}` : '', extra.unanswered ? `답변할 질문 ${extra.unanswered}` : ''].filter(Boolean).join(' · ')
    out.push({ key: 'h' + a.id, kind: live ? 'host' : 'past', mine: true, date: a.date, time: a.startTime, title: a.title,
      sub: `${a.startTime} · 확정 ${a.confirmed}/${a.capacity}명`, chip: live ? (a.status === 'DRAFT' ? '검토 중' : '모집 관리') : '지난 모집', tone: live ? 'host' : 'gray', href: '#/manage/' + a.id, hostAlert: live ? alert : '' })
  }
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
}

const dotOf: Record<Kind, string> = { join: 'g', ext: 'b', host: 'o', past: 'x' }

/** One card under the calendar: 참여 (green bar), 1365 (blue bar), 나의 모집 (orange card), 지난 (grey). */
function PlanCard({ p, when }: { p: Plan; when?: boolean }) {
  const day = when ? `${Number(p.date.slice(5, 7))}/${Number(p.date.slice(8, 10))} (${WEEK[new Date(p.date + 'T12:00:00Z').getUTCDay()]}) ` : ''
  return <a className={'sc-card ' + p.kind} href={p.href}>
    <span className="sc-bar" aria-hidden="true" />
    <span className="sc-main">{p.kind === 'host' && <em>나의 모집</em>}<strong>{p.title}</strong>
      <small>{day}{p.sub}</small>{p.hostAlert && <small className="sc-alert">{p.hostAlert}</small>}</span>
    <span className={'m-badge ' + (when ? (p.kind === 'ext' ? 'blue' : p.kind === 'host' ? 'host' : 'mint') : p.tone)}>{when ? dDay(p.date) ?? p.chip : p.chip}{p.kind === 'host' && !when ? ' ›' : ''}</span>
  </a>
}

export function Schedule({ plans, empty, after }: { plans: Plan[]; empty: ReactNode; after?: ReactNode }) {
  const today = todayKst()
  const [filter, setFilter] = useState<Filter>(() => { try { const f = localStorage.getItem(FILTER); return f === 'join' || f === 'host' ? f : 'all' } catch { return 'all' } })
  useEffect(() => { try { localStorage.setItem(FILTER, filter) } catch { /* private mode */ } }, [filter])
  const shown = useMemo(() => plans.filter(p => filter === 'all' || (filter === 'host' ? p.mine : !p.mine)), [plans, filter])
  const ahead = shown.filter(p => p.kind !== 'past' && p.date >= today)
  // First view: today when something is on it, else the nearest day ahead, else today.
  const first = shown.some(p => p.date === today) ? today : ahead[0]?.date ?? today
  const [picked, setPicked] = useState<string | null>(null)
  const day = picked ?? first
  const [month, setMonth] = useState<string | null>(null)
  const ym = month ?? day.slice(0, 7)
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7))
  const startDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const byDay = new Map<string, Set<string>>()
  for (const p of shown) { const s = byDay.get(p.date) ?? new Set(); s.add(dotOf[p.kind]); byDay.set(p.date, s) }
  const move = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`) }
  const cells: ReactNode[] = []
  for (let i = 0; i < startDow; i++) cells.push(<span key={'b' + i} />)
  for (let d = 1; d <= days; d++) {
    const iso = `${ym}-${pad(d)}`
    const dots = ['g', 'b', 'o', 'x'].filter(k => byDay.get(iso)?.has(k))
    const dow = (startDow + d - 1) % 7
    cells.push(<button key={iso} type="button" className={'sc-day' + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '') + (iso === today ? ' today' : '') + (iso === day ? ' on' : '')}
      aria-pressed={iso === day} aria-label={md(iso) + (dots.length ? ' · 일정 있음' : '')} onClick={() => setPicked(iso)}>
      <span>{d}</span><i aria-hidden="true">{dots.map(k => <b key={k} className={k} />)}</i></button>)
  }
  const list = shown.filter(p => p.date === day)
  const next = ahead.filter(p => p.date > day).slice(0, 2)
  const nothing = !ahead.length && !list.length
  return <div className="sc">
    <div className="m-chips sc-chips" role="radiogroup" aria-label="일정 보기">{([['all', '전체'], ['join', '참여'], ['host', '나의 모집']] as const).map(([key, label]) =>
      <button key={key} type="button" role="radio" aria-checked={filter === key} className={'m-chip' + (filter === key ? ' on' : '')} onClick={() => { setFilter(key); setPicked(null); setMonth(null) }}>{label}</button>)}</div>
    <section className="sc-cal" aria-label="일정 달력">
      <div className="sc-head"><button type="button" aria-label="이전 달" onClick={() => move(-1)}><MIcon name="back" size={18} /></button>
        <strong>{y}년 {m}월</strong>
        <button type="button" className="next" aria-label="다음 달" onClick={() => move(1)}><MIcon name="back" size={18} /></button></div>
      <div className="sc-grid">{WEEK.map((w, i) => <span key={w} className={'sc-w' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '')}>{w}</span>)}{cells}</div>
      <div className="sc-legend" aria-hidden="true"><span><b className="g" />참여</span><span><b className="b" />1365</span><span><b className="o" />나의 모집</span><span><b className="x" />지난</span></div>
    </section>
    {nothing ? <div className="sc-empty">{empty}</div> : <>
      <h2 className="sc-date">{md(day)}{!list.length && <small> · 일정 없음</small>}</h2>
      {list.length > 0 && <div className="sc-list">{list.map(p => <PlanCard key={p.key} p={p} />)}</div>}
      {!list.length && next.length > 0 && <><h3 className="sc-next">다가오는 일정</h3><div className="sc-list">{next.map(p => <PlanCard key={p.key} p={p} when />)}</div></>}
    </>}
    {after}
  </div>
}
