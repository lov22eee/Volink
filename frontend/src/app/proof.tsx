// 실적확인서 OCR (week 7, 2026-11-09; first made 11-07, taken out in #48): a 1365 자원봉사활동 확인서 — a PDF (its text is read
// as is, exact) or a photo of it (read on the phone, may be wrong). What was read is marked on the page, the person checks and
// fixes it, and it goes to the waiting 1365 record with the same day and name (실적 확인 대기 → 실적확인서 있음), or a new one.
// Files never leave the phone; only the values are sent. Shown as ‘실적확인서 있음’, never as checked by Volink.
import { useEffect, useRef, useState } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { ReactNode } from 'react'
import { api, ApiError } from '../api'
import { showToast } from '../App'
import { DateField } from './host'
import { MIcon, Sheet, TextInput } from './ui'
import type { ExternalRecord } from './record'

/**
 * 종이 확인서 스캔하기 (2026-11-12, user decision): Google's document scanner on the phone (ML Kit, through Google Play
 * services, no key) finds the paper's edges, takes the shot by itself and flattens it; the page comes back as a JPEG.
 */
const scanner = registerPlugin<{ scan(): Promise<{ jpeg: string }> }>('VolinkScanner')
type Word = { text: string; x0: number; x1: number }
type Line = { text: string; x: number; y: number; w: number; h: number; words?: Word[] }
type Page = { text: string; lines: Line[]; preview: string; width: number; height: number }
export type ProofKind = 'total' | 'one' | 'page' | 'none'
export type ProofRead = { kind: ProofKind; title: string; from: string; to: string; minutes: number | null; count: number | null; used: number[] }

/** 1365 나의 봉사 › 봉사참여 실적 (the same page 1365에서 가져오기 opens; its tabs lead to 실적확인서). */
const PAGE_1365_RECORDS = 'https://www.1365.go.kr/vols/1472178091420/mypage/partcptnAcmslt.do'
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d)
const compact = (s: string) => s.replace(/\s+/g, '')
const DATE = /(20\d{2}|19\d{2})(?:\s*[.,\-/년]\s*|(?=\d{2}[.,\-/월]))(\d{1,2})\s*[.,\-/월]\s*(\d{1,2})/g
/** Photo slips inside a date: 7월 read as ?월 or ㄱ월, 5월 as 5원, 0 as O. */
const dayText = (s: string) => s.replace(/(\d{4}\s*[.,\-/년]\s*)[?ㄱ](?=\s*[.,\-/월])/g, '$17').replace(/(\d)\s*원(?=\s*\d{1,2}\s*일)/g, '$1월').replace(/(?<=\d)[Oo](?=\d)/g, '0')
const dates = (raw: string) => {
  const s = dayText(raw)
  const out = [...s.matchAll(new RegExp(DATE.source, 'g'))].map(m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`)
  // "2025년 9월 10일 ~ 9월 10일": the second day without its year takes the first one's.
  const tail = out.length === 1 ? /[~∼〜-]\s*(\d{1,2})\s*[.월/]\s*(\d{1,2})\s*일?/.exec(s.slice(s.search(DATE) + 6)) : null
  if (tail) out.push(`${out[0].slice(0, 4)}-${tail[1].padStart(2, '0')}-${tail[2].padStart(2, '0')}`)
  return out
}
const after = (line: string) => line.replace(/^[^:：]*[:：]/, '').replace(/^[\s■□▪•·\-=ㅁ]+/, '').trim()

/**
 * What kind of 1365 paper this is, and its values. 자원봉사활동 확인서 sums a period (활동기간 · 총 N시간 M분 · N회 · ○○ 외 N건);
 * a one-activity 확인서 has 활동명·날짜·인정시간, either as label: value rows or as a table (a header row, then a row per activity);
 * the 1365 실적 page (님의 시간인증형 봉사시간) is pointed to 1365에서 가져오기.
 * The 발급일 at the bottom is never taken as the activity day. Values not found stay empty (the person fills them from the paper).
 * A photo read on the phone often breaks a label (활동내용 → 황통내용, 8회 → 8획): a label is also found by its last two letters
 * at the start of a line (기간·시간·횟수·내용·일자), and the shape of the value is enough on its own (총 46 시간 · 총 8회 · 기간 + a year).
 */
export function readProof(text: string, lines: string[] = text.split('\n'), words?: (Word[] | undefined)[]): ProofRead {
  const all = compact(text)
  const read: ProofRead = { kind: 'none', title: '', from: '', to: '', minutes: null, count: null, used: [] }
  if (/님의시간인증형봉사시간|시간인증형자원봉사참여|봉사참여실적/.test(all) && !/확인서/.test(all)) return { ...read, kind: 'page' }
  const find = (re: RegExp) => lines.findIndex(l => re.test(fixed(l)))
  const minutesIn = (s: string) => { const m = /(\d{1,5})시간(?:(\d{1,2})분)?/.exec(fixed(s).replace(/[()（）[\]]/g, '')); return m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : null }
  const or = (i: number, re: RegExp) => i >= 0 ? i : find(re)

  // A table: a header row naming 3 or more columns, then one row per activity (values placed under their header by position).
  const header = words ? lines.findIndex((_, i) => columnsOf(words[i] ?? []).length > 0) : -1
  if (header >= 0) {
    const cols = columnsOf(words![header]!)
    const rows: Record<string, string>[] = [], at: number[] = []
    let skipped = 0
    for (let i = header + 1; i < lines.length && rows.length < 50; i++) {
      const row = cellsOf(words![i] ?? [], cols)
      // A smudged line between two rows is skipped; two in a row end the table.
      if (!row.day && !row.time) { if (rows.length && ++skipped > 1) break; continue }
      skipped = 0
      rows.push(row); at.push(i)
    }
    if (rows.length) {
      read.used.push(header, ...at)
      const days = rows.flatMap(r => dates(r.day ?? ''))
      const times = rows.map(r => minutesIn(r.time ?? '')).filter((m): m is number => m != null)
      const title = (rows[0].title ?? '').replace(/^[\s|_\-.,:;'"`~!]+|[\s|_\-.,:;'"`~!]+$/g, '').slice(0, 120)
      read.minutes = times.length ? times.reduce((x, y) => x + y, 0) : null
      if (rows.length === 1) { read.kind = 'one'; read.title = title; read.to = days[0] ?? '' }
      else {
        const sorted = [...days].sort()
        read.kind = 'total'; read.count = rows.length; read.from = sorted[0] ?? ''; read.to = sorted[sorted.length - 1] ?? ''
        read.title = title ? `${title} 외 ${rows.length - 1}건` : ''
      }
      return read
    }
  }

  // Label rows. On paper the label and its value may share a line or not (a PDF keeps a tall row's lines apart), the label
  // may come out letter by letter (봉 사 활 동 내 용) and the footer has the 발급일: so the body is everything above
  // "위와 같이 … 확인합니다", a value missing from its label's line is looked for in the body by its shape.
  const end = lines.findIndex(l => /위와같이|확인합니다|증명합니다|확인함|위사실/.test(compact(l)))
  const body = (end > 0 ? lines.slice(0, end) : lines).map((l, i) => ({ l, i })).filter(x => !/생년월일|주민|출생|발급|전화|연락처/.test(compact(x.l)))
  const period = or(or(find(/활동기간|봉사기간|활동일시|활동일자|봉사일자|봉사활동일자|활동일|봉사일/), new RegExp('^[^\\d]{0,4}(기간|일자|일시)')), /기간.*(19|20)\d{2}/)
  const time = or(or(find(/활동시간|봉사시간|인정시간/), new RegExp('^[^\\d]{0,4}시간(?![가-힣])')), /[총층]\d{1,5}시간/)
  const count = or(or(find(/활동횟수|봉사횟수/), new RegExp('^[^\\d]{0,4}횟수')), /[총층]\d{1,4}회/)
  const content = or(find(/활동내용|봉사내용|봉사활동명|활동명|봉사명|프로그램명/), new RegExp('^[^\\d]{0,4}내용'))
  if (period < 0 && time < 0 && count < 0 && content < 0 && !/확인서/.test(all)) return read

  let days = period >= 0 ? dates(lines[period]) : []
  let dayAt = period
  if (!days.length) { const hit = body.find(x => dates(x.l).length); if (hit) { days = dates(hit.l); dayAt = hit.i } }
  if (days.length) { read.from = days.length > 1 ? days[0] : ''; read.to = days[days.length > 1 ? 1 : 0]; read.used.push(dayAt) }
  let minutes = time >= 0 ? minutesIn(lines[time]) : null, timeAt = time
  if (minutes == null) { const hit = body.find(x => minutesIn(x.l) != null); if (hit) { minutes = minutesIn(hit.l); timeAt = hit.i } }
  if (minutes != null) { read.minutes = minutes; if (!read.used.includes(timeAt)) read.used.push(timeAt) }
  if (count >= 0) { const m = /(\d{1,4})(회|건)/.exec(fixed(lines[count])); read.count = m ? Number(m[1]) : null; read.used.push(count) }
  if (content >= 0) {
    let title = valueOf(lines[content])
    // The value on the next line (the label alone on its line).
    if (!title && lines[content + 1] && !labelOf(lines[content + 1])) { title = clean(lines[content + 1]); read.used.push(content + 1) }
    title = title.replace(/(\d)\s+(건|회)/g, '$1$2').replace(/\s[의외왜]\s*(\d+건)$/, ' 외 $1')
    // "○○ 외 ?건" with the number smudged: 총 N회 says it is N - 1 more.
    if (read.count && read.count > 1) title = title.replace(/\s[의외왜]\s*[^\d\s]{0,2}\s*[건견]$/, ` 외 ${read.count - 1}건`)
    read.title = title.slice(0, 120)
    read.used.push(content)
  }
  read.kind = (read.from && read.from !== read.to) || count >= 0 || /자원봉사활동확인서/.test(all) ? 'total' : 'one'
  if (read.kind === 'one' && read.from === read.to) read.from = ''
  return read
}

/** Common OCR slips on these papers, fixed before matching (spaces dropped). */
const fixed = (s: string) => compact(s).replace(/(\d)[획휘]/g, '$1회').replace(/내[욕옹움]/g, '내용').replace(/(활동|봉사)[대네]용/g, '$1내용').replace(/시[갑관]/g, '시간')

const LABEL = /^[^\d가-힣]{0,3}(?:[가-힣]{0,4}?)(활동내용|봉사내용|봉사활동명|활동명|봉사명|프로그램명|내용)/
/** The label a line starts with, letters counted without spaces (봉 사 활 동 내 용 → 봉사활동내용), or null. */
function labelOf(line: string) { const m = LABEL.exec(fixed(line)); return m ? m[0] : null }
const clean = (s: string) => s.replace(/^[\s■□▪•·\-=ㅁ|_.,:;'"`~!]+/, '').replace(/[\s|…。、_]+$/, '').trim()
/** The value after a label: after ':' if there is one, else after the label's letters (spaces in between ignored). */
function valueOf(line: string) {
  if (/[:：]/.test(line)) return clean(after(line))
  const label = labelOf(line)
  if (!label) return clean(line.trim().replace(/^\S+\s*/, ''))
  let n = 0, i = 0
  for (; i < line.length && n < label.length; i++) if (!/\s/.test(line[i])) n++
  return clean(line.slice(i))
}

type Column = { kind: 'no' | 'day' | 'org' | 'title' | 'time'; x: number }
const KINDS: [Column['kind'], RegExp][] = [['no', /번호|순번|연번/], ['day', /[일입]자|날짜|일시|기간/], ['time', /시간/], ['org', /기관|단체|봉사처|센터/], ['title', /내용|활동명|봉사명|프로그램/]]
/** The columns a header row names (by their last letters, so 활롱일자 is still 일자), at each word's middle; [] if fewer than 3. */
function columnsOf(words: Word[]): Column[] {
  const cols: Column[] = []
  for (const w of joined(words)) {
    const t = fixed(w.text)
    const kind = KINDS.find(([, re]) => re.test(t))?.[0]
    if (kind && !cols.some(c => c.kind === kind)) cols.push({ kind, x: (w.x0 + w.x1) / 2 })
  }
  return cols.filter(c => c.kind !== 'no').length >= 3 ? cols : []
}
/** A header word read letter by letter (기 관) joined back: words closer than about one letter apart. */
function joined(words: Word[]): Word[] {
  const sorted = [...words].sort((a, b) => a.x0 - b.x0)
  const letter = sorted.length ? Math.min(...sorted.map(w => (w.x1 - w.x0) / Math.max(1, w.text.length))) : 0
  const out: Word[] = []
  for (const w of sorted) {
    const last = out[out.length - 1]
    if (last && w.x0 - last.x1 < letter * 1.2) out[out.length - 1] = { text: last.text + w.text, x0: last.x0, x1: Math.max(last.x1, w.x1) }
    else out.push({ ...w })
  }
  return out
}
/** One table row: each word goes under the nearest column; a 날짜 or 시간 that does not look like one is dropped. */
function cellsOf(words: Word[], cols: Column[]): Record<string, string> {
  const row: Record<string, string> = {}
  for (const w of words) {
    const mid = (w.x0 + w.x1) / 2
    const col = cols.reduce((best, c) => Math.abs(c.x - mid) < Math.abs(best.x - mid) ? c : best)
    row[col.kind] = row[col.kind] ? row[col.kind] + ' ' + w.text : w.text
  }
  if (row.day && !dates(row.day).length) delete row.day
  if (row.time && !/\d시간/.test(fixed(row.time))) delete row.time
  return row
}

/** PDF: the text as it is in the file (exact) and its position on page 1, which is drawn as the preview. */
export async function readPdf(file: File): Promise<Page> {
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
    if (same) { const right = Math.max(same.x + same.w, x + w); same.x = Math.min(same.x, x); same.w = right - same.x; same.text += (x > same.x + 2 ? ' ' : '') + item.str; same.words!.push({ text: item.str, x0: x, x1: x + w }) }
    else lines.push({ text: item.str, x, y: y - h, w, h, words: [{ text: item.str, x0: x, x1: x + w }] })
  }
  lines.sort((a, b) => a.y - b.y || a.x - b.x)
  let text = lines.map(l => l.text).join('\n')
  for (let n = 2; n <= Math.min(doc.numPages, 3); n++) text += '\n' + ((await (await doc.getPage(n)).getTextContent()).items as { str: string }[]).map(i => i.str).join(' ')
  return { text, lines, preview: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height }
}

/**
 * Photo: read on the phone (Korean OCR, downloaded once). Slow on old phones and may be wrong; the person checks.
 * A 확인서 is a table, and its cell borders made the OCR read the cells as noise (only the text outside the table came out):
 * so the photo is made larger, turned black-and-white against its own neighbourhood (shadow, uneven light) and the long
 * straight lines are wiped before reading. The preview still shows the photo as taken.
 */
export async function readPhoto(file: File): Promise<Page> {
  const url = URL.createObjectURL(file)
  const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url })
  const scale = 2000 / Math.max(img.width, img.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale)
  const g = canvas.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(img, 0, 0, canvas.width, canvas.height)
  URL.revokeObjectURL(url)
  const straight = deskew(canvas)
  const preview = straight.toDataURL('image/jpeg', 0.8)
  wipeTable(straight)
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('kor')
  try {
    const data = (await worker.recognize(straight, {}, { blocks: true, text: true })).data
    const lines: Line[] = (data.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines))
      .map(l => ({ text: l.text.trim(), x: l.bbox.x0, y: l.bbox.y0, w: l.bbox.x1 - l.bbox.x0, h: l.bbox.y1 - l.bbox.y0,
        words: l.words.map(w => ({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1 })) }))
    return { text: data.text, lines, preview, width: straight.width, height: straight.height }
  } finally { await worker.terminate() }
}

/**
 * A photo taken at a slant: find the angle (-8°…8°) at which the dark pixels line up in the most distinct rows (text lines and
 * table lines are straight then) and turn the picture back by it. Done on a small copy; returns the original when it is straight.
 */
export function deskew(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const k = Math.min(1, 700 / canvas.width)
  const sw = Math.round(canvas.width * k), sh = Math.round(canvas.height * k)
  const small = document.createElement('canvas'); small.width = sw; small.height = sh
  const sg = small.getContext('2d')!; sg.drawImage(canvas, 0, 0, sw, sh)
  const px = sg.getImageData(0, 0, sw, sh).data
  let total = 0
  for (let i = 0; i < sw * sh; i++) total += px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114
  const cut = (total / (sw * sh)) * 0.72
  const xs: number[] = [], ys: number[] = []
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = (y * sw + x) * 4
    if (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 < cut) { xs.push(x); ys.push(y) }
  }
  if (xs.length < 200) return canvas
  const score = (deg: number) => {
    const a = deg * Math.PI / 180, sin = Math.sin(a), cos = Math.cos(a)
    const bins = new Float64Array(sh + sw + 2)
    for (let j = 0; j < xs.length; j++) bins[Math.round(ys[j] * cos - xs[j] * sin) + sw + 1]++
    let sum = 0; for (const b of bins) sum += b * b
    return sum
  }
  let best = 0, bestScore = score(0)
  for (let deg = -8; deg <= 8; deg += 0.5) { const v = score(deg); if (v > bestScore) { best = deg; bestScore = v } }
  for (let deg = best - 0.4; deg <= best + 0.4; deg += 0.1) { const v = score(deg); if (v > bestScore) { best = deg; bestScore = v } }
  if (Math.abs(best) < 0.3) return canvas
  const a = best * Math.PI / 180
  const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height
  const g = out.getContext('2d')!
  g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height)
  g.translate(out.width / 2, out.height / 2); g.rotate(-a); g.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
  return out
}

/** Black ink on white (each pixel against the mean around it), then long horizontal and vertical runs of ink (table lines) made white. */
export function wipeTable(canvas: HTMLCanvasElement) {
  const g = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  const image = g.getImageData(0, 0, W, H), px = image.data
  const gray = (i: number) => px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114
  const sum = new Float64Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) {
    let row = 0
    for (let x = 0; x < W; x++) { row += gray(y * W + x); sum[(y + 1) * (W + 1) + x + 1] = sum[y * (W + 1) + x + 1] + row }
  }
  const r = Math.max(8, Math.round(Math.max(W, H) / 60))
  const ink = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1)
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1)
      const mean = (sum[y1 * (W + 1) + x1] - sum[y0 * (W + 1) + x1] - sum[y1 * (W + 1) + x0] + sum[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0))
      ink[y * W + x] = gray(y * W + x) < mean - 12 ? 1 : 0
    }
  }
  const out = ink.slice()
  // A slightly tilted photo moves a line by a pixel now and then, so a run may step one row (or column) aside.
  const on = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && ink[y * W + x] === 1
  const clear = (x: number, y: number) => { if (x >= 0 && x < W && y >= 0 && y < H) out[y * W + x] = 0 }
  const longH = Math.round(W / 8), longV = Math.round(H / 30)
  for (let y = 0; y < H; y++) {
    let start = -1, gap = 0
    for (let x = 0; x <= W; x++) {
      if (x < W && (on(x, y) || on(x, y - 1) || on(x, y + 1))) { if (start < 0) start = x; gap = 0 }
      else if (start >= 0 && ++gap > 1) { const end = x - gap; if (end - start >= longH) for (let k = start; k <= end; k++) for (let d = -2; d <= 2; d++) clear(k, y + d); start = -1; gap = 0 }
    }
  }
  for (let x = 0; x < W; x++) {
    let start = -1, gap = 0
    for (let y = 0; y <= H; y++) {
      if (y < H && (on(x, y) || on(x - 1, y) || on(x + 1, y))) { if (start < 0) start = y; gap = 0 }
      else if (start >= 0 && ++gap > 1) { const end = y - gap; if (end - start >= longV) for (let k = start; k <= end; k++) for (let d = -2; d <= 2; d++) clear(x + d, k); start = -1; gap = 0 }
    }
  }
  for (let i = 0; i < W * H; i++) { const v = out[i] ? 0 : 255; px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255 }
  g.putImageData(image, 0, 0)
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
  const file = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null)
  /** The scanner on the phone; without it (the web, a phone without Google Play) the camera as before. Closing it does nothing. */
  async function scan() {
    if (!Capacitor.isNativePlatform()) { camera.current?.click(); return }
    try {
      const { jpeg } = await scanner.scan()
      const bytes = Uint8Array.from(atob(jpeg), c => c.charCodeAt(0))
      await take(new File([bytes], 'scan.jpg', { type: 'image/jpeg' }), 'photo')
    } catch (cause) {
      const code = (cause as { code?: string })?.code
      if (code !== 'CANCELED') camera.current?.click()
    }
  }
  const today = ymd(new Date())
  useEffect(() => { api<ExternalRecord[]>('/api/me/external').then(setList).catch(() => setList([])) }, [])

  async function take(file: File | undefined, kind: 'pdf' | 'photo') {
    if (!file) return
    setError('')
    if (file.size > 15 * 1024 * 1024) { setError('15MB 이하 파일만 읽을 수 있어요.'); return }
    setStep('reading'); setPhoto(kind === 'photo')
    try {
      const got = kind === 'pdf' ? await readPdf(file) : await readPhoto(file)
      const r = readProof(got.text, got.lines.map(l => l.text), got.lines.map(l => l.words))
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
    <input ref={file} type="file" accept="application/pdf,image/*" hidden onChange={event => { const f = event.target.files?.[0]; event.target.value = ''; void take(f, f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) ? 'pdf' : 'photo') }} />
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={event => take(event.target.files?.[0], 'photo')} />
  </>

  if (step === 'pick') return <Sheet title="실적확인서 넣기" onClose={onClose}>
    <div className="r-opts">
      <button type="button" className="r-opt" onClick={() => void scan()}><MIcon name="camera" size={20} /><span><b>종이 확인서 스캔하기</b><small>종이를 비추면 자동으로 찍고 반듯하게 펴요</small></span></button>
      <button type="button" className="r-opt" onClick={() => file.current?.click()}><MIcon name="record" size={20} /><span><b>파일·앨범에서 고르기</b><small>1365에서 받은 PDF나 확인서 사진</small></span></button>
    </div>
    <a className="pf-link" href={PAGE_1365_RECORDS} target="_blank" rel="noopener noreferrer"><MIcon name="outward" size={18} /><span><b>1365에서 확인서 받기</b><small>나의 봉사 › 봉사참여 실적 › 실적확인서 발급</small></span><MIcon name="chevron" size={16} /></a>
    {error && <p className="m-err" role="alert">{error}</p>}
    {inputs}
  </Sheet>
  if (step === 'reading') return <Sheet title="실적확인서" onClose={onClose}><div className="r-reading" role="status"><span className="m-spin big" />확인서를 읽고 있어요</div></Sheet>
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
    <p className="m-help">공식 실적은 1365 기준이에요.</p>
    {error && <p className="m-err" role="alert">{error}</p>}
  </Sheet>
}
