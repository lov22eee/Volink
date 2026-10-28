// Home (added 2026-10-22, user decision): the hero moved here from 활동 찾기, a short "my" summary, real counts,
// a few activities near me and how taking part works. Every number comes from the server; when it cannot be
// loaded it is hidden instead of showing a made-up value.
import { useEffect, useState } from 'react'
import { api, preview } from './api'
import type { LiveActivity, User } from './api'
import { ActivityCard, fromExample, fromLive, Icon, ParkArt } from './App'
import type { CardItem } from './App'
import type { DisplayCatalog as Catalog } from './data'
import { km, range, remembered, travel } from './explore'
import type { Program } from './explore'
import { Glyph } from './icons'

type Near = { key: string; distance: number; card?: CardItem; program?: Program }

export default function Home({ user, catalog }: { user: User | null; catalog: Catalog | null }) {
  const [all, setAll] = useState<LiveActivity[] | null>(null)
  const [mine, setMine] = useState<LiveActivity[] | null>(null)
  const [near, setNear] = useState<Near[] | null>(null)
  const [programCount, setProgramCount] = useState<number | null>(null)

  useEffect(() => {
    if (preview) return
    api<LiveActivity[]>('/api/activities').then(setAll).catch(() => setAll(null))
    // Only when location was allowed before: no permission prompt on the home page.
    if (!remembered() || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(async position => {
      const here = { lat: position.coords.latitude, lng: position.coords.longitude, label: '내 위치' }
      const at = `lat=${here.lat.toFixed(6)}&lng=${here.lng.toFixed(6)}`
      const [local, programs] = await Promise.all([
        api<LiveActivity[]>(`/api/activities?${at}&radiusKm=20`).catch(() => [] as LiveActivity[]),
        api<{ enabled: boolean; items: Program[] }>(`/api/volunteer-programs?${at}&radiusKm=20`).catch(() => null),
      ])
      if (programs?.enabled) setProgramCount(programs.items.length)
      setNear([
        ...local.map(a => ({ key: 'a' + a.id, distance: a.distanceKm ?? 999, card: { ...fromLive(a), distanceKm: a.latitude != null && a.longitude != null ? km(here, a.latitude, a.longitude) : undefined } })),
        ...(programs?.items ?? []).map(p => ({ key: 'p' + p.programNo, distance: p.distanceKm ?? 999, program: p })),
      ].sort((a, b) => a.distance - b.distance).slice(0, 3))
    }, () => setNear(null), { timeout: 8000, maximumAge: 300000 })
  }, [])

  useEffect(() => {
    if (!user || preview) { setMine(null); return }
    api<LiveActivity[]>('/api/me/activities').then(setMine).catch(() => setMine(null))
  }, [user])

  const { from, to } = range('weekend')
  const weekend = all?.filter(a => (!from || a.date >= from) && (!to || a.date <= to)).length
  const picks: Near[] = near ?? (preview
    ? (catalog?.activities ?? []).slice(0, 3).map(e => ({ key: 'e' + e.id, distance: 0, card: fromExample(e, catalog!.baseDate) }))
    : (all ?? []).slice(0, 3).map(a => ({ key: 'a' + a.id, distance: 0, card: fromLive(a) })))
  const upcoming = mine?.filter(a => a.status === 'RECRUITING').sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))[0]

  return <>
    <section className="hero">
      <div className="hero-copy"><span className="eyebrow"><span className="tiny-dot" />작은 실천, 가까운 연결</span><h1>가까운 곳에서,<br />함께 만드는 <em>변화.</em></h1>
        <p>동네 활동과 1365 봉사활동을 한 지도에서.<br />30분부터, 걸어서 갈 수 있는 곳부터 시작해요.</p>
        <div className="hero-actions"><a className="primary-button" href="#/explore">내 주변 활동 찾기 <Icon name="arrow" size={18} /></a><a className="secondary-button" href="#/create">활동 만들기</a></div>
        <span className="hero-note">2–10명 함께 · 3시간 이내</span></div>
      <div className="hero-art"><ParkArt /><div className="floating-note"><span className="floating-icon"><Icon name="leaf" /></span><div><strong>혼자보다, 함께.</strong><span>우리 동네에 변화를 남겨요</span></div></div></div>
    </section>

    {user && mine && <section className="home-me home-section" aria-label="내 요약">
      <div><span className="label">{user.name}님이 연 활동</span><strong>{mine.length}개{mine.some(a => a.status === 'DRAFT') ? ` · ${mine.filter(a => a.status === 'DRAFT').length}개 검토 중` : ''}</strong>
        <a href="#/mine">내 활동 보기</a></div>
      <div><span className="label">가장 가까운 내 활동</span>{upcoming ? <><strong>{upcoming.title}</strong><span>{upcoming.date.slice(5).replace('-', '/')} {upcoming.startTime}</span></> : <strong>아직 없어요</strong>}</div>
      <div><span className="label">관심 분야</span><strong>{user.interests.length ? user.interests.join(' · ') : '아직 고르지 않았어요'}</strong></div>
    </section>}

    {!preview && <section className="home-stats" aria-label="지금 모집 현황">
      {all && <div><span className="label">지금 모집 중인 동네 활동</span><strong>{all.length}개</strong></div>}
      {programCount != null && <div><span className="label">근처 20km 1365 봉사</span><strong>{programCount}개</strong></div>}
      {weekend != null && <div><span className="label">이번 주말 동네 활동</span><strong>{weekend}개</strong></div>}
    </section>}

    <section className="home-section" aria-label={near ? '지금 내 주변' : '모집 중인 활동'}>
      <div className="home-head"><div><h2>{near ? '지금 내 주변' : preview ? '이런 활동을 함께해요' : '모집 중인 활동'}</h2><p>{near ? '내 위치에서 가까운 순서예요.' : '지금 이웃을 기다리는 활동이에요.'}</p></div><a href="#/explore">지도에서 모두 보기 <Glyph name="arrow" size={15} /></a></div>
      {picks.length ? <div className="activity-grid">{picks.map(pick => pick.card ? <ActivityCard key={pick.key} item={pick.card} />
        : <a key={pick.key} className="home-program" href={pick.program!.link} target="_blank" rel="noopener noreferrer">
          <span className="source program">1365 활동</span><strong>{pick.program!.title}</strong>
          <span>{pick.program!.place}{pick.program!.distanceKm != null ? ` · ${pick.program!.distanceKm}km · ${travel(pick.program!.distanceKm)}` : ''}</span>
          <span className="link-out">1365에서 신청 <Glyph name="external" size={14} /></span></a>)}</div>
        : all ? <div className="empty-state"><p>아직 모집 중인 활동이 없어요. 첫 활동을 열어 보세요.</p><a className="secondary-button" href="#/create">활동 만들기</a></div>
          : <div className="loading-state" role="status">활동을 불러오는 중입니다.</div>}
    </section>

    <section className="home-section" aria-label="참여 방법">
      <div className="home-head"><div><h2>이렇게 참여해요</h2><p>공식 봉사실적·자원봉사 종합보험은 1365 활동에만 해당돼요</p></div></div>
      <ol className="home-steps">
        <li><Glyph name="search" size={20} /><strong>찾기</strong><span>내 주변·이번 주말 활동</span></li>
        <li><Glyph name="check" size={20} /><strong>신청</strong><span>동네 활동은 Volink에서, 1365 활동은 1365에서</span></li>
        <li><Glyph name="pin" size={20} /><strong>참여</strong><span>정한 시간·장소에서 함께해요</span></li>
        <li><Glyph name="leaf" size={20} /><strong>기록</strong><span>내 활동에 차곡차곡</span></li>
      </ol>
    </section>
  </>
}
