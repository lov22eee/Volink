// 홈 '우리 동네 지금': how many activities are recruiting near me (Volink posts + 1365 programs, counted apart and
// named apart) and how many people finished a Volink activity in each of the last 6 months (real records only).
// Numbers only; the position is asked only when the person already allowed it, or when they tap 내 주변 보기.
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { currentPosition, remember, remembered } from '../location'
import { MIcon } from './ui'

type HomeStats = {
  nearby: { located: boolean; radiusKm: number; volink: number | null; program: number | null; volinkAll: number }
  monthly: { points: { month: string; people: number }[]; people: number; activeMonths: number; source: string }
  official: null | { label: string; value: string; year: number; source: string }
  updatedAt: string
}

const CACHE = 'volink.homeStats'
const CACHE_MS = 10 * 60_000
/** Too few records to draw a fair line: a first-participation message instead (never a made-up trend). */
const enoughForChart = (m: HomeStats['monthly']) => m.people >= 3 && m.activeMonths >= 2

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function readCache(key: string): HomeStats | null {
  try {
    const raw = sessionStorage.getItem(CACHE)
    if (!raw) return null
    const saved = JSON.parse(raw) as { key: string; at: number; data: HomeStats }
    return saved.key === key && Date.now() - saved.at < CACHE_MS ? saved.data : null
  } catch { return null }
}
function writeCache(key: string, data: HomeStats) { try { sessionStorage.setItem(CACHE, JSON.stringify({ key, at: Date.now(), data })) } catch { /* storage blocked */ } }

/** Counts up from 0 once (about 0.9 s); with reduced motion the number is just shown. */
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(() => reduced() ? value : 0)
  useEffect(() => {
    if (reduced()) { setShown(value); return }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900)
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return <>{shown.toLocaleString()}</>
}

/** The real values as they are: y from 0 to the largest month, each point labelled with its number. */
function MonthlyChart({ points }: { points: { month: string; people: number }[] }) {
  const w = 300, h = 120, padX = 14, padTop = 22, padBottom = 8
  const max = Math.max(1, ...points.map(p => p.people))
  const x = (i: number) => padX + (i * (w - padX * 2)) / (points.length - 1)
  const y = (v: number) => padTop + (h - padTop - padBottom) * (1 - v / max)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.people).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)},${h - padBottom} L${x(0).toFixed(1)},${h - padBottom} Z`
  const path = useRef<SVGPathElement>(null)
  const [drawn, setDrawn] = useState(reduced())
  useEffect(() => { if (reduced()) return; const t = window.setTimeout(() => setDrawn(true), 60); return () => window.clearTimeout(t) }, [])
  const length = path.current?.getTotalLength?.() ?? 600
  return <figure className="s-chart">
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={'월별 참여 완료 인원: ' + points.map(p => `${Number(p.month.slice(5))}월 ${p.people}명`).join(', ')}>
      <defs><linearGradient id="s-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#8fd3ad" stopOpacity=".35" /><stop offset="1" stopColor="#8fd3ad" stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill="url(#s-fill)" className={'s-area' + (drawn ? ' on' : '')} />
      <path ref={path} d={line} className="s-line" style={reduced() ? undefined : { strokeDasharray: length, strokeDashoffset: drawn ? 0 : length }} />
      {points.map((p, i) => <g key={p.month} className={'s-dot' + (drawn ? ' on' : '')} style={{ transitionDelay: reduced() ? '0s' : `${0.15 + i * 0.12}s` }}>
        <circle cx={x(i)} cy={y(p.people)} r="4" /><text x={x(i)} y={y(p.people) - 9} textAnchor="middle">{p.people}</text></g>)}
    </svg>
    <figcaption className="s-months">{points.map(p => <span key={p.month}>{Number(p.month.slice(5))}월</span>)}</figcaption>
  </figure>
}

export function StatsBanner() {
  const [stats, setStats] = useState<HomeStats | null>(null)
  const [failed, setFailed] = useState(false)
  const [locating, setLocating] = useState(false)

  async function load(position: { lat: number; lng: number } | null) {
    const key = position ? `${position.lat.toFixed(2)},${position.lng.toFixed(2)}` : 'none'
    const cached = readCache(key)
    if (cached) { setStats(cached); return }
    try {
      const data = await api<HomeStats>('/api/stats/home' + (position ? `?lat=${position.lat.toFixed(6)}&lng=${position.lng.toFixed(6)}&radiusKm=5` : ''))
      writeCache(key, data)
      setStats(data)
      setFailed(false)
    } catch { setFailed(true) }
  }
  useEffect(() => {
    let live = true
    ;(remembered() ? currentPosition() : Promise.resolve(null)).then(position => { if (live) void load(position) })
    return () => { live = false }
  }, [])
  async function locate() {
    setLocating(true)
    const position = await currentPosition()
    setLocating(false)
    if (position) { remember(true); void load(position) }
  }

  const head = <div className="s-head"><MIcon name="sprout" size={18} />우리 동네 지금</div>
  if (failed && !stats) return <section className="s-banner" aria-label="우리 동네 지금">
    {head}
    <p className="s-lead">지금은 모집 현황을 불러오지 못했어요.</p>
    <button type="button" className="s-link" onClick={() => { setFailed(false); void load(null) }}>다시 불러오기</button>
  </section>
  if (!stats) return <section className="s-banner loading" aria-label="우리 동네 지금" aria-busy="true">{head}<div className="s-skel" /><div className="s-skel short" /></section>

  const n = stats.nearby
  const total = (n.volink ?? 0) + (n.program ?? 0)
  const m = stats.monthly
  return <section className="s-banner in" aria-label="우리 동네 지금">
    {head}
    {n.located ? <>
      <p className="s-lead">내 주변 {n.radiusKm}km에서 참여를 기다리는 봉사활동</p>
      <p className="s-big"><strong><CountUp value={total} /></strong>개</p>
      <p className="s-split">동네 모집 {n.volink ?? 0}개 · {n.program === null ? '1365는 지금 확인할 수 없어요' : `1365 공개 모집 ${n.program}개`}</p>
    </> : <>
      <p className="s-lead">지금 Volink에서 참여를 기다리는 봉사활동</p>
      <p className="s-big"><strong><CountUp value={n.volinkAll} /></strong>개</p>
      <button type="button" className="s-link" disabled={locating} onClick={locate}><MIcon name="pin" size={16} />{locating ? '위치 확인 중…' : '위치를 허용하면 내 주변 숫자를 보여 드려요'}</button>
    </>}

    {enoughForChart(m) && <div className="s-trend">
      <p className="s-trend-head"><b>우리의 작은 변화</b><small>최근 6개월 참여 완료 인원</small></p>
      <MonthlyChart points={m.points} />
    </div>}

    <a className="m-btn s-cta" href="#/find?chip=near">내 주변 봉사 둘러보기 <MIcon name="chevron" size={18} /></a>
    <p className="s-source">Volink 기록{n.program !== null && n.located ? '·1365 공개 모집 정보' : ''} 기준 · 공식 봉사실적이 아니에요</p>
  </section>
}
