// 기관 확인 서류 (2026-11-12, 선택): 고유번호증·사업자등록증 같은 파일. PDF·JPG·PNG, 10MB, 3개까지.
// The manager adds them at sign-up or on the 심사 현황 page; the manager and admins open them.
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError, apiBlob, uploadFile } from '../api'
import { PcIcon } from './ui'

export type OrgDoc = { id: number; name: string; type: string; size: number; at?: string }
export const DOC_MAX = 3, DOC_BYTES = 10 * 1024 * 1024
const OK = /\.(pdf|jpe?g|png)$/i

export const sizeWord = (b: number) => b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB'
const kind = (name: string, type?: string) => (type ?? '').includes('pdf') || /\.pdf$/i.test(name) ? 'PDF' : /png/i.test(type ?? name) ? 'PNG' : 'JPG'
export function docProblem(file: File) {
  if (!OK.test(file.name) && !/^(application\/pdf|image\/(jpeg|png))$/.test(file.type)) return 'PDF·JPG·PNG 파일만 올릴 수 있어요.'
  if (file.size > DOC_BYTES) return '10MB 이하 파일만 올릴 수 있어요.'
  return ''
}
const failText = (cause: unknown) => cause instanceof ApiError ? (Object.values(cause.fieldErrors)[0] ?? cause.message) : '올리지 못했어요.'

/** Opens a document in a new tab (the file needs the signed-in person's token, so it is fetched first). */
export async function openDoc(id: number) {
  const tab = window.open('', '_blank')
  try {
    const url = URL.createObjectURL(await apiBlob('/api/org-documents/' + id))
    if (tab) tab.location.href = url; else window.location.href = url
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch { tab?.close() }
}

export function DocRow({ name, type, size, note, action }: { name: string; type?: string; size: number; note?: string; action?: ReactNode }) {
  const k = kind(name, type)
  return <div className="pc-doc"><span className={'ic ' + k.toLowerCase()}>{k}</span><span className="m"><b>{name}</b><small>{note ?? sizeWord(size)}</small></span>{action}</div>
}

/** 가입 신청 단계: files kept in the page until the account exists, then sent one by one. */
export function DocPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [over, setOver] = useState(false)
  function add(list: FileList | null) {
    if (!list) return
    let next = [...files], problem = ''
    for (const f of Array.from(list)) {
      const p = docProblem(f)
      if (p) { problem = `${f.name}: ${p}`; continue }
      if (next.length >= DOC_MAX) { problem = `서류는 ${DOC_MAX}개까지 올릴 수 있어요.`; break }
      next = [...next, f]
    }
    setError(problem); onChange(next)
  }
  return <div className="pc-f"><span id="doc-label">기관 확인 서류 <small>(선택 · 고유번호증, 사업자등록증 등)</small></span>
    {files.map((f, i) => <DocRow key={f.name + i} name={f.name} type={f.type} size={f.size}
      action={<button type="button" className="pc-doc-x" aria-label={f.name + ' 빼기'} onClick={() => onChange(files.filter((_, k) => k !== i))}>×</button>} />)}
    {files.length < DOC_MAX && <button type="button" className={'pc-drop' + (over ? ' over' : '')} aria-describedby="doc-label" onClick={() => input.current?.click()}
      onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); add(e.dataTransfer.files) }}>
      <b><PcIcon name="plus" size={14} />파일 추가</b> 또는 여기로 끌어 놓기<small>PDF·JPG·PNG · 10MB까지 · {DOC_MAX}개까지</small></button>}
    <input ref={input} id="org-docs" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" multiple hidden onChange={e => { add(e.target.files); e.target.value = '' }} />
    {error && <em role="alert">{error}</em>}
  </div>
}

/** 심사 현황: the documents already sent; more can be added (and removed) while the check is open or was rejected. */
export function MyDocs({ canEdit }: { canEdit: boolean }) {
  const [docs, setDocs] = useState<OrgDoc[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { api<OrgDoc[]>('/api/me/organization/documents').then(setDocs).catch(() => setDocs([])) }, [])
  async function add(list: FileList | null) {
    if (!list?.length) return
    setBusy(true); setError('')
    for (const f of Array.from(list)) {
      const p = docProblem(f)
      if (p) { setError(`${f.name}: ${p}`); continue }
      try { const doc = await uploadFile<OrgDoc>('/api/me/organization/documents', f); setDocs(old => [...(old ?? []), doc]) } catch (cause) { setError(failText(cause)); break }
    }
    setBusy(false)
  }
  async function remove(id: number) {
    try { await api('/api/me/organization/documents/' + id, 'DELETE'); setDocs(old => (old ?? []).filter(d => d.id !== id)) } catch (cause) { setError(failText(cause)) }
  }
  if (docs === null) return null
  return <div className="pc-f" style={{ alignSelf: 'stretch' }}><span>보낸 서류 {docs.length ? `${docs.length}개` : ''}</span>
    {docs.length === 0 && <p className="mu" style={{ fontSize: 13.5 }}>{canEdit ? '고유번호증이나 사업자등록증을 올리면 확인이 빨라져요.' : '보낸 서류가 없어요.'}</p>}
    {docs.map(d => <DocRow key={d.id} name={d.name} type={d.type} size={d.size} note={`${sizeWord(d.size)}${d.at ? ' · ' + d.at.slice(5, 10).replace('-', '월 ') + '일' : ''}`}
      action={<span className="pc-doc-act"><button type="button" className="pc-link" onClick={() => void openDoc(d.id)}>열기</button>{canEdit && <button type="button" className="pc-doc-x" aria-label={d.name + ' 지우기'} onClick={() => void remove(d.id)}>×</button>}</span>} />)}
    {canEdit && docs.length < DOC_MAX && <button type="button" className="pc-drop" disabled={busy} onClick={() => input.current?.click()}><b><PcIcon name="plus" size={14} />{busy ? '올리는 중…' : '서류 추가하기'}</b><small>PDF·JPG·PNG · 10MB까지</small></button>}
    <input ref={input} id="org-docs-more" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" multiple hidden onChange={e => { void add(e.target.files); e.target.value = '' }} />
    {error && <em role="alert">{error}</em>}
  </div>
}

/** 관리자 서랍: the organization's documents, an image shown right there, a PDF opened in a new tab. */
export function AdminDocs({ docs }: { docs: OrgDoc[] }) {
  const [preview, setPreview] = useState<{ id: number; url: string } | null>(null)
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url) }, [preview])
  const first = docs.find(d => d.type.startsWith('image/'))
  useEffect(() => { if (!first) return; let gone = false; apiBlob('/api/org-documents/' + first.id).then(b => { if (!gone) setPreview({ id: first.id, url: URL.createObjectURL(b) }) }).catch(() => {}); return () => { gone = true } }, [first?.id])
  if (!docs.length) return <div><h3>확인 서류</h3><p className="mu" style={{ fontSize: 13.5 }}>서류 없이 신청했어요.</p></div>
  return <div><h3>확인 서류 {docs.length}개</h3><div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    {docs.map(d => <DocRow key={d.id} name={d.name} type={d.type} size={d.size} action={<button type="button" className="pc-link" onClick={() => void openDoc(d.id)}>열기 ›</button>} />)}
    {preview && <img className="pc-doc-preview" src={preview.url} alt={(docs.find(d => d.id === preview.id)?.name ?? '서류') + ' 미리보기'} />}
  </div></div>
}
