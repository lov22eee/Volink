// Home (Volink 2.0, 2026-10-28): big type and a category visual with the real next activity, browse by field, this week's activities and a
// short guide. Activities come from the server (or the bundled examples in the offline preview); nothing here is
// made up, and when the list cannot be loaded the section says so instead of showing placeholders.
import { useEffect, useState } from 'react'
import { api, preview } from './api'
import type { LiveActivity, User } from './api'
import { categories, fromExample, fromLive, Icon, waitOpen } from './App'
import type { CardItem } from './App'
import { CategoryCover, HeroCover } from './covers'
import type { DisplayCatalog as Catalog } from './data'
import { Glyph } from './icons'
import type { GlyphName } from './icons'

const categoryIcon: Record<string, GlyphName> = { '환경 정화': 'leaf', '생활 지원': 'hand', '지역 돌봄': 'users' }

function seoulToday(days = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + days * 86_400_000))
}

function shortDate(value: string) {
  const day = new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value + 'T12:00:00+09:00'))
  return `${value.slice(5, 7)}.${value.slice(8, 10)}(${day})`
}

export function ActivityTile({ item }: { item: CardItem }) {
  const left = Math.max(0, item.capacity - item.confirmed)
  const status = item.kind === 'example' ? { text: '예시 활동', tone: 'muted' } : left > 0 ? { text: '모집 중', tone: 'open' } : { text: waitOpen(item) ? '대기 가능' : '정원 마감', tone: 'wait' }
  return <a className="tile" href={item.href} data-kind={item.kind}>
    <span className="tile-cover"><CategoryCover category={item.category} seed={item.id} /></span>
    <span className="tile-meta"><span className="tile-cat">{item.category}</span><span aria-hidden="true">·</span><span className={'tile-status ' + status.tone}>{status.text}</span></span>
    <strong className="tile-title">{item.title}</strong>
    <span className="tile-info">{shortDate(item.date)} {item.startTime} · {item.placeName} · {left > 0 ? `${left}자리 남음` : '정원 마감'}</span>
  </a>
}

export default function Home({ catalog }: { user: User | null; catalog: Catalog | null }) {
  const [all, setAll] = useState<LiveActivity[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (preview) return
    setFailed(false)
    api<LiveActivity[]>('/api/activities').then(setAll).catch(() => setFailed(true))
  }, [attempt])

  const today = seoulToday()
  const weekEnd = seoulToday(6)
  const items: CardItem[] | null = preview
    ? (catalog ? catalog.activities.map(e => fromExample(e, catalog.baseDate)) : null)
    : all && all.filter(a => a.date >= today).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime)).map(fromLive)
  const thisWeek = items?.filter(item => item.date <= weekEnd) ?? []
  const shown = (thisWeek.length ? thisWeek : items ?? []).slice(0, 3)
  const next = items?.[0]
  const heading = preview ? '이런 활동을 함께해요' : thisWeek.length || !items?.length ? '이번 주, 함께할 활동' : '곧 열리는 활동'

  return <div className="home">
    <section className="home-hero">
      <div className="home-hero-copy">
        <span className="home-eyebrow"><Glyph name="pin" size={16} />우리 동네에서 시작하는 좋은 일</span>
        <h1>가까운 곳에서,<br />함께 만드는 변화.</h1>
        <p>봉사활동, 거창하지 않아도 괜찮아요. 오늘 우리 동네에서 할 수 있는 작은 일을 찾아보세요.</p>
        <div className="home-actions"><a className="pill-button dark" href="#/explore">내 주변 활동 찾기 <Icon name="outward" size={17} /></a><a className="pill-button line" href="#/create">활동 만들기</a></div>
        <small>찾기부터 참여까지, 한곳에서 간편하게.</small>
      </div>
      <div className="home-hero-visual">
        <div className="hero-art" aria-hidden="true"><HeroCover categories={categories} /></div>
        {/* The real next activity (or example in the preview), so the first screen already shows something to join. */}
        {next && <a className="next-card" href={next.href}>
          <span className="next-label">{next.kind === 'example' ? '예시 활동' : '곧 열리는 활동'}</span>
          <strong>{next.title}</strong>
          <span className="next-info"><Glyph name="calendar" size={15} />{shortDate(next.date)} {next.startTime}</span>
          <span className="next-info"><Glyph name="pin" size={15} />{next.placeName}</span>
          <span className="next-seats"><span className="bar" aria-hidden="true"><i style={{ width: Math.min(100, next.confirmed / Math.max(1, next.capacity) * 100) + '%' }} /></span>{next.confirmed}/{next.capacity}명</span>
        </a>}
      </div>
    </section>

    <section className="home-block" aria-labelledby="home-fields">
      <div className="home-block-head"><h2 id="home-fields">어떤 봉사에 관심 있나요?</h2><span className="home-aside">관심 분야부터 시작해요</span></div>
      <div className="field-chips">{categories.map(name => <a key={name} className="field-chip" href={'#/explore?category=' + encodeURIComponent(name)}><Glyph name={categoryIcon[name] ?? 'leaf'} size={18} />{name}</a>)}</div>
    </section>

    <section className="home-block" aria-labelledby="home-week">
      <div className="home-block-head"><div><h2 id="home-week">{heading}</h2><p>우리 동네에서 기다리는 봉사활동</p></div><a className="home-more" href="#/explore">전체 보기 <Icon name="outward" size={15} /></a></div>
      {shown.length ? <div className="tile-row">{shown.map(item => <ActivityTile key={item.key} item={item} />)}</div>
        : failed ? <div className="home-empty" role="alert"><p>활동을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p><button className="pill-button line small" onClick={() => setAttempt(n => n + 1)}>다시 불러오기</button></div>
          : items ? <div className="home-empty"><Glyph name="leaf" size={26} /><p>아직 모집 중인 활동이 없어요. 우리 동네 첫 활동을 열어 보세요.</p><a className="pill-button dark small" href="#/create">활동 만들기</a></div>
            : <div className="home-empty" role="status">활동을 불러오는 중입니다.</div>}
    </section>

    <section className="home-guide" aria-label="참여 방법">
      <span className="guide-label">VOLINK GUIDE</span>
      <h2>처음이어도 괜찮아요.</h2>
      <ol>
        <li><b>01</b><strong>내 주변 활동 찾기</strong><span>관심 있는 동네 봉사활동을 찾아요.</span></li>
        <li><b>02</b><strong>간편하게 신청하기</strong><span>신청하고 참여 상태를 확인해요.</span></li>
        <li><b>03</b><strong>함께 참여하기</strong><span>정해진 시간과 장소에서 만나요.</span></li>
      </ol>
      <p className="guide-note">공식 봉사실적·자원봉사 종합보험은 1365 활동에만 해당돼요.</p>
    </section>
  </div>
}
