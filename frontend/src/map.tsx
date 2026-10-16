// Map panel: Kakao Maps when VITE_KAKAO_JS_KEY is set (domain-restricted public key), otherwise a simple relative-position drawing.
import { useEffect, useRef, useState } from 'react'

export type MapPlace = { id: number; name: string; latitude: number | null; longitude: number | null; meetingPoint?: string | null }
export type Origin = { lat: number; lng: number; label: string }

declare global {
  interface Window { kakao?: any }
}

const kakaoKey = import.meta.env.VITE_KAKAO_JS_KEY
export const kakaoEnabled = Boolean(kakaoKey)
let loading: Promise<any> | null = null

function loadKakao(): Promise<any> {
  if (window.kakao?.maps?.LatLng) return Promise.resolve(window.kakao)
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(kakaoKey ?? '')}&autoload=false`
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

type Props = { places: MapPlace[]; origin?: Origin | null; radiusKm?: number; selected?: number | null; onSelect?: (id: number | null) => void; onPick?: (lat: number, lng: number) => void; label: string }

export function PlaceMap(props: Props) {
  const [failed, setFailed] = useState(false)
  return kakaoEnabled && !failed ? <KakaoMap {...props} onFail={() => setFailed(true)} /> : <SketchMap {...props} />
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
      const map = new kakao.maps.Map(box.current, { center: new kakao.maps.LatLng(centre.lat, centre.lng), level: 6 })
      const bounds = new kakao.maps.LatLngBounds()
      for (const place of points) {
        const position = new kakao.maps.LatLng(place.latitude, place.longitude)
        const marker = new kakao.maps.Marker({ map, position, title: place.name, opacity: selected == null || selected === place.id ? 1 : 0.5 })
        kakao.maps.event.addListener(marker, 'click', () => choose.current?.(place.id))
        drawn.push(marker)
        bounds.extend(position)
      }
      if (origin) {
        const position = new kakao.maps.LatLng(origin.lat, origin.lng)
        drawn.push(new kakao.maps.Circle({ map, center: position, radius: (radiusKm ?? 3) * 1000, strokeWeight: 2, strokeColor: '#2f6b4f', strokeOpacity: 0.7, fillColor: '#2f6b4f', fillOpacity: 0.08 }))
        drawn.push(new kakao.maps.CustomOverlay({ map, position, content: '<span class="map-origin">●</span>' }))
        bounds.extend(position)
      }
      if (!bounds.isEmpty() && !origin) map.setBounds(bounds)
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
      : <button key={point.id} type="button" className={'map-pin' + (selected === point.id ? ' selected' : '')} style={{ left: x(point.lng) + '%', top: y(point.lat) + '%' }}
          aria-label={point.name + ' 위치'} onClick={() => onSelect?.(point.id)}>{places.findIndex(p => p.id === point.id) + 1}</button>)}
    {!points.length && <span className="map-empty">장소 좌표가 아직 입력되지 않았습니다.</span>}
  </div>
}
