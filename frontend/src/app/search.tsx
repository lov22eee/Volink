// 통합검색 (#/search, 2026-11-06): one box for Volink activities, 1365 programs (when the position is already allowed)
// and community posts. Recent searches stay on this phone only (up to 10, delete one or all).
import { useEffect, useState } from 'react'
import { api } from '../api'
import type { LiveActivity } from '../api'
import type { Program } from '../explore'
import { currentPosition, remembered } from '../location'
import { ActivityRow } from './cards'
import { PostCard } from './community'
import type { PostSummary } from './community'
import { goBack, MIcon, TextInput } from './ui'

const RECENT = 'volink.recentSearch'
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT) ?? '[]') } catch { return [] } }
const saveRecent = (list: string[]) => { try { localStorage.setItem(RECENT, JSON.stringify(list.slice(0, 10))) } catch { /* storage blocked */ } }
type Tab = 'all' | 'activity' | 'community'
type Results = { activities: LiveActivity[]; programs: Program[] | null; posts: PostSummary[] }

export function SearchScreen({ initial }: { initial?: string }) {
  const [text, setText] = useState(initial ?? '')
  const [query, setQuery] = useState(initial ?? '')
  const [recent, setRecent] = useState<string[]>(readRecent)
  const [tab, setTab] = useState<Tab>('all')
  const [results, setResults] = useState<Results | null>(null)
  const [failed, setFailed] = useState(false)

  function run(words: string) {
    const q = words.trim()
    if (!q) return
    setText(q); setQuery(q); setTab('all')
    const next = [q, ...recent.filter(x => x !== q)].slice(0, 10)
    setRecent(next); saveRecent(next)
    window.history.replaceState(null, '', '#/search?q=' + encodeURIComponent(q))
  }
  useEffect(() => {
    if (!query) { setResults(null); return }
    let live = true
    setResults(null); setFailed(false)
    const q = encodeURIComponent(query)
    // 2026-11-06: a search looks across the whole country (Volink and 1365); the distance is added when the position is known.
    const programs = (remembered() ? currentPosition().catch(() => null) : Promise.resolve(null))
      .then(at => api<{ items: Program[] }>(`/api/volunteer-programs?nationwide=true&q=${q}` + (at ? `&lat=${at.lat.toFixed(6)}&lng=${at.lng.toFixed(6)}` : '')).then(r => r.items).catch(() => null))
    Promise.all([api<LiveActivity[]>('/api/activities?q=' + q), programs, api<PostSummary[]>('/api/community/posts?q=' + q)])
      .then(([activities, found, posts]) => { if (live) setResults({ activities, programs: found, posts }) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [query])

  const activityCount = results ? results.activities.length + (results.programs?.length ?? 0) : 0
  const tabs: [Tab, string][] = [['all', '통합검색'], ['activity', '봉사활동'], ['community', '커뮤니티']]
  const activityList = (limit?: number) => results && <div className="m-list sr-list">
    {results.activities.slice(0, limit).map(a => <ActivityRow key={'a' + a.id} activity={a} />)}
    {(results.programs ?? []).slice(0, limit === undefined ? undefined : Math.max(0, limit - results.activities.length)).map(p =>
      <a key={'p' + p.programNo} className="m-row" href={'#/find?chip=1365&category=' + encodeURIComponent(p.category ?? '')}>
        <span className="m-row-ico p"><MIcon name="flag" size={21} /></span>
        <span className="m-row-main"><strong>{p.title}</strong><small>{[p.distanceKm != null ? p.distanceKm + 'km' : null, p.place?.split(' ').slice(0, 2).join(' '), p.organization].filter(Boolean).join(' · ')}</small></span>
        <span className="m-badge blue">1365</span></a>)}
  </div>
  const postList = (limit?: number) => results && <div className="c-list sr-list">{results.posts.slice(0, limit).map(p => <PostCard key={p.id} post={p} />)}</div>

  return <div className="m-screen sr">
    <header className="sr-top">
      <button type="button" className="m-icon-btn" aria-label="뒤로" onClick={() => goBack('#/home')}><MIcon name="back" /></button>
      <form className="sr-box" role="search" onSubmit={event => { event.preventDefault(); run(text) }}>
        <TextInput type="search" aria-label="검색어" placeholder="봉사활동, 커뮤니티 글 검색" autoFocus={!initial} value={text} maxLength={40} enterKeyHint="search" onChange={event => setText(event.target.value)} />
        {text && <button type="button" className="sr-clear" aria-label="검색어 지우기" onClick={() => { setText(''); setQuery(''); window.history.replaceState(null, '', '#/search') }}><MIcon name="close" size={16} /></button>}
      </form>
    </header>
    {!query ? <div className="m-body sr-recent">
      <div className="sr-head"><h2>최근 검색어</h2>{recent.length > 0 && <button type="button" className="m-text-btn" onClick={() => { setRecent([]); saveRecent([]) }}>전체 삭제</button>}</div>
      {recent.length ? <ul className="sr-words">{recent.map(word => <li key={word}><button type="button" className="sr-word" onClick={() => run(word)}><MIcon name="clock" size={16} />{word}</button>
        <button type="button" className="sr-x" aria-label={word + ' 지우기'} onClick={() => { const next = recent.filter(x => x !== word); setRecent(next); saveRecent(next) }}><MIcon name="close" size={14} /></button></li>)}</ul>
        : <p className="sr-empty">최근 검색어가 없어요.</p>}
    </div> : <>
      <nav className="sr-tabs" role="tablist" aria-label="검색 결과">{tabs.map(([key, label]) =>
        <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{label}</button>)}</nav>
      <div className="m-body sr-body">
        {failed ? <p className="sr-empty">지금은 검색하지 못했어요. 잠시 뒤 다시 해 주세요.</p>
          : !results ? <p className="sr-empty">찾는 중…</p>
          : tab === 'all' ? (activityCount + results.posts.length === 0 ? <p className="sr-empty">‘{query}’에 맞는 결과가 없어요.</p> : <>
            {activityCount > 0 && <section><div className="sr-head"><h2>봉사활동 <b>{activityCount}</b> <small className="sr-scope">전국</small></h2>{activityCount > 3 && <button type="button" className="m-text-btn" onClick={() => setTab('activity')}>더 보기</button>}</div>{activityList(3)}</section>}
            {results.posts.length > 0 && <section><div className="sr-head"><h2>커뮤니티 <b>{results.posts.length}</b></h2>{results.posts.length > 3 && <button type="button" className="m-text-btn" onClick={() => setTab('community')}>더 보기</button>}</div>{postList(3)}</section>}
          </>)
          : tab === 'activity' ? (activityCount ? <><p className="sr-count">총 {activityCount}개{results.programs === null ? ' · 1365는 위치를 허용하면 함께 찾아요' : ''}</p>{activityList()}</> : <p className="sr-empty">‘{query}’에 맞는 봉사활동이 없어요.</p>)
          : results.posts.length ? <><p className="sr-count">총 {results.posts.length}개</p>{postList()}</> : <p className="sr-empty">‘{query}’에 맞는 커뮤니티 글이 없어요.</p>}
      </div>
    </>}
  </div>
}
