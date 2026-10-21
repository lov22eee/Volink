// Place field for the create form: one field with a search button that opens the "장소 찾기" dialog
// (Kakao keyword search + map with a centre pin). The server classifies and signs every result.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormEvent } from 'react'
import { api, ApiError, preview } from './api'
import { Glyph } from './icons'
import { kakaoEnabled, loadKakao } from './map'

export type PlaceResult = {
  placeId?: number; kakaoId?: string; name: string; address: string; categoryName: string
  latitude: number | null; longitude: number | null; distanceMeters: number | null
  placeClass: 'OPEN' | 'REVIEW' | 'BLOCKED'; classLabel: string; token?: string; meetingPoint?: string | null
}
type SearchResult = { mode: 'KAKAO' | 'LOCAL'; items: PlaceResult[] }

export const classBadge: Record<PlaceResult['placeClass'], { text: string; tone: string }> = {
  OPEN: { text: '바로 공개', tone: 'ok' },
  REVIEW: { text: '검토 후 공개', tone: 'review' },
  BLOCKED: { text: '고를 수 없음', tone: 'blocked' },
}

export function searchPlaces(query: string, near?: { lat: number; lng: number } | null) {
  const params = new URLSearchParams({ query })
  if (near) { params.set('lat', near.lat.toFixed(6)); params.set('lng', near.lng.toFixed(6)) }
  return api<SearchResult>('/api/places/search?' + params)
}

function distance(meters: number | null) {
  if (meters == null) return ''
  return meters < 1000 ? meters + 'm' : (meters / 1000).toFixed(1) + 'km'
}

export function PlaceField({ value, meetingPoint, onChange, error }: {
  value: PlaceResult | null; meetingPoint: string; onChange: (place: PlaceResult, meetingPoint: string) => void; error?: string
}) {
  const [open, setOpen] = useState(false)
  const badge = value && classBadge[value.placeClass]
  return <div className="field-block">
    <span className="field-label">장소 <span className="field-hint">돋보기를 누르면 검색 창이 열려요</span></span>
    <button type="button" name="place" className={'place-field' + (error ? ' invalid' : '')} onClick={() => setOpen(true)}
      aria-haspopup="dialog" aria-invalid={error ? true : undefined} aria-describedby={error ? 'place-error' : undefined}>
      <span className="field-icon"><Glyph name="pin" size={16} /></span>
      <span className="place-text">{value ? <><strong>{value.name}</strong><small>{value.address}{meetingPoint ? ' · 만나는 곳: ' + meetingPoint : ''}</small></> : <span className="placeholder">장소를 골라 주세요</span>}</span>
      {value && badge && <span className={'place-badge ' + badge.tone}>{value.classLabel} · {badge.text}</span>}
      <span className="search-square" aria-label="장소 검색"><Glyph name="search" size={17} /></span>
    </button>
    {error && <span id="place-error" className="field-error">{error}</span>}
    {open && <PlaceDialog initial={value} initialMeeting={meetingPoint} onClose={() => setOpen(false)} onPick={(place, meeting) => { onChange(place, meeting); setOpen(false) }} />}
  </div>
}

function PlaceDialog({ initial, initialMeeting, onClose, onPick }: {
  initial: PlaceResult | null; initialMeeting: string; onClose: () => void; onPick: (place: PlaceResult, meetingPoint: string) => void
}) {
  const [query, setQuery] = useState(initial?.name ?? '')
  const [items, setItems] = useState<PlaceResult[]>(initial ? [initial] : [])
  const [mode, setMode] = useState<'KAKAO' | 'LOCAL' | null>(null)
  const [chosen, setChosen] = useState<PlaceResult | null>(initial)
  const [meeting, setMeeting] = useState(initialMeeting)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [centre, setCentre] = useState<{ lat: number; lng: number } | null>(initial?.latitude != null ? { lat: initial.latitude, lng: Number(initial.longitude) } : null)
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus()
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    // Without a map key the server usually has no Kakao key either: show the admin-entered places right away.
    if (!initial && !kakaoEnabled) run(() => searchPlaces('공원', null), '')
    return () => window.removeEventListener('keydown', close)
  }, [])

  async function run(request: () => Promise<SearchResult>, empty: string) {
    // The offline preview has no server: nothing is sent.
    if (preview) { setMessage('미리보기에서는 장소 검색을 쓸 수 없습니다.'); return }
    setBusy(true)
    setMessage('')
    try {
      const result = await request()
      setMode(result.mode)
      setItems(result.items)
      if (!result.items.length) setMessage(empty || '찾은 장소가 없습니다. 다른 이름으로 검색해 보세요.')
      const first = result.items.find(item => item.latitude != null)
      if (first && !chosen) setCentre({ lat: Number(first.latitude), lng: Number(first.longitude) })
    } catch (cause) {
      setMessage(cause instanceof ApiError ? Object.values(cause.fieldErrors)[0] ?? cause.message : '장소를 찾지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    // The dialog sits inside the activity form in React's tree: keep this search from submitting that form.
    event.stopPropagation()
    if (query.trim()) run(() => searchPlaces(query.trim(), centre), '')
  }

  function choose(item: PlaceResult) {
    if (item.placeClass === 'BLOCKED') return
    setChosen(item)
    if (item.latitude != null) setCentre({ lat: Number(item.latitude), lng: Number(item.longitude) })
  }

  const same = (a: PlaceResult | null, b: PlaceResult) => a != null && (a.kakaoId ?? 'p' + a.placeId) === (b.kakaoId ?? 'p' + b.placeId)
  return createPortal(<div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="place-dialog" role="dialog" aria-modal="true" aria-labelledby="place-dialog-title" ref={dialog}>
      <div className="dialog-head"><h2 id="place-dialog-title">장소 찾기</h2><button type="button" className="icon-button" onClick={onClose} aria-label="닫기"><Glyph name="close" /></button></div>
      <form className="dialog-search" onSubmit={submit} role="search">
        <Glyph name="search" /><input aria-label="장소 이름이나 주소" value={query} maxLength={50} onChange={event => setQuery(event.target.value)} placeholder="장소 이름이나 주소 (예: 옥정호수공원)" />
        <button className="primary-button small" type="submit" disabled={busy}>검색</button>
      </form>
      <div className="dialog-body">
        <div className="dialog-results">
          {message && <p className="inline-notice" role="status">{message}</p>}
          <ul className="place-results" aria-label="검색 결과">{items.map(item => {
            const badge = classBadge[item.placeClass]
            return <li key={item.kakaoId ?? 'p' + item.placeId}>
              <button type="button" className={same(chosen, item) ? 'selected' : ''} aria-pressed={same(chosen, item)} disabled={item.placeClass === 'BLOCKED'} onClick={() => choose(item)}>
                <span><strong>{item.name}</strong><small>{item.classLabel} · {item.address}{item.distanceMeters != null ? ' · ' + distance(item.distanceMeters) : ''}</small></span>
                <span className={'place-badge ' + badge.tone}>{badge.text}</span>
              </button>
            </li>
          })}</ul>
          <label className="meeting-field">만나는 곳 <span className="field-hint">선택 · 100자 이내</span><input value={meeting} maxLength={100} onChange={event => setMeeting(event.target.value)} placeholder="예: 정문 안내판 앞" /></label>
          {chosen?.placeClass === 'REVIEW' && <p className="small-print">{chosen.classLabel}에서 하는 활동은 관리자가 확인한 뒤 공개돼요.</p>}
        </div>
        {kakaoEnabled && mode !== 'LOCAL'
          ? <PinMap centre={centre} chosen={chosen} onNearby={point => run(() => api<SearchResult>(`/api/places/nearby?lat=${point.lat.toFixed(6)}&lng=${point.lng.toFixed(6)}`), '이 근처에서 고를 수 있는 장소를 찾지 못했습니다. 지도를 조금 옮겨 보세요.')} />
          : <div className="pin-map empty"><Glyph name="map" size={28} /><p>{mode === 'LOCAL' ? '지금은 관리자가 등록한 장소만 고를 수 있어요.' : '지도 키가 없어 목록으로만 고를 수 있어요.'}</p></div>}
      </div>
      <div className="dialog-foot">
        <span className="small-print"><Glyph name="map" size={15} /> 지도를 움직인 뒤 ‘이 근처 장소 찾기’를 누르면 가운데 핀 주변 장소가 나와요.</span>
        <div className="button-row"><button type="button" className="secondary-button" onClick={onClose}>취소</button>
          <button type="button" className="primary-button" disabled={!chosen} onClick={() => chosen && onPick(chosen, meeting.trim())}>이 장소로 정하기</button></div>
      </div>
    </div>
  </div>, document.body)
}

/** Kakao map with a fixed centre pin. Moving the map changes the point used by "이 근처 장소 찾기". */
function PinMap({ centre, chosen, onNearby }: { centre: { lat: number; lng: number } | null; chosen: PlaceResult | null; onNearby: (point: { lat: number; lng: number }) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<any>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    loadKakao().then(kakao => {
      if (cancelled || !box.current) return
      const start = centre ?? { lat: 37.8, lng: 127.08 }
      map.current = new kakao.maps.Map(box.current, { center: new kakao.maps.LatLng(start.lat, start.lng), level: 3 })
    }).catch(() => setFailed(true))
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (map.current && centre && window.kakao) map.current.panTo(new window.kakao.maps.LatLng(centre.lat, centre.lng))
  }, [centre])
  if (failed) return <div className="pin-map empty"><Glyph name="map" size={28} /><p>지도를 불러오지 못했습니다. 목록에서 골라 주세요.</p></div>
  return <div className="pin-map">
    <div ref={box} className="kakao-map" role="img" aria-label="장소 고르기 지도" />
    <span className="centre-pin" aria-hidden="true"><Glyph name="pin" size={38} /></span>
    {chosen && <span className="pin-tip"><strong>{chosen.name}</strong> · {chosen.classLabel}</span>}
    <button type="button" className="map-pill" onClick={() => { const c = map.current?.getCenter(); if (c) onNearby({ lat: c.getLat(), lng: c.getLng() }) }}><Glyph name="search" size={14} />이 근처 장소 찾기</button>
  </div>
}
