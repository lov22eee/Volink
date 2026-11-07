// 1365 activities in my records (V27, 2026-11-06). Volink cannot see 1365 itself, so:
// - 본인 표시: after "1365에서 신청하기" the person says they applied (date and time), and it joins 내 활동;
// - after the day: 다녀왔어요 / 못 갔어요 → 내 발자취 → a review in the community (photo invited);
// - 실적확인서: a 1365 certificate (PDF or a picture) is read on the phone; only the values are sent, never the file;
// - 실험실 (lab, off by default): rows read from the person's own 1365 page in the app (see lab.tsx).
// Shown to others as 본인 기록 / 실적확인서 있음 — never as checked by Volink, never as official.
import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { showToast } from '../App'
import type { Program } from '../explore'
import { addToCalendar } from './cards'
import { DateField, TimeField } from './host'
import { useConnect1365, useExtMode } from './lab'
import type { ExtMode } from './lab'
import { ActionBar, dayWord, dDay, Loading, MIcon, Sheet, TextInput, TopBar } from './ui'

export type ExternalRecord = {
  id: number; programNo: string | null; title: string; organization: string | null; place: string | null
  date: string; startTime: string; endTime: string; status: 'PLANNED' | 'ATTENDED' | 'MISSED'; source: 'SELF' | 'LAB'; labStatus: string | null
  certTitle: string | null; certOrganization: string | null; certDate: string | null; certMinutes: number | null; certified: boolean; started: boolean
  reflected: boolean; timeKnown: boolean
  reviewId: number | null
}

export const SITE_1365 = 'https://www.1365.go.kr'
const message = (cause: unknown) => cause instanceof ApiError ? Object.values(cause.fieldErrors)[0] ?? cause.message : '잠시 후 다시 시도해 주세요.'
const addYear = (day: string, n = 1) => `${Number(day.slice(0, 4)) + n}${day.slice(4)}`
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d)
/** 1365 period dates come as 2026-11-12 from the server (yyyyMMdd from older caches): both are read. */
const fromCompact = (value: string | null) => !value ? null : /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null

/** "11/18 10:00" or, when 1365 showed no time, "11/18 · 시간 미정". */
export const recordWhen = (r: Pick<ExternalRecord, 'date' | 'startTime' | 'timeKnown'>) => r.date.slice(5).replace('-', '/') + (r.timeKnown === false ? ' · 시간 미정' : ' ' + r.startTime)

/** Puts a 1365 record into the phone calendar (Galaxy: the calendar's own new-event screen). */
export async function recordToCalendar(r: Pick<ExternalRecord, 'id' | 'title' | 'date' | 'startTime' | 'endTime' | 'place' | 'organization'>) {
  const minutes = Math.max(30, (new Date(`2000-01-01T${r.endTime}`).getTime() - new Date(`2000-01-01T${r.startTime}`).getTime()) / 60_000 || 120)
  const how = await addToCalendar({ id: -r.id, title: '[1365] ' + r.title, date: r.date, startTime: r.startTime, durationMinutes: minutes, placeName: r.place ?? r.organization ?? null, meetingPoint: null } as never,
    '1365 봉사 · 신청·승인·취소는 1365에서 확인해 주세요.')
  showToast(how === 'app' ? '캘린더 화면을 열었어요' : '캘린더 파일을 받았어요', how === 'app' ? '저장을 누르면 추가돼요' : '파일을 열면 캘린더에 추가돼요')
}

/** Trust word for a record: 실적확인서 있음 (values from the certificate), 1365 연결 (lab), or 본인 표시. */
export function recordTag(r: Pick<ExternalRecord, 'certified' | 'source' | 'reflected'>) {
  return r.reflected ? { text: '실적 반영됨(추정)', tone: 'blue' } : r.certified ? { text: '실적확인서 있음', tone: 'blue' } : r.source === 'LAB' ? { text: '1365 연결', tone: 'blue' } : { text: '본인 표시', tone: 'gray' }
}

export function useRecords(refresh = 0) {
  const [items, setItems] = useState<ExternalRecord[] | null>(null)
  useEffect(() => { api<ExternalRecord[]>('/api/me/external').then(setItems).catch(() => setItems([])) }, [refresh])
  return items
}

/** "1365에서 신청을 마쳤나요?": the day (inside the 1365 period) and time, then it joins 내 활동. */
export function MarkSheet({ program, onClose, onSaved, manual }: { program: Program; onClose: () => void; onSaved?: (record: ExternalRecord) => void; manual?: boolean }) {
  // manual (2026-11-07, 직접 추가하기 › 이름·날짜 직접 적기): no 1365 program, the person types the name.
  const [title, setTitle] = useState(program.title)
  const today = ymd(new Date())
  const first = fromCompact(program.periodStart), last = fromCompact(program.periodEnd)
  // A period of several days (11/12 ~ 11/30): no day is assumed; the person picks the day they go.
  const span = Boolean(first && last && first !== last)
  const [date, setDate] = useState(span ? '' : first && first > today ? first : today)
  const [calendar, setCalendar] = useState(true)
  const [start, setStart] = useState(program.beginTime ?? '10:00')
  const [end, setEnd] = useState(program.endTime ?? '12:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const outside = Boolean(date && ((first && date < first) || (last && date > last)))
  async function save() {
    setBusy(true)
    setError('')
    try {
      const record = await api<ExternalRecord>('/api/me/external', 'POST', { programNo: program.programNo || undefined, title: title.trim(), organization: program.organization,
        place: program.place, date, startTime: start, endTime: end })
      onSaved?.(record)
      onClose()
      if (calendar) await recordToCalendar(record).catch(() => showToast('내 활동에 넣었어요'))
      else showToast('내 활동에 넣었어요', '하루 전과 다녀온 뒤에 알려 드릴게요')
    } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }
  return <Sheet title={manual ? '신청한 활동 넣기' : '1365에서 신청을 마쳤나요?'} onClose={onClose}
    footer={<><button type="button" className="m-btn" disabled={busy || !date || title.trim().length < 2} onClick={save}>{!date ? '참여하는 날을 골라 주세요' : manual ? '참여 예정에 넣기' : '네, 신청했어요'}</button><button type="button" className="m-btn line" onClick={onClose}>{manual ? '닫기' : '아직이요'}</button></>}>
    <p className="m-help">표시해 두면 내 활동에 넣고 하루 전·다녀온 뒤에 알려 드려요. 신청·승인은 1365에서 확인해요.</p>
    {manual ? <label className="m-field"><span className="m-label">활동 이름</span><TextInput className="m-input" maxLength={255} value={title} placeholder="1365에서 신청한 활동 이름" onChange={event => setTitle(event.target.value)} /></label>
      : <div className="m-summary"><strong>{program.title}</strong><span>{[program.organization, program.place].filter(Boolean).join(' · ')}</span></div>}
    {span && <p className="m-help">1365 모집 기간은 {first?.slice(5).replace('-', '/')} ~ {last?.slice(5).replace('-', '/')}이에요. 1365에서 신청한 그 날을 골라 주세요.</p>}
    <DateField label="참여하는 날" value={date} first={first ?? today} last={last ?? addYear(today)} onChange={setDate}
      note={first && last ? `1365 모집 기간 ${first.slice(5).replace('-', '/')} ~ ${last.slice(5).replace('-', '/')} 안에서 골라요` : '1년 안에서 골라요'} />
    {outside && <span className="m-err">1365 모집 기간({first} ~ {last}) 밖의 날짜예요. 맞는지 확인해 주세요.</span>}
    <div className="m-two"><TimeField label="시작" value={start} onChange={setStart} /><TimeField label="끝" value={end} onChange={setEnd} /></div>
    <label className="m-check"><input type="checkbox" checked={calendar} onChange={event => setCalendar(event.target.checked)} /><span className="m-box" /><span>내 캘린더에도 추가하기</span></label>
    {error && <p className="m-err" role="alert">{error}</p>}
  </Sheet>
}

/** 가져오기 (IMPORT): the day has passed and 1365 has not been checked yet → 실적 확인 대기 (refresh to match). */
export const waiting = (r: ExternalRecord, mode: ExtMode | undefined) => mode === 'IMPORT' && r.status === 'PLANNED' && r.started && !r.certified && !r.reflected

/**
 * 가져오기 (IMPORT) after "1365에서 신청하기": "1365에서 신청했나요?" — bring the 1365 application list in, put the day in by
 * hand, or not yet. 직접 남기기 keeps the MarkSheet only.
 */
export function AskSheet({ program, onClose, onManual }: { program: Program; onClose: () => void; onManual: () => void }) {
  const [connectSheet, connect] = useConnect1365(onClose)
  return <>{!connectSheet && <Sheet title="1365에서 신청했나요?" onClose={onClose} footer={<button type="button" className="m-btn line" onClick={onClose}>아직이요</button>}>
    <div className="m-summary"><strong>{program.title}</strong><span>{[program.organization, program.place].filter(Boolean).join(' · ')}</span></div>
    <div className="r-opts">
      <button type="button" className="r-opt" onClick={connect}><MIcon name="refresh" size={20} /><span><b>신청 현황 가져오기</b><small>1365 신청 현황 화면에서 그대로 넣어요</small></span></button>
      <button type="button" className="r-opt" onClick={onManual}><MIcon name="calendar" size={20} /><span><b>날짜 직접 넣기</b><small>참여하는 날과 시간만 적어요</small></span></button>
    </div>
    <p className="m-help">넣어 두면 하루 전에 알려 드리고, 다녀온 며칠 뒤 1365 실적을 새로고침하라고 알려 드려요.</p>
  </Sheet>}{connectSheet}</>
}

/** A row for 내 활동 (참여 예정 / 완료 기록). */
export function RecordRow({ r }: { r: ExternalRecord }) {
  const tag = recordTag(r)
  const wait = waiting(r, useExtMode())
  const word = wait ? '실적 확인 대기' : r.reflected ? '반영됨' : r.status === 'ATTENDED' ? '다녀옴' : r.status === 'MISSED' ? '못 감' : r.started ? '다녀왔어요?' : dDay(r.date) ?? '예정'
  return <a className="m-row" href={'#/record/' + r.id}>
    <span className="m-row-ico ext"><b>1365</b></span>
    <span className="m-row-main"><strong>{r.title}</strong><small>{recordWhen(r)} · {tag.text}{r.certMinutes ? ` · 인정 ${Math.round(r.certMinutes / 6) / 10}시간` : ''}</small></span>
    <span className={'m-badge ' + (wait ? 'amber' : r.reflected ? 'blue' : r.status === 'PLANNED' && r.started ? 'hot' : r.status === 'ATTENDED' ? 'mint' : 'gray')}>{word}</span>
  </a>
}

/** One 1365 record: went or not, certificate, review, links to 1365. */
export function RecordScreen({ id }: { id: number }) {
  const [record, setRecord] = useState<ExternalRecord | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState<null | 'cert' | 'delete'>(null)
  const mode = useExtMode()
  const [connectSheet, connect] = useConnect1365()
  const load = () => api<ExternalRecord>('/api/me/external/' + id).then(setRecord).catch(() => setFailed(true))
  useEffect(() => { void load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  async function mark(status: ExternalRecord['status']) {
    setBusy(true)
    try { setRecord(await api<ExternalRecord>('/api/me/external/' + id + '/status', 'PUT', { status })); showToast(status === 'ATTENDED' ? '내 발자취에 남겼어요' : '기록을 바꿨어요') }
    catch (cause) { showToast(message(cause)) } finally { setBusy(false) }
  }
  async function remove() {
    try { await api('/api/me/external/' + id, 'DELETE'); showToast('기록을 지웠어요'); window.location.hash = '#/mine' } catch (cause) { showToast(message(cause)) }
  }
  if (failed) return <div className="m-screen"><TopBar title="1365 활동" back="history" /><div className="m-body"><div className="m-note bad">기록을 찾을 수 없어요.</div></div></div>
  if (!record) return <div className="m-screen"><TopBar title="1365 활동" back="history" /><Loading /></div>
  const tag = recordTag(record)
  const dday = dDay(record.date)
  const wait = waiting(record, mode)
  const action = wait
    ? <><button className="m-btn line" disabled={busy} onClick={() => mark('MISSED')}>못 갔어요</button><button className="m-btn blue" onClick={connect}><MIcon name="refresh" size={19} />실적 새로고침</button></>
    : record.status === 'PLANNED' && record.started
    ? <><button className="m-btn line" disabled={busy} onClick={() => mark('MISSED')}>못 갔어요</button><button className="m-btn" disabled={busy} onClick={() => mark('ATTENDED')}>다녀왔어요</button></>
    : record.status === 'ATTENDED' ? (record.reviewId ? <a className="m-btn line" href={'#/post/' + record.reviewId}>내 후기 보기</a>
      : <a className="m-btn" href={'#/write?category=REVIEW&external=' + record.id}><MIcon name="camera" size={19} />사진과 함께 후기 쓰기</a>)
    : record.status === 'MISSED' ? <button className="m-btn line" disabled={busy} onClick={() => mark('ATTENDED')}>사실 다녀왔어요</button> : null
  return <div className="m-screen m-detail applied">
    <TopBar title="" back="history" actions={!record.reviewId ? <button type="button" className="m-icon-btn" aria-label="기록 지우기" onClick={() => setSheet('delete')}><MIcon name="trash" /></button> : undefined} />
    <div className="m-body">
      <section className="mg-head">
        <div className="mg-state"><span className="m-badge blue">1365</span><span className={'m-badge ' + tag.tone}>{tag.text}</span>
          {dday && record.status === 'PLANNED' && <small>{dday === 'D-DAY' ? '오늘' : '활동까지 ' + dday.slice(2) + '일'}</small>}</div>
        <h1>{record.title}</h1>
        <p className="mg-fact"><MIcon name="calendar" size={17} />{dayWord(record.date)} {record.timeKnown ? `${record.startTime} ~ ${record.endTime}` : '· 시간은 1365에서 확인'}</p>
        {(record.place || record.organization) && <p className="mg-fact"><MIcon name="pin" size={17} />{[record.organization, record.place].filter(Boolean).join(' · ')}</p>}
      </section>
      {record.status === 'PLANNED' && !record.started && <div className="m-state"><strong>1365에 신청한 활동이에요</strong><span>승인 여부는 1365에서 확인해 주세요. 하루 전에 알려 드릴게요.</span></div>}
      {wait && <div className="m-state amber"><strong>실적 확인 대기</strong><span>1365에 실적이 올라오기까지 며칠 걸려요. 새로고침하면 늘어난 건수만큼 맞춰 봐요.</span></div>}
      {record.reflected && <div className="m-state blue"><strong>실적 반영됨(추정)</strong><span>1365 실적 건수가 늘어서 이 활동이 반영된 걸로 봤어요. 정확한 내역은 1365에서 확인해 주세요.</span></div>}
      {!wait && record.status === 'PLANNED' && record.started && <div className="m-state hot"><strong>다녀왔어요?</strong><span>남기면 내 발자취에 쌓이고 후기를 쓸 수 있어요.</span></div>}
      {record.status === 'ATTENDED' && !record.reflected && <div className="m-state mint"><strong>다녀왔다고 남겼어요</strong><span>{record.certified ? `실적확인서 · ${record.certDate} · 인정 ${Math.round((record.certMinutes ?? 0) / 6) / 10}시간` : '본인 기록이에요. 실적확인서를 올리면 ‘실적확인서 있음’으로 바뀌어요.'}</span></div>}
      {record.status === 'MISSED' && <div className="m-state gray"><strong>못 갔다고 남겼어요</strong><span>1365 신청은 1365에서 취소해 주세요.</span></div>}
      {record.status === 'ATTENDED' && !record.certified && !record.reflected && <button type="button" className="m-promo-cta" onClick={() => setSheet('cert')}>
        <MIcon name="record" size={22} /><span><strong>1365 실적확인서 올리기</strong><small>PDF나 캡처를 폰 안에서 읽어요 · 파일은 보내지 않아요</small></span><MIcon name="chevron" size={18} /></button>}
      <nav className="mg-ops">
        {record.status === 'PLANNED' && !record.started && <button type="button" onClick={() => void recordToCalendar(record)}><MIcon name="calendar" size={20} /><span>내 캘린더에 추가<small>{record.timeKnown ? '갤럭시 기본 캘린더에 바로 넣어요' : '시간이 없어 9시로 넣어요 · 캘린더에서 고쳐 주세요'}</small></span><MIcon name="chevron" size={18} /></button>}
        <a href={SITE_1365} target="_blank" rel="noopener noreferrer"><MIcon name="outward" size={20} /><span>1365에서 신청 상태 보기<small>신청·승인·취소는 1365에서 해요</small></span><MIcon name="chevron" size={18} /></a>
        {record.status === 'ATTENDED' && <a href={SITE_1365} target="_blank" rel="noopener noreferrer"><MIcon name="outward" size={20} /><span>1365에서 실적확인서 받기<small>1365 로그인 → 나의 봉사 → 실적 확인</small></span><MIcon name="chevron" size={18} /></a>}
      </nav>
      <p className="m-help">Volink가 1365 신청이나 실적을 확인한 건 아니에요. 공식 봉사실적과 보험은 1365 기준이에요.</p>
    </div>
    {action && <ActionBar>{action}</ActionBar>}
    {connectSheet}
    {sheet === 'cert' && <CertificateSheet record={record} onClose={() => setSheet(null)} onSaved={next => { setRecord(next); setSheet(null) }} />}
    {sheet === 'delete' && <Sheet title="이 기록을 지울까요?" onClose={() => setSheet(null)} footer={<button type="button" className="m-btn danger" onClick={remove}>지우기</button>}>
      <p className="m-help">1365 신청은 그대로예요. 취소하려면 1365에서 해 주세요.</p></Sheet>}
  </div>
}

// ---- 실적확인서: read on the phone (PDF text, or OCR for a picture), confirm, send only the values ----

type Read = { title: string; organization: string; date: string; minutes: number }

/** Pulls the activity name, place of service, date and recognised hours out of the certificate text. */
export function parseCertificate(text: string, fallback: Pick<ExternalRecord, 'title' | 'organization' | 'date' | 'startTime' | 'endTime'>): Read {
  const flat = text.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean)
  const after = (labels: RegExp) => {
    for (let i = 0; i < flat.length; i++) {
      const m = labels.exec(flat[i])
      if (m) { const rest = flat[i].slice(m.index + m[0].length).replace(/^[\s:：|]+/, '').trim(); if (rest.length >= 2) return rest.slice(0, 120); if (flat[i + 1]) return flat[i + 1].slice(0, 120) }
    }
    return ''
  }
  const title = after(/(봉사활동명|활동명|봉사명|프로그램명|활동내용)/) || fallback.title
  const organization = after(/(수요처|봉사처|활동기관|기관명|모집기관|인증기관)/) || fallback.organization || ''
  const dates = [...text.matchAll(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g)].map(m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`)
  const near = dates.find(d => d === fallback.date) ?? dates.find(d => Math.abs(new Date(d).getTime() - new Date(fallback.date).getTime()) < 3 * 86_400_000)
  const date = near ?? dates[0] ?? fallback.date
  const hours = /(\d{1,2})\s*시간\s*(?:(\d{1,2})\s*분)?/.exec(text)
  const span = (new Date(`2000-01-01T${fallback.endTime}`).getTime() - new Date(`2000-01-01T${fallback.startTime}`).getTime()) / 60_000
  const minutes = hours ? Number(hours[1]) * 60 + Number(hours[2] ?? 0) : Math.max(60, Math.min(span || 120, 1440))
  return { title, organization, date, minutes }
}

async function pdfText(file: File) {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const pages: string[] = []
  for (let n = 1; n <= Math.min(doc.numPages, 3); n++) {
    const content = await (await doc.getPage(n)).getTextContent()
    // Items on the same line are joined; a new line where the y position changes.
    let lastY: number | null = null
    let line = ''
    for (const item of content.items as { str: string; transform: number[] }[]) {
      const y = Math.round(item.transform[5])
      if (lastY !== null && Math.abs(y - lastY) > 2) { pages.push(line); line = '' }
      line += (line && !line.endsWith(' ') ? ' ' : '') + item.str
      lastY = y
    }
    pages.push(line)
  }
  return pages.join('\n')
}

async function imageText(file: File, progress: (p: number) => void) {
  // Korean OCR on the phone (tesseract.js; the language data is downloaded once). Slow on old phones; the person checks the result.
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('kor', 1, { logger: m => { if (m.status === 'recognizing text') progress(Math.round(m.progress * 100)) } })
  try { return (await worker.recognize(file)).data.text } finally { await worker.terminate() }
}

/**
 * Without {@code record} (2026-11-07, 1365 연결 › 직접 추가하기): a new 1365 record is made from the certificate alone
 * (POST, then the certificate on it; the new record is removed again when the certificate is refused).
 */
export function CertificateSheet({ record, onClose, onSaved }: { record?: ExternalRecord; onClose: () => void; onSaved: (record: ExternalRecord) => void }) {
  const today = ymd(new Date())
  const base = record ?? { title: '', organization: null, date: today, startTime: '10:00', endTime: '12:00' }
  const [step, setStep] = useState<'pick' | 'reading' | 'check'>('pick')
  const [read, setRead] = useState<Read | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pdf = useRef<HTMLInputElement>(null), image = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null)
  async function take(file: File | undefined, kind: 'pdf' | 'image') {
    if (!file) return
    setError('')
    if (file.size > 15 * 1024 * 1024) { setError('15MB 이하 파일만 읽을 수 있어요.'); return }
    setStep('reading')
    try {
      const text = kind === 'pdf' ? await pdfText(file) : await imageText(file, () => {})
      setRead(parseCertificate(text, base))
      if (!text.trim()) setError('글자를 찾지 못했어요. 아래 칸을 직접 고쳐 주세요.')
    } catch {
      setRead(parseCertificate('', base))
      setError('파일을 읽지 못했어요. 아래 칸을 직접 고쳐 주세요.')
    }
    setStep('check')
  }
  async function save() {
    if (!read) return
    setBusy(true)
    if (record) {
      try { onSaved(await api<ExternalRecord>('/api/me/external/' + record.id + '/certificate', 'PUT', read)); showToast('실적확인서 내용을 남겼어요', '파일은 저장하지 않았어요') }
      catch (cause) { setError(message(cause)) } finally { setBusy(false) }
      return
    }
    let made: ExternalRecord | null = null
    try {
      made = await api<ExternalRecord>('/api/me/external', 'POST', { title: read.title, organization: read.organization, date: read.date })
      onSaved(await api<ExternalRecord>('/api/me/external/' + made.id + '/certificate', 'PUT', read))
      showToast('완료 기록에 넣었어요', '실적확인서 파일은 저장하지 않았어요')
    } catch (cause) {
      if (made) await api('/api/me/external/' + made.id, 'DELETE').catch(() => {})
      setError(message(cause))
    } finally { setBusy(false) }
  }
  if (step === 'pick') return <Sheet title={record ? '실적확인서를 골라 주세요' : '실적확인서 추가'} onClose={onClose}>
    <div className="r-opts">
      <button type="button" className="r-opt" onClick={() => camera.current?.click()}><MIcon name="camera" size={20} /><span><b>사진 찍기</b><small>종이 확인서를 바로 찍어요 · 폰 안에서 읽어요</small></span></button>
      <button type="button" className="r-opt" onClick={() => image.current?.click()}><MIcon name="camera" size={20} /><span><b>앨범에서 고르기</b><small>캡처·저장한 사진</small></span></button>
      <button type="button" className="r-opt" onClick={() => pdf.current?.click()}><MIcon name="record" size={20} /><span><b>PDF 파일</b><small>1365에서 받은 파일 · 가장 정확해요</small></span></button>
    </div>
    <input ref={pdf} type="file" accept="application/pdf" hidden onChange={event => take(event.target.files?.[0], 'pdf')} />
    <input ref={image} type="file" accept="image/*" hidden onChange={event => take(event.target.files?.[0], 'image')} />
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={event => take(event.target.files?.[0], 'image')} />
    <div className="m-note"><MIcon name="lock" size={14} /> 파일은 폰 안에서만 읽고 보내지 않아요. 활동명·기관·날짜·시간만 남기고, 이름·생년월일은 남기지 않아요.</div>
    {error && <p className="m-err" role="alert">{error}</p>}
  </Sheet>
  // While reading: only a spinner and one line (no percentages or file messages).
  if (step === 'reading') return <Sheet title="실적확인서" onClose={onClose}><div className="r-reading" role="status"><span className="m-spin big" />확인 중이에요</div></Sheet>
  return <Sheet title="이 내용이 맞나요?" onClose={onClose} footer={<button type="button" className="m-btn" disabled={busy || !read || (read?.title.trim().length ?? 0) < 2} onClick={save}>{record ? '맞아요, 남길게요' : '완료 기록에 넣기'}</button>}>
    {error && <p className="m-err" role="alert">{error}</p>}
    {read && <div className="r-read">
      <label><span>활동명</span><TextInput className="m-input" value={read.title} maxLength={255} onChange={event => setRead({ ...read, title: event.target.value })} /></label>
      <label><span>기관</span><TextInput className="m-input" value={read.organization} maxLength={255} onChange={event => setRead({ ...read, organization: event.target.value })} /></label>
      <DateField label="날짜" value={read.date} first={addYear(today, -1)} last={today} note="실적확인서에 적힌 날짜를 골라 주세요" onChange={date => setRead({ ...read, date })} />
      <label><span>인정 시간(분)</span><TextInput type="number" inputMode="numeric" className="m-input" value={String(read.minutes)} onChange={event => setRead({ ...read, minutes: Number(event.target.value) || 0 })} /></label>
    </div>}
    <p className="m-help">{record ? `‘${record.title}’ 기록에 붙어요. ` : '완료 기록에 1365 활동으로 들어가요. '}Volink가 확인서의 진위를 확인한 건 아니에요.</p>
  </Sheet>
}


/**
 * 1365 연결 › 신청 현황 › 직접 추가하기 (2026-11-07): find the 1365 activity (nationwide search) and put in the day, or type the name
 * and day by hand when it is not found. Joins 참여 예정 like ‘이미 신청했어요’.
 */
export function AddApplicationSheet({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Program[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [chosen, setChosen] = useState<Program | null>(null)
  const [manual, setManual] = useState(false)
  async function search() {
    if (q.trim().length < 2) return
    setBusy(true)
    try { setFound((await api<{ items: Program[] }>('/api/volunteer-programs?nationwide=true&q=' + encodeURIComponent(q.trim()))).items.slice(0, 8)) } catch { setFound([]) } finally { setBusy(false) }
  }
  const done = () => { onClose(); window.location.hash = '#/mine' }
  if (chosen) return <MarkSheet program={chosen} onClose={() => setChosen(null)} onSaved={done} manual={manual} />
  return <Sheet title="신청한 활동 넣기" onClose={onClose}
    footer={<button type="button" className="m-btn line" onClick={() => { setManual(true); setChosen({ programNo: '', title: q.trim(), organization: null, place: null, field: null, periodStart: null, periodEnd: null, beginTime: null, endTime: null, weekdays: null, recruitStatus: null, recruitEnd: null, capacity: null, youthOk: null, latitude: null, longitude: null, distanceKm: null, link: '' }) }}>못 찾으면 이름·날짜 직접 적기</button>}>
    <form className="m-search-row" onSubmit={event => { event.preventDefault(); search() }}>
      <label className="m-search"><MIcon name="search" size={18} /><TextInput type="search" enterKeyHint="search" value={q} placeholder="1365 활동 이름·기관 검색" aria-label="1365 활동 검색" onChange={event => setQ(event.target.value)} /></label>
    </form>
    {busy ? <div className="r-reading" role="status"><span className="m-spin" />찾는 중이에요</div>
      : found === null ? <p className="m-help">1365에서 신청한 활동 이름을 검색해 주세요.</p>
      : found.length === 0 ? <p className="m-help">찾지 못했어요. 아래에서 이름·날짜를 직접 적을 수 있어요.</p>
      : <div className="r-opts">{found.map(p => <button key={p.programNo} type="button" className="r-opt" onClick={() => { setManual(false); setChosen(p) }}>
        <MIcon name="calendar" size={20} /><span><b>{p.title}</b><small>{[p.organization, p.periodStart && p.periodEnd ? `${fromCompact(p.periodStart)?.slice(5).replace('-', '/')} ~ ${fromCompact(p.periodEnd)?.slice(5).replace('-', '/')}` : null].filter(Boolean).join(' · ')}</small></span></button>)}</div>}
  </Sheet>
}
