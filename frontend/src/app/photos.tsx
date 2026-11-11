// 사진 첨부 (week 7, 2026-11-09): [+] → 카메라로 찍기 / 앨범에서 고르기 (bottom sheet). The first time, why the app asks for
// photos; Android then shows its own window (on 13+ the photo picker needs no permission). Each photo is shrunk on the phone
// to 1280px and drawn again as JPEG — the camera's location data is not copied — and the server encodes it once more.
// 크게 보기: no save menu, long-press does nothing, and screenshots/recording are blocked on the phone (FLAG_SECURE).
import { Capacitor, registerPlugin } from '@capacitor/core'
import { useEffect, useRef, useState } from 'react'
import { serverUrl, uploadPhoto } from '../api'
import { showToast } from '../App'
import { MIcon, Sheet } from './ui'

export type Shot = { key: string; id?: number; url?: string; preview: string; progress: number; failed?: boolean }
const ASKED = 'volink.photo.asked'
const screen = registerPlugin<{ secure(options: { on: boolean }): Promise<void> }>('VolinkScreen')
const secure = (on: boolean) => { if (Capacitor.isNativePlatform()) void screen.secure({ on }).catch(() => {}) }

/** Shrinks to 1280px on the long side and encodes a fresh JPEG (no EXIF: location, camera). */
export async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url })
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale)
    const g = canvas.getContext('2d')!
    g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height)
    g.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode')), 'image/jpeg', 0.85))
  } finally { URL.revokeObjectURL(url) }
}

/** The photo row of a form: thumbnails (uploading → bar), × to remove, and [+ n/max] that opens the camera/album sheet. */
export function PhotoField({ shots, onChange, max }: { shots: Shot[]; onChange: (next: Shot[] | ((old: Shot[]) => Shot[])) => void; max: number }) {
  const [sheet, setSheet] = useState<null | 'pick' | 'why'>(null)
  const camera = useRef<HTMLInputElement>(null), album = useRef<HTMLInputElement>(null)
  async function take(files: FileList | null) {
    if (!files?.length) return
    const room = max - shots.length
    const list = Array.from(files).slice(0, room)
    if (files.length > room) showToast(`최대 ${max}장이에요`)
    for (const file of list) {
      const key = Math.random().toString(36).slice(2)
      const preview = URL.createObjectURL(file)
      onChange(old => [...old, { key, preview, progress: 15 }])
      try {
        const blob = await shrink(file)
        onChange(old => old.map(s => s.key === key ? { ...s, progress: 55 } : s))
        const got = await uploadPhoto(blob)
        onChange(old => old.map(s => s.key === key ? { ...s, id: got.id, url: got.url, progress: 100 } : s))
      } catch (cause) {
        onChange(old => old.map(s => s.key === key ? { ...s, failed: true, progress: 0 } : s))
        showToast('사진을 올리지 못했어요', cause instanceof Error ? cause.message : '')
      }
    }
  }
  const open = (which: 'camera' | 'album') => { setSheet(null); (which === 'camera' ? camera : album).current?.click() }
  const plus = () => { let asked = false; try { asked = localStorage.getItem(ASKED) === '1' } catch { /* ask again */ } setSheet(asked ? 'pick' : 'why') }
  return <div className="ph-field">
    {shots.map(s => <span key={s.key} className={'ph-thumb' + (s.failed ? ' bad' : '')}><img src={s.preview} alt="" />
      {s.progress < 100 && !s.failed && <i className="ph-up"><b style={{ width: s.progress + '%' }} /></i>}
      <button type="button" aria-label="사진 빼기" onClick={() => onChange(old => old.filter(x => x.key !== s.key))}><MIcon name="close" size={12} /></button></span>)}
    {shots.length < max && <button type="button" className="ph-add" onClick={plus}><MIcon name="plus" size={20} /><small>{shots.length}/{max}</small></button>}
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e => { void take(e.target.files); e.target.value = '' }} />
    <input ref={album} type="file" accept="image/jpeg,image/png,image/*" multiple hidden onChange={e => { void take(e.target.files); e.target.value = '' }} />
    {sheet === 'why' && <Sheet title="사진을 고르려면 접근 허용이 필요해요" onClose={() => setSheet(null)}
      footer={<><button type="button" className="m-btn" onClick={() => { try { localStorage.setItem(ASKED, '1') } catch { /* asked again */ } setSheet('pick') }}>계속</button>
        <button type="button" className="m-text-btn" onClick={() => setSheet(null)}>나중에</button></>}>
      <p className="m-help">고른 사진만 올라가고, 다른 사진은 보지 않아요. 사진의 위치 정보는 지우고 올려요.</p></Sheet>}
    {sheet === 'pick' && <Sheet title="사진 추가" onClose={() => setSheet(null)}>
      <div className="r-opts">
        <button type="button" className="r-opt" onClick={() => open('camera')}><MIcon name="camera" size={20} /><span><b>카메라로 찍기</b></span></button>
        <button type="button" className="r-opt" onClick={() => open('album')}><MIcon name="list" size={20} /><span><b>앨범에서 고르기</b><small>최대 {max}장 · 지금 {max - shots.length}장 더 넣을 수 있어요</small></span></button>
      </div>
      <p className="m-help">권한을 거절했다면 설정 › 앱 › Volink › 권한에서 켤 수 있어요.</p></Sheet>}
  </div>
}

/** Post photos, one or a row; tapping opens the viewer. */
export function PhotoStrip({ photos, onReport }: { photos: { id: number; url: string }[]; onReport?: (id: number) => void }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!photos.length) return null
  return <>
    <div className={'ph-strip' + (photos.length === 1 ? ' one' : '')}>{photos.map((p, i) => <button key={p.id} type="button" onClick={() => setOpen(i)} onContextMenu={e => e.preventDefault()}>
      <img src={serverUrl(p.url)} alt={`사진 ${i + 1}`} draggable={false} /></button>)}</div>
    {open !== null && <PhotoViewer photos={photos} start={open} onClose={() => setOpen(null)} onReport={onReport} />}
  </>
}

function PhotoViewer({ photos, start, onClose, onReport }: { photos: { id: number; url: string }[]; start: number; onClose: () => void; onReport?: (id: number) => void }) {
  const [at, setAt] = useState(start)
  const [menu, setMenu] = useState(false)
  const track = useRef<HTMLDivElement>(null)
  useEffect(() => { secure(true); return () => secure(false) }, [])
  useEffect(() => { track.current?.scrollTo({ left: start * (track.current?.clientWidth ?? 0) }) }, [start])
  return <div className="ph-viewer" role="dialog" aria-label="사진 크게 보기" onContextMenu={e => e.preventDefault()}>
    <div className="ph-top"><button type="button" aria-label="닫기" onClick={onClose}><MIcon name="close" size={22} /></button><span>{at + 1} / {photos.length}</span>
      {onReport ? <button type="button" aria-label="메뉴" onClick={() => setMenu(true)}><MIcon name="more" size={22} /></button> : <span />}</div>
    <div className="ph-track" ref={track} onScroll={e => setAt(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}>
      {photos.map((p, i) => <div key={p.id} className="ph-slide"><img src={serverUrl(p.url)} alt={`사진 ${i + 1}`} draggable={false} /></div>)}</div>
    {menu && onReport && <Sheet title="" onClose={() => setMenu(false)}><div className="r-opts">
      <button type="button" className="r-opt danger" onClick={() => { setMenu(false); onReport(photos[at].id) }}><MIcon name="alert" size={20} /><span><b>이 사진 신고하기</b></span></button></div></Sheet>}
  </div>
}
