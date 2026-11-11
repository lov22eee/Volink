// 실적확인서 OCR (week 7, 2026-11-09; first made 11-07, taken out in #48): a 1365 자원봉사활동 확인서 — a PDF (its text is read
// as is, exact) or a photo of it (read on the phone, may be wrong). What was read is marked on the page, the person checks and
// fixes it, and it goes to the waiting 1365 record with the same day and name (실적 확인 대기 → 실적확인서 있음), or a new one.
// Files never leave the phone; only the values are sent. Shown as ‘실적확인서 있음’, never as checked by Volink.
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError } from '../api'
import { showToast } from '../App'
import { DateField } from './host'
import { MIcon, Sheet, TextInput } from './ui'
import type { ExternalRecord } from './record'

type Line = { text: string; x: number; y: number; w: number; h: number }
type Page = { text: string; lines: Line[]; preview: string; width: number; height: number }
export type ProofKind = 'total' | 'one' | 'page' | 'none'
export type ProofRead = { kind: ProofKind; title: string; from: string; to: string; minutes: number | null; count: number | null; used: number[] }

/** 1365 나의 봉사 › 봉사참여 실적 (the same page 1365에서 가져오기 opens; its tabs lead to 실적확인서). */
const PAGE_1365_RECORDS = 'https://www.1365.go.kr/vols/1472178091420/mypage/partcptnAcmslt.do'
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d)
const compact = (s: string) => s.replace(/\s+/g, '')
const DATE = /(20\d{2}|19\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g
const dates = (s: string) => [...s.matchAll(new RegExp(DATE.source, 'g'))].map(m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`)
const after = (line: string) => line.replace(/^[^:：]*[:：]/, '').replace(/^[\s■□▪•·\-=ㅁ]+/, '').trim()

/**
 * What kind of 1365 paper this is, and its values. 자원봉사활동 확인서 sums a period (활동기간 · 총 N시간 M분 · N회 · ○○ 외 N건);
 * a one-activity 확인서 has 활동명·날짜·인정시간; the 1365 실적 page (님의 시간인증형 봉사시간) is pointed to 1365에서 가져오기.
 * The 발급일 at the bottom is never taken as the activity day. Values not found stay empty (the person fills them from the paper).
 */
export function readProof(text: string, lines: string[] = text.split('\n')): ProofRead {
  const all = compact(text)
  const read: ProofRead = { kind: 'none', title: '', from: '', to: '', minutes: null, count: null, used: [] }
  if (/님의시간인증형봉사시간|시간인증형자원봉사참여|봉사참여실적/.test(all) && !/확인서/.test(all)) return { ...read, kind: 'page' }
  const find = (re: RegExp) => lines.findIndex(l => re.test(compact(l)))
  const minutesIn = (s: string) => { const m = /(\d{1,5})시간(?:(\d{1,2})분)?/.exec(compact(s)); return m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : null }
  // A photo read on the phone often breaks the labels (활동시간 → 출륭시간): then the shape of the value is enough
  // (총 46 시간 · 총 8회 · a line with 기간 and a year).
  const or = (i: number, re: RegExp) => i >= 0 ? i : find(re)
  const period = or(find(/활동기간|봉사기간/), /기간.*(19|20)\d{2}/)
  const time = or(find(/활동시간|봉사시간|인정시간/), /[총층]\d{1,5}시간/)
  const count = or(find(/활동횟수|봉사횟수/), /[총층]\d{1,4}회/)
  const content = find(/활동내용|봉사내용|봉사활동명|활동명|봉사명|프로그램명/)
  if (period >= 0 || count >= 0 || /자원봉사활동확인서/.test(all)) {
    read.kind = 'total'
    if (period >= 0) { const d = dates(lines[period]); read.from = d[0] ?? ''; read.to = d[1] ?? ''; read.used.push(period) }
    if (time >= 0) { read.minutes = minutesIn(lines[time]); read.used.push(time) }
    if (count >= 0) { const m = /(\d{1,4})(회|건)/.exec(compact(lines[count])); read.count = m ? Number(m[1]) : null; read.used.push(count) }
    if (content >= 0) { read.title = after(lines[content]).replace(/(\d)\s+(건|회)/g, '$1$2').slice(0, 120); read.used.push(content) }
    return read
  }
  if (content >= 0 || time >= 0) {
    read.kind = 'one'
    if (content >= 0) { read.title = after(lines[content]).slice(0, 120); read.used.push(content) }
    const day = find(/활동일|봉사일|활동일자|봉사일자/)
    if (day >= 0) { read.to = dates(lines[day])[0] ?? ''; read.used.push(day) }
    if (time >= 0) { read.minutes = minutesIn(lines[time]); read.used.push(time) }
  }
  return read
}

/** PDF: the text as it is in the file (exact) and its position on page 1, which is drawn as the preview. */
async function readPdf(file: File): Promise<Page> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: 1.6 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
  const lines: Line[] = []
  for (const item of (await page.getTextContent()).items as { str: string; transform: number[]; width: number }[]) {
    if (!item.str.trim()) continue
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
    const h = Math.hypot(item.transform[2], item.transform[3]) * viewport.scale
    const w = item.width * viewport.scale
    const same = lines.find(l => Math.abs(l.y + l.h - y) < h * 0.5)
    if (same) { const right = Math.max(same.x + same.w, x + w); same.x = Math.min(same.x, x); same.w = right - same.x; same.text += (x > same.x + 2 ? ' ' : '') + item.str }
    else lines.push({ text: item.str, x, y: y - h, w, h })
  }
  lines.sort((a, b) => a.y - b.y || a.x - b.x)
  let text = lines.map(l => l.text).join('\n')
  for (let n = 2; n <= Math.min(doc.numPages, 3); n++) text += '\n' + ((await (await doc.getPage(n)).getTextContent()).items as { str: string }[]).map(i => i.str).join(' ')
  return { text, lines, preview: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height }
}

/** Photo: read on the phone (Korean OCR, downloaded once). Slow on old phones and may be wrong; the person checks. */
async function readPhoto(file: File): Promise<Page> {
  const url = URL.createObjectURL(file)
  const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url })
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  URL.revokeObjectURL(url)
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('kor')
  try {
    const data = (await worker.recognize(canvas, {}, { blocks: true, text: true })).data
    const lines: Line[] = (data.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines))
      .map(l => ({ text: l.text.trim(), x: l.bbox.x0, y: l.bbox.y0, w: l.bbox.x1 - l.bbox.x0, h: l.bbox.y1 - l.bbox.y0 }))
    return { text: data.text, lines, preview: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height }
  } finally { await worker.terminate() }
}

const message = (cause: unknown) => cause instanceof ApiError ? (Object.values(cause.fieldErrors)[0] ?? cause.message) : '잠시 후 다시 시도해 주세요.'
const key = (s: string) => s.replace(/[\s\[\]()·.,\-_]/g, '').toLowerCase()
const near = (a: string, b: string) => { const x = key(a), y = key(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)) }

/** The waiting record this certificate is for: the same day (or inside its period) and a name like it. */
export function matchRecord(read: ProofRead, list: ExternalRecord[]): ExternalRecord | null {
  const day = read.to || read.from
  const open = list.filter(r => !r.certified && !r.extKind && (r.status === 'PLANNED' || r.status === 'ATTENDED'))
  const inside = (r: ExternalRecord) => read.from && read.to ? r.date >= read.from && r.date <= read.to : r.date === day
  return open.find(r => inside(r) && near(r.title, read.title)) ?? open.find(r => r.date === day && read.kind === 'one') ?? null
}

/**
 * 실적확인서로 확인하기 (13): pick a 확인서 (PDF / photo / album), see what was read marked on it, fix a wrong value, then it goes
 * to {@code record} (from its page) or to the waiting record found by day and name — or a new 1365 record.
 */
export function ProofSheet({ record, onClose, onSaved, onUse1365 }: { record?: ExternalRecord; onClose: () => void; onSaved: (saved: ExternalRecord) => void; onUse1365?: () => void }) {
  const [step, setStep] = useState<'pick' | 'reading' | 'check' | 'page' | 'none' | 'same'>('pick')
  const [page, setPage] = useState<Page | null>(null)
  const [photo, setPhoto] = useState(false)
  const [read, setRead] = useState<ProofRead | null>(null)
  const [hours, setHours] = useState(''), [mins, setMins] = useState('')
  const [editing, setEditing] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [list, setList] = useState<ExternalRecord[]>([])
  const [target, setTarget] = useState<ExternalRecord | null | 'new'>(null)
  const [same, setSame] = useState<ExternalRecord | null>(null)
  const [choosing, setChoosing] = useState(false)
  const pdf = useRef<HTMLInputElement>(null), image = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null)
  const today = ymd(new Date())
  useEffect(() => { api<ExternalRecord[]>('/api/me/external').then(setList).catch(() => setList([])) }, [])

  async function take(file: File | undefined, kind: 'pdf' | 'photo') {
    if (!file) return
    setError('')
    if (file.size > 15 * 1024 * 1024) { setError('15MB 이하 파일만 읽을 수 있어요.'); return }
    setStep('reading'); setPhoto(kind === 'photo')
    try {
      const got = kind === 'pdf' ? await readPdf(file) : await readPhoto(file)
      const r = readProof(got.text, got.lines.map(l => l.text))
      setPage(got); setRead(r); setEditing([])
      setHours(r.minutes != null ? String(Math.floor(r.minutes / 60)) : ''); setMins(r.minutes != null ? String(r.minutes % 60) : '')
      // The same certificate again (same day, name and hours already saved): say so instead of saving twice.
      const day = r.to || r.from
      const dup = list.find(x => x.certified && x.certDate === day && near(x.certTitle ?? x.title, r.title) && (r.minutes == null || x.certMinutes === r.minutes))
      if (dup) { setSame(dup); setStep('same'); return }
      setTarget(record ?? matchRecord(r, list) ?? 'new')
      setStep(r.kind === 'page' ? 'page' : r.kind === 'none' ? 'none' : 'check')
    } catch { setStep('none') }
  }
  const minutes = (Number(hours) || 0) * 60 + (Number(mins) || 0)
  const day = read ? (read.to || read.from) : ''
  const ready = Boolean(read && read.title.trim().length >= 2 && minutes > 0 && day && day <= today)
  async function save() {
    if (!read || !ready) return
    setBusy(true); setError('')
    let made: { id: number } | null = null
    try {
      const id = target && target !== 'new' ? target.id : (made = await api<{ id: number }>('/api/me/external', 'POST', { title: read.title.trim(), date: day })).id
      const saved = await api<ExternalRecord>('/api/me/external/' + id + '/certificate', 'PUT', { title: read.title.trim(), date: day, minutes })
      showToast(target && target !== 'new' ? '실적확인서로 확인했어요' : '1365 기록에 넣었어요', '확인서 파일은 저장하지 않았어요')
      onSaved(saved)
    } catch (cause) {
      if (made) await api('/api/me/external/' + made.id, 'DELETE').catch(() => {})
      setError(message(cause))
    } finally { setBusy(false) }
  }
  const inputs = <>
    <input ref={pdf} type="file" accept="application/pdf" hidden onChange={event => take(event.target.files?.[0], 'pdf')} />
    <input ref={image} type="file" accept="image/*" hidden onChange={event => take(event.target.files?.[0], 'photo')} />
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={event => take(event.target.files?.[0], 'photo')} />
  </>

  if (step === 'pick') return <Sheet title="실적확인서 넣기" onClose={onClose}>
    <div className="r-opts">
      <button type="button" className="r-opt" onClick={() => pdf.current?.click()}><MIcon name="record" size={20} /><span><b>PDF 파일 고르기</b><small>1365에서 받은 파일 · 가장 정확해요</small></span></button>
      <button type="button" className="r-opt" onClick={() => camera.current?.click()}><MIcon name="camera" size={20} /><span><b>종이 확인서 찍기</b><small>밝은 곳에서 반듯하게</small></span></button>
      <button type="button" className="r-opt" onClick={() => image.current?.click()}><MIcon name="camera" size={20} /><span><b>앨범에서 고르기</b><small>확인서 사진·캡처</small></span></button>
    </div>
    <a className="pf-link" href={PAGE_1365_RECORDS} target="_blank" rel="noopener noreferrer"><MIcon name="outward" size={18} /><span><b>1365에서 확인서 받기</b><small>나의 봉사 › 봉사참여 실적 › 실적확인서 발급</small></span><MIcon name="chevron" size={16} /></a>
    <p className="m-help">파일은 보내지 않고 휴대폰 안에서만 읽어요.</p>
    {error && <p className="m-err" role="alert">{error}</p>}
    {inputs}
  </Sheet>
  if (step === 'reading') return <Sheet title="실적확인서" onClose={onClose}><div className="r-reading" role="status"><span className="m-spin big" />확인서를 읽고 있어요<small className="m-help">휴대폰 안에서만 읽어요</small></div></Sheet>
  if (step === 'same' && same) return <Sheet title="" onClose={onClose}
    footer={<><a className="m-btn" href={'#/record/' + same.id} onClick={onClose}>그 기록 보기</a><button type="button" className="m-btn line" onClick={onClose}>닫기</button></>}>
    <div className="apply-res done"><span className="apply-res-ico" aria-hidden="true"><MIcon name="record" size={28} /></span>
      <h3 className="m-h3">이미 넣은 확인서예요</h3>
      <div className="m-summary"><strong>{same.certTitle ?? same.title}</strong><span>{(same.certDate ?? same.date).replaceAll('-', '.')} · 실적확인서 있음</span></div></div>
  </Sheet>
  if (step === 'page') return <Sheet title="1365 실적 화면이에요" onClose={onClose}
    footer={<>{onUse1365 && <button type="button" className="m-btn" onClick={onUse1365}>1365에서 가져오기</button>}<button type="button" className="m-btn line" onClick={() => setStep('pick')}>다른 파일 고르기</button></>}>
    <p className="m-help">실적 화면은 사진으로 읽으면 숫자가 틀리기 쉬워요. 확인서 PDF나 1365에서 가져오기를 써 주세요.</p>
  </Sheet>
  if (step === 'none' || !read || !page) return <Sheet title="" onClose={onClose}
    footer={<><button type="button" className="m-btn" onClick={() => setStep('pick')}>다시 고르기</button><button type="button" className="m-btn line" onClick={onClose}>닫기</button></>}>
    <div className="apply-res missed"><span className="apply-res-ico" aria-hidden="true"><MIcon name="alert" size={28} /></span>
      <h3 className="m-h3">확인서를 읽지 못했어요</h3>
      <p className="m-help center">흐리거나 잘린 것 같아요 · 1365에서 받은 PDF가 가장 정확해요</p></div>
  </Sheet>

  const fix = (k: string) => editing.includes(k)
  const toggle = (k: string) => setEditing(editing.includes(k) ? editing.filter(x => x !== k) : [...editing, k])
  const row = (k: string, label: string, shown: string, editor: ReactNode) => <div className={'pf-val' + (!shown ? ' empty' : '')}>
    <div className="pf-val-head"><span className="pf-label">{label}</span><button type="button" className="pf-fix" onClick={() => toggle(k)}>{fix(k) ? '완료' : shown ? '고치기' : '넣기'}</button></div>
    {fix(k) ? editor : <b>{shown || '읽지 못했어요 · 확인서를 보고 넣어 주세요'}</b>}
  </div>
  const waiting = list.filter(r => !r.certified && !r.extKind && r.date <= today && (r.status === 'PLANNED' || r.status === 'ATTENDED'))
  const sameDay = target && target !== 'new' && (target.date === day || (read.from && read.to && target.date >= read.from && target.date <= read.to))
  return <Sheet title="읽은 내용 확인" onClose={onClose}
    footer={<button type="button" className="m-btn" disabled={busy || !ready} onClick={save}>{busy ? '넣는 중…' : target && target !== 'new' ? '이 기록에 저장' : '새 기록으로 추가'}</button>}>
    {photo && <p className="pf-warn"><MIcon name="alert" size={15} />사진은 잘못 읽을 수 있어요. 숫자를 확인서와 비교해 주세요.</p>}
    <div className="pf-doc" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
      <img src={page.preview} alt="읽은 확인서" />
      {read.used.map(i => page.lines[i]).filter(Boolean).map((l, k) => <i key={k} className="pf-mark"
        style={{ left: `${(l.x / page.width) * 100}%`, top: `${(l.y / page.height) * 100}%`, width: `${(l.w / page.width) * 100}%`, height: `${(l.h / page.height) * 100}%` }} />)}
    </div>
    <div className="pf-vals">
      {row('title', read.kind === 'total' ? '봉사활동 내용' : '봉사명', read.title,
        <TextInput className="m-input" maxLength={120} value={read.title} onChange={e => setRead({ ...read, title: e.target.value })} aria-label="봉사명" />)}
      {read.kind === 'total' && row('from', '활동 기간 시작', read.from ? read.from.replaceAll('-', '.') : '',
        <DateField label="활동 기간 시작" value={read.from} first="2000-01-01" last={today} onChange={date => setRead({ ...read, from: date })} />)}
      {row('to', read.kind === 'total' ? '활동 기간 끝' : '날짜', read.to ? read.to.replaceAll('-', '.') : '',
        <DateField label={read.kind === 'total' ? '활동 기간 끝' : '날짜'} value={read.to} first="2000-01-01" last={today} onChange={date => setRead({ ...read, to: date })} />)}
      {row('time', '인정 시간', minutes > 0 ? `${Number(hours) || 0}시간${Number(mins) ? ` ${Number(mins)}분` : ''}` : '',
        <div className="m-two"><TextInput className="m-input" inputMode="numeric" value={hours} onChange={e => setHours(e.target.value.replace(/\D/g, '').slice(0, 5))} aria-label="시간" placeholder="시간" />
          <TextInput className="m-input" inputMode="numeric" value={mins} onChange={e => setMins(e.target.value.replace(/\D/g, '').slice(0, 2))} aria-label="분" placeholder="분" /></div>)}
    </div>
    <h4 className="pf-to">{target && target !== 'new' ? '이 기록에 넣을게요' : '맞는 대기 기록이 없어요'}</h4>
    {target && target !== 'new' ? <div className="pf-target"><MIcon name="check" size={18} /><span><b>{target.title}</b><small>{target.date.slice(5).replace('-', '/')} · {target.status === 'PLANNED' ? '실적 확인 대기' : '다녀옴'}</small></span>{sameDay && near(target.title, read.title) && <em>날짜·이름 같음</em>}</div>
      : <p className="m-help">새 1365 기록으로 추가해요.</p>}
    {waiting.length > 0 && <button type="button" className="m-text-btn" onClick={() => setChoosing(!choosing)}>{choosing ? '닫기' : '다른 기록 고르기'}</button>}
    {choosing && <div className="r-opts">{waiting.map(r => <button key={r.id} type="button" className="r-opt" onClick={() => { setTarget(r); setChoosing(false) }}>
      <MIcon name="calendar" size={20} /><span><b>{r.title}</b><small>{r.date.slice(5).replace('-', '/')} · {r.status === 'PLANNED' ? '실적 확인 대기' : '다녀옴'}</small></span></button>)}
      <button type="button" className="r-opt" onClick={() => { setTarget('new'); setChoosing(false) }}><MIcon name="plus" size={20} /><span><b>새 기록으로 추가</b></span></button></div>}
    <p className="m-help">확인서 파일은 저장하지 않고 값만 남아요. 공식 실적은 1365 기준이에요.</p>
    {error && <p className="m-err" role="alert">{error}</p>}
  </Sheet>
}
