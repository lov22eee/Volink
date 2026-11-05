// 찾기: search, a few chips, list or map, and 1365 programs (applied for on 1365, not here).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api } from '../api'
import type { LiveActivity } from '../api'
import { categories } from '../App'
import { programKind, range, when1365 } from '../explore'
import type { Program } from '../explore'
import { currentPosition, remember, remembered } from '../location'
import { PlaceMap } from '../map'
import { ActivityRow, fieldIcon, isNewcomer, seatsLeft } from './cards'
import { Empty, Loading, MIcon, RecruitFab, Sheet, TopBar } from './ui'

type Chip = 'near' | 'weekend' | 'newcomer' | '1365'
const chipLabels: Record<Chip, string> = { near: '내 주변', weekend: '이번 주말', newcomer: '처음 환영', '1365': '1365' }
// A key like '1365' would sort first in Object.keys, so the order is written out.
const chipOrder: Chip[] = ['near', 'weekend', 'newcomer', '1365']

export function FindScreen({ actions, focus, initial }: { actions: ReactNode; focus?: boolean; initial?: string }) {
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [chips, setChips] = useState<Set<Chip>>(() => new Set(initial && initial in chipLabels ? [initial as Chip] : []))
  const [category, setCategory] = useState('')
  const [view, setView] = useState<'list' | 'map'>('list')
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [notice, setNotice] = useState('')
  const [items, setItems] = useState<LiveActivity[] | null>(null)
  const [programs, setPrograms] = useState<Program[] | null>(null)
  const [programsOn, setProgramsOn] = useState(true)
  const [program, setProgram] = useState<Program | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (focus) input.current?.focus() }, [focus])

  const near = chips.has('near'), only1365 = chips.has('1365')
  const toggle = (chip: Chip) => setChips(current => { const next = new Set(current); if (next.has(chip)) next.delete(chip); else next.add(chip); return next })

  // Location is asked only when a chip needs it, and only the answer (not the place) is remembered.
  useEffect(() => {
    if ((!near && !only1365) || origin) return
    setLocating(true)
    currentPosition().then(position => {
      setLocating(false)
      if (position) { setOrigin(position); remember(true); setNotice('') }
      else { setNotice('위치를 확인하지 못했어요. 휴대폰 설정에서 위치 권한을 켜 주세요.'); setChips(current => { const next = new Set(current); next.delete('near'); return next }) }
    })
  }, [near, only1365, origin])
  useEffect(() => { if (remembered()) currentPosition().then(position => position && setOrigin(position)) }, [])

  useEffect(() => {
    if (only1365) return
    let current = true
    setItems(null)
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (category) params.set('category', category)
    if (chips.has('weekend')) { const r = range('weekend'); if (r.from) params.set('from', r.from); if (r.to) params.set('to', r.to) }
    if (near && origin) { params.set('lat', origin.lat.toFixed(6)); params.set('lng', origin.lng.toFixed(6)); params.set('radiusKm', '5') }
    api<LiveActivity[]>('/api/activities?' + params).then(list => { if (current) setItems(list) }).catch(() => { if (current) setItems([]) })
    return () => { current = false }
  }, [q, category, chips, near, origin, only1365])

  useEffect(() => {
    if (!only1365 || !origin) return
    let current = true
    setPrograms(null)
    const params = new URLSearchParams({ lat: origin.lat.toFixed(6), lng: origin.lng.toFixed(6), radiusKm: '20' })
    if (q) params.set('q', q)
    api<{ enabled: boolean; items: Program[] }>('/api/volunteer-programs?' + params)
      .then(result => { if (current) { setProgramsOn(result.enabled); setPrograms(result.items) } })
      .catch(() => { if (current) { setProgramsOn(false); setPrograms([]) } })
    return () => { current = false }
  }, [only1365, origin, q])

  // Full activities go to the end (still visible: the waitlist may be open).
  const shown = useMemo(() => (items ?? []).filter(a => !chips.has('newcomer') || isNewcomer(a)).sort((a, b) => Number(seatsLeft(a) === 0) - Number(seatsLeft(b) === 0)), [items, chips])
  function search(event: FormEvent) { event.preventDefault(); setQ(query.trim()); input.current?.blur() }

  return <div className="m-screen m-find">
    <TopBar title="봉사 찾기" actions={actions} />
    <div className="m-find-head">
      <form className="m-search" role="search" onSubmit={search}>
        <MIcon name="search" size={20} />
        <input ref={input} type="search" enterKeyHint="search" placeholder="지역, 활동명 검색" aria-label="검색어" value={query} onChange={event => { setQuery(event.target.value); if (!event.target.value) setQ('') }} />
        {query && <button type="button" className="m-icon-btn sm" aria-label="검색어 지우기" onClick={() => { setQuery(''); setQ('') }}><MIcon name="close" size={18} /></button>}
      </form>
      <div className="m-chips" role="group" aria-label="빠른 조건">
        {chipOrder.map(chip => <button key={chip} type="button" className={'m-chip' + (chips.has(chip) ? ' on' : '')} aria-pressed={chips.has(chip)} onClick={() => toggle(chip)}>
          {chip === 'near' && <MIcon name="pin" size={16} />}{chipLabels[chip]}</button>)}
        {!only1365 && categories.map(c => <button key={c} type="button" className={'m-chip' + (category === c ? ' on' : '')} aria-pressed={category === c} onClick={() => setCategory(category === c ? '' : c)}><MIcon name={fieldIcon[c]} size={16} />{c}</button>)}
      </div>
    </div>
    <div className="m-body">
      {locating && <p className="m-help">위치를 확인하고 있어요…</p>}
      {notice && <div className="m-note">{notice}</div>}
      {only1365 ? <>
        <div className="m-note mint"><strong>1365 공식 봉사활동</strong>신청과 봉사시간 인정은 1365 자원봉사포털에서 해요.</div>
        {!origin ? <Empty icon="pin" title="위치가 필요해요" text="가까운 1365 활동을 찾으려면 위치 권한을 허용해 주세요." />
          : !programs ? <Loading />
          : !programsOn ? <Empty icon="refresh" title="지금은 1365 활동을 불러올 수 없어요" text="잠시 후 다시 시도해 주세요." />
          : programs.length === 0 ? <Empty icon="search" title="20km 안에 모집 중인 1365 활동이 없어요" />
          : <div className="m-list">{programs.map(p => <button key={p.programNo} type="button" className="m-row" onClick={() => setProgram(p)}>
            <span className="m-row-ico p"><MIcon name="flag" size={21} /></span>
            <span className="m-row-main"><strong>{p.title}</strong><small>{[when1365(p) || '일정은 1365에서 확인', p.distanceKm != null ? p.distanceKm + 'km' : null].filter(Boolean).join(' · ')}</small></span>
            <span className="m-badge blue">1365</span></button>)}</div>}
      </> : <>
        <div className="m-result-head"><h2>{items ? `${shown.length}개 활동` : '활동'}</h2>
          <div className="m-seg" role="tablist" aria-label="보기">
            <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><MIcon name="list" size={17} />목록</button>
            <button role="tab" aria-selected={view === 'map'} className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}><MIcon name="map" size={17} />지도</button></div></div>
        {!items ? <Loading />
          : view === 'map' ? <div className="m-map-box">
            <PlaceMap label="활동 위치 지도" places={shown.map(a => ({ id: a.id, name: a.title, latitude: a.latitude ?? null, longitude: a.longitude ?? null }))}
              origin={origin ? { ...origin, label: '내 위치' } : null} radiusKm={near ? 5 : undefined} selected={selected} onSelect={setSelected} />
            {selected && shown.find(a => a.id === selected) && <div className="m-map-card"><ActivityRow activity={shown.find(a => a.id === selected)!} /></div>}
            {!shown.some(a => a.latitude != null) && <p className="m-help center">장소 좌표가 있는 활동만 지도에 보여요.</p>}
          </div>
          : shown.length === 0 ? <Empty icon="search" title="조건에 맞는 활동이 없어요" text={near ? '내 주변 5km 안에는 아직 없어요. 조건을 줄여 보세요.' : '검색어나 조건을 바꿔 보세요.'}
            action={(chips.size > 0 || q || category) ? <button className="m-btn line sm" onClick={() => { setChips(new Set()); setQ(''); setQuery(''); setCategory('') }}>조건 모두 지우기</button> : undefined} />
          : <div className="m-list">{shown.map(a => <ActivityRow key={a.id} activity={a} />)}</div>}
      </>}
    </div>
    {!only1365 && view === 'list' && <RecruitFab />}
    {program && <Sheet title="1365 활동" onClose={() => setProgram(null)} footer={<a className="m-btn" href={program.link} target="_blank" rel="noopener noreferrer">1365에서 신청하기 <MIcon name="outward" size={18} /></a>}>
      <h3 className="m-h3">{program.title}</h3>
      <dl className="m-dl">
        {([['분야', programKind(program)?.label ?? program.field], ['모집 기관', program.organization], ['장소', program.place ? program.place + (program.distanceKm != null ? ` (${program.distanceKm}km)` : '') : null],
          ['일정', when1365(program) || null], ['모집', program.recruitStatus], ['청소년', program.youthOk ? '참여 가능' : null]] as [string, string | null][])
          .filter(([, value]) => value).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
      </dl>
      <p className="m-help">봉사시간 인정과 보험은 1365 기준이에요. Volink는 신청을 대신하지 않아요.</p>
    </Sheet>}
  </div>
}
