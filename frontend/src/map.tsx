// Map panel: Kakao Maps when VITE_KAKAO_JS_KEY is set (domain-restricted public key), otherwise a simple relative-position drawing.
import { useEffect, useRef, useState } from 'react'

/** {@code tone}: 'local' (our activity, green) or 'program' (1365, blue) when one map shows both; none = the plain marker. */
export type MapPlace = { id: number; name: string; latitude: number | null; longitude: number | null; meetingPoint?: string | null; tone?: 'local' | 'program' }
const toneColour = { local: '#245e48', program: '#2f62a8' }
export type Origin = { lat: number; lng: number; label: string }

declare global {
  interface Window { kakao?: any }
}

const kakaoKey = import.meta.env.VITE_KAKAO_JS_KEY
export const kakaoEnabled = Boolean(kakaoKey)

/** Map pin drawn as an SVG string for Kakao overlays (bigger when picked). */
export const pinSvg = (colour: string, big: boolean) => `<svg xmlns="http://www.w3.org/2000/svg" width="${big ? 36 : 28}" height="${big ? 36 : 28}" viewBox="0 0 24 24" fill="${colour}" stroke="#fff" stroke-width="1.6"><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11Z"/><circle cx="12" cy="10" r="2.3" fill="#fff"/></svg>`
let loading: Promise<any> | null = null

export function loadKakao(): Promise<any> {
  if (window.kakao?.maps?.LatLng) return Promise.resolve(window.kakao)
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(kakaoKey ?? '')}&autoload=false&libraries=clusterer`
    script.onload = () => window.kakao.maps.load(() => resolve(window.kakao))
    script.onerror = () => { loading = null; reject(new Error('Kakao map unavailable')) }
    document.head.appendChild(script)
  })
  return loading
}

export function located(places: MapPlace[]) {
  return places.filter((place): place is MapPlace & { latitude: number; longitude: number } => place.latitude != null && place.longitude != null)
}

/** Centre of the places that have coordinates: the fallback search origin when the browser location is refused. */
export function placesCentre(places: MapPlace[]): Origin | null {
  const points = located(places)
  if (!points.length) return null
  return { lat: points.reduce((sum, p) => sum + Number(p.latitude), 0) / points.length, lng: points.reduce((sum, p) => sum + Number(p.longitude), 0) / points.length, label: '활동 장소 중심' }
}

/** The part of the map on screen after the person moved it: its centre and the distance to a corner. */
export type MapView = { lat: number; lng: number; radiusKm: number }
type Props = { places: MapPlace[]; origin?: Origin | null; radiusKm?: number; selected?: number | null; onSelect?: (id: number | null) => void; onPick?: (lat: number, lng: number) => void; label: string
  /** 찾기 (2026-11-07): the map stays put while results change, and says where the person moved it (dragged or zoomed). */
  onMove?: (view: MapView) => void }

export function PlaceMap(props: Props) {
  const [failed, setFailed] = useState(false)
  return kakaoEnabled && !failed ? (props.onMove ? <MovingKakaoMap {...props} onFail={() => setFailed(true)} /> : <KakaoMap {...props} onFail={() => setFailed(true)} />) : <SketchMap {...props} />
}

const levelFor = (radiusKm: number | undefined, near: boolean) => near ? (radiusKm && radiusKm > 5 ? 7 : radiusKm && radiusKm > 2 ? 6 : 5) : 6

/** Straight-line distance in km (good enough for a few km on a phone map). */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = (a.lat - b.lat) * 111, dLng = (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

/**
 * One Kakao map that is made once and kept: pins and the radius circle are redrawn on it, so new results do not throw the
 * person's view away. When the person drags or zooms, {@code onMove} gets the view 0.6 s after the map stops.
 */
function MovingKakaoMap({ places, origin, radiusKm, selected, onSelect, onMove, label, onFail }: Props & { onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<any>(null)
  const [kakao, setKakao] = useState<any>(null)
  const choose = useRef(onSelect), move = useRef(onMove), fail = useRef(onFail)
  choose.current = onSelect; move.current = onMove; fail.current = onFail
  // Moves made by the code (centring on 내 위치, fitting the pins) are not the person's and do not ask for new results.
  const quiet = useRef(false), touched = useRef(false), movedEver = useRef(false), fitted = useRef(false)
  const start = useRef({ origin, places, radiusKm })
  useEffect(() => {
    let cancelled = false, timer = 0
    loadKakao().then(k => {
      if (cancelled || !box.current) return
      const { origin: o, places: p, radiusKm: r } = start.current
      const centre = o ?? placesCentre(p) ?? { lat: 37.8, lng: 127.08 }
      const made = new k.maps.Map(box.current, { center: new k.maps.LatLng(centre.lat, centre.lng), level: levelFor(r, Boolean(o)) })
      map.current = made
      const mark = () => { if (!quiet.current) { touched.current = true; movedEver.current = true } }
      k.maps.event.addListener(made, 'dragend', mark)
      k.maps.event.addListener(made, 'zoom_changed', mark)
      k.maps.event.addListener(made, 'idle', () => {
        if (!touched.current) return
        touched.current = false
        window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          const c = made.getCenter(), ne = made.getBounds().getNorthEast()
          const at = { lat: c.getLat(), lng: c.getLng() }
          move.current?.({ ...at, radiusKm: kmBetween(at, { lat: ne.getLat(), lng: ne.getLng() }) })
        }, 600)
      })
      setKakao(k)
    }).catch(() => fail.current())
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [])
  const quietly = (work: () => void) => { quiet.current = true; try { work() } finally { window.setTimeout(() => { quiet.current = false }, 0) } }

  // 내 위치 and its circle: centred again when it changes (unless the person has moved the map since).
  useEffect(() => {
    if (!kakao || !map.current || !origin) return
    const position = new kakao.maps.LatLng(origin.lat, origin.lng)
    if (!movedEver.current) quietly(() => { map.current.setLevel(levelFor(radiusKm, true)); map.current.setCenter(position) })
    const drawn: any[] = [new kakao.maps.CustomOverlay({ map: map.current, position, content: '<span class="map-origin">●</span>' })]
    if (radiusKm) drawn.push(new kakao.maps.Circle({ map: map.current, center: position, radius: radiusKm * 1000, strokeWeight: 2, strokeColor: '#2f6b4f', strokeOpacity: 0.7, fillColor: '#2f6b4f', fillOpacity: 0.08 }))
    return () => drawn.forEach(item => item.setMap(null))
  }, [kakao, origin, radiusKm])

  useEffect(() => {
    if (!kakao || !map.current) return
    const drawn: any[] = []
    const bounds = new kakao.maps.LatLngBounds()
    const markers = located(places).map(place => {
      const position = new kakao.maps.LatLng(place.latitude, place.longitude)
      const big = selected === place.id
      const image = place.tone ? new kakao.maps.MarkerImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pinSvg(toneColour[place.tone], big)),
        new kakao.maps.Size(big ? 36 : 28, big ? 36 : 28), { offset: new kakao.maps.Point(big ? 18 : 14, big ? 34 : 26) }) : undefined
      const marker = new kakao.maps.Marker({ position, title: place.name, image, zIndex: big ? 3 : place.tone === 'local' ? 2 : 1 })
      kakao.maps.event.addListener(marker, 'click', () => choose.current?.(place.id))
      bounds.extend(position)
      return marker
    })
    if (markers.length >= 12 && kakao.maps.MarkerClusterer) {
      const clusterer = new kakao.maps.MarkerClusterer({ map: map.current, averageCenter: true, minLevel: 5, gridSize: 50, disableClickZoom: false,
        styles: [{ width: '40px', height: '40px', lineHeight: '40px', borderRadius: '20px', background: 'rgba(47, 111, 82, 0.88)', color: '#fff', textAlign: 'center', fontWeight: '700', fontSize: '14px', border: '2px solid #fff' }] })
      clusterer.addMarkers(markers)
      drawn.push({ setMap: () => clusterer.clear() })
    } else markers.forEach(marker => { marker.setMap(map.current); drawn.push(marker) })
    // Without 내 위치: fit the first pins once, never after the person has moved the map.
    if (!origin && !fitted.current && !movedEver.current && !bounds.isEmpty()) {
      fitted.current = true
      quietly(() => { map.current.setBounds(bounds); if (map.current.getLevel() > 8) map.current.setLevel(8) })
    }
    return () => drawn.forEach(item => item.setMap(null))
  }, [kakao, places, selected, origin])
  return <div ref={box} className="kakao-map" role="img" aria-label={label} />
}

function KakaoMap({ places, origin, radiusKm, selected, onSelect, onPick, label, onFail }: Props & { onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const pick = useRef(onPick)
  const choose = useRef(onSelect)
  const fail = useRef(onFail)
  pick.current = onPick
  choose.current = onSelect
  fail.current = onFail
  const pickable = Boolean(onPick)
  useEffect(() => {
    let cancelled = false
    const drawn: any[] = []
    loadKakao().then(kakao => {
      if (cancelled || !box.current) return
      const points = located(places)
      const centre = origin ?? placesCentre(places) ?? { lat: 37.8, lng: 127.08, label: '' }
      // Around me: a close view (level 5, about a few km across); otherwise fit the pins, but never zoomed out past a city.
      const map = new kakao.maps.Map(box.current, { center: new kakao.maps.LatLng(centre.lat, centre.lng), level: origin ? (radiusKm && radiusKm > 5 ? 7 : radiusKm && radiusKm > 2 ? 6 : 5) : 6 })
      const bounds = new kakao.maps.LatLngBounds()
      const markers: any[] = []
      for (const place of points) {
        const position = new kakao.maps.LatLng(place.latitude, place.longitude)
        const big = selected === place.id
        // A data-URL image needs xmlns, or Android WebView shows a broken image.
        const image = place.tone ? new kakao.maps.MarkerImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pinSvg(toneColour[place.tone], big)),
          new kakao.maps.Size(big ? 36 : 28, big ? 36 : 28), { offset: new kakao.maps.Point(big ? 18 : 14, big ? 34 : 26) }) : undefined
        const marker = new kakao.maps.Marker({ position, title: place.name, image, zIndex: big ? 3 : place.tone === 'local' ? 2 : 1, opacity: place.tone || selected == null || big ? 1 : 0.5 })
        kakao.maps.event.addListener(marker, 'click', () => choose.current?.(place.id))
        markers.push(marker)
        bounds.extend(position)
      }
      // Many pins: grouped into numbered circles that split when zoomed in (the selected one always stays on its own).
      if (markers.length >= 12 && kakao.maps.MarkerClusterer) {
        const clusterer = new kakao.maps.MarkerClusterer({ map, averageCenter: true, minLevel: 5, gridSize: 50, disableClickZoom: false,
          styles: [{ width: '40px', height: '40px', lineHeight: '40px', borderRadius: '20px', background: 'rgba(47, 111, 82, 0.88)', color: '#fff', textAlign: 'center', fontWeight: '700', fontSize: '14px', border: '2px solid #fff' }] })
        clusterer.addMarkers(markers)
        drawn.push({ setMap: () => clusterer.clear() })
      } else markers.forEach(marker => { marker.setMap(map); drawn.push(marker) })
      if (origin) {
        const position = new kakao.maps.LatLng(origin.lat, origin.lng)
        if (radiusKm) drawn.push(new kakao.maps.Circle({ map, center: position, radius: radiusKm * 1000, strokeWeight: 2, strokeColor: '#2f6b4f', strokeOpacity: 0.7, fillColor: '#2f6b4f', fillOpacity: 0.08 }))
        drawn.push(new kakao.maps.CustomOverlay({ map, position, content: '<span class="map-origin">●</span>' }))
      }
      if (!bounds.isEmpty() && !origin) {
        map.setBounds(bounds)
        if (map.getLevel() > 8) map.setLevel(8)
      }
      if (pickable) kakao.maps.event.addListener(map, 'click', (event: any) => pick.current?.(event.latLng.getLat(), event.latLng.getLng()))
    }).catch(() => fail.current())
    return () => { cancelled = true; drawn.forEach(item => item.setMap(null)) }
  }, [places, origin, radiusKm, selected, pickable])
  return <div ref={box} className="kakao-map" role="img" aria-label={label} />
}

/** No key (or Kakao blocked): pins at their relative positions, so the shape is still right. Not a real map. */
function SketchMap({ places, origin, selected, onSelect, label }: Props) {
  const points = [...located(places).map(p => ({ id: p.id as number | null, name: p.name, lat: Number(p.latitude), lng: Number(p.longitude) })),
    ...(origin ? [{ id: null, name: origin.label, lat: origin.lat, lng: origin.lng }] : [])]
  const lats = points.map(p => p.lat), lngs = points.map(p => p.lng)
  const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
  const x = (lng: number) => east === west ? 50 : 12 + (lng - west) / (east - west) * 76
  const y = (lat: number) => north === south ? 50 : 12 + (north - lat) / (north - south) * 76
  return <div className="map-canvas" role="img" aria-label={label}>
    {points.map(point => point.id === null
      ? <span key="origin" className="map-origin-pin" style={{ left: x(point.lng) + '%', top: y(point.lat) + '%' }} title={point.name} />
      : <button key={point.id} type="button" className={'map-pin' + (selected === point.id ? ' selected' : '') + (places.find(p => p.id === point.id)?.tone === 'program' ? ' program' : '')} style={{ left: x(point.lng) + '%', top: y(point.lat) + '%' }}
          aria-label={point.name + ' 위치'} onClick={() => onSelect?.(point.id)}>{places.findIndex(p => p.id === point.id) + 1}</button>)}
    {!points.length && <span className="map-empty">장소 좌표가 아직 입력되지 않았습니다.</span>}
  </div>
}
