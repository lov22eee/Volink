// 1365 activities in my records (V27, 2026-11-06). Volink cannot see 1365 itself, so:
// - 본인 표시: after "1365에서 신청하기" the person says they applied (date and time), and it joins 내 활동;
// - after the day: 다녀왔어요 / 못 갔어요 → 내 발자취 → a review in the community (photo invited);
// - 실적확인서 values from earlier versions are still shown (reading a certificate is planned again for week 7);
// - 실험실 (lab, off by default): rows read from the person's own 1365 page in the app (see lab.tsx).
// Shown to others as 본인 기록 / 실적확인서 있음 — never as checked by Volink, never as official.
import { useEffect, useState } from 'react'
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
  /** V32: a finished activity read from the 1365 실적 list — TIME (with its hours) or ACTIVITY (counted once). */
  extMinutes?: number | null; extKind?: 'TIME' | 'ACTIVITY' | null
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
export function recordTag(r: Pick<ExternalRecord, 'certified' | 'source' | 'reflected'> & { extKind?: string | null }) {
  // V32: matched by name and day with the 1365 실적 list → 실적 반영됨 (no 추정); a row from the list itself → 1365 실적.
  if (r.extKind) return r.reflected ? { text: '실적 반영됨', tone: 'blue' } : { text: '1365 실적', tone: 'blue' }
  return r.reflected ? { text: '실적 반영됨(추정)', tone: 'blue' } : r.certified ? { text: '실적확인서 있음', tone: 'blue' } : r.source === 'LAB' ? { text: '1365 연결', tone: 'blue' } : { text: '본인 표시', tone: 'gray' }
}

export function useRecords(refresh = 0) {
  const [items, setItems] = useState<ExternalRecord[] | null>(null)
  useEffect(() => { api<ExternalRecord[]>('/api/me/external').then(setItems).catch(() => setItems([])) }, [refresh])
  return items
}

/** "1365에서 신청을 마쳤나요?": the day (inside the 1365 period) and time, then it joins 내 활동. */
export function MarkSheet({ program, onClose, onSaved }: { program: Program; onClose: () => void; onSaved?: (record: ExternalRecord) => void }) {
  const today = ymd(new Date())
  const first = fromCompact(program.periodStart), last = fromCompact(program.periodEnd)
  // A period of several days (11/12 ~ 11/30): no day is assumed; the person picks the day they go.
  const span = Boolean(first && last && first !== last)
  const [date, setDate] = useState(span ? '' : first && first > today ? first : today)
  const [start, setStart] = useState(program.beginTime ?? '10:00')
  const [end, setEnd] = useState(program.endTime ?? '12:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 2026-11-07: after 네, 신청했어요 a second sheet asks about the phone calendar (no checkbox beforehand).
  const [saved, setSaved] = useState<ExternalRecord | null>(null)
  const outside = Boolean(date && ((first && date < first) || (last && date > last)))
  async function save() {
    setBusy(true)
    setError('')
    try {
      setSaved(await api<ExternalRecord>('/api/me/external', 'POST', { programNo: program.programNo || undefined, title: program.title, organization: program.organization,
        place: program.place, date, startTime: start, endTime: end }))
    } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }
  async function finish(calendar: boolean) {
    const record = saved!
    onSaved?.(record)
    onClose()
    if (calendar) await recordToCalendar(record).catch(() => showToast('내 활동에 넣었어요'))
    else showToast('내 활동에 넣었어요', '하루 전과 다녀온 뒤에 알려 드릴게요')
  }
  if (saved) return <Sheet title="내 캘린더에도 추가할까요?" onClose={() => finish(false)}
    footer={<><button type="button" className="m-btn" onClick={() => finish(true)}>캘린더에 추가하기</button><button type="button" className="m-btn line" onClick={() => finish(false)}>추가하지 않을게요</button></>}>
    <div className="m-summary"><strong>{saved.title}</strong><span>{`${saved.date.slice(5).replace('-', '/')} ${saved.startTime}~${saved.endTime}`}{saved.organization ? ' · ' + saved.organization : ''}</span></div>
  </Sheet>
  return <Sheet title="1365에서 신청을 마쳤나요?" onClose={onClose}
    footer={<><button type="button" className="m-btn" disabled={busy || !date} onClick={save}>{!date ? '참여하는 날을 골라 주세요' : '네, 신청했어요'}</button><button type="button" className="m-btn line" onClick={onClose}>아직이요</button></>}>
    <p className="m-help">표시해 두면 내 활동에 넣고 하루 전·다녀온 뒤에 알려 드려요. 신청·승인은 1365에서 확인해요.</p>
    <div className="m-summary"><strong>{program.title}</strong><span>{[program.organization, program.place].filter(Boolean).join(' · ')}</span></div>
    {span && <p className="m-help">1365 모집 기간은 {first?.slice(5).replace('-', '/')} ~ {last?.slice(5).replace('-', '/')}이에요. 1365에서 신청한 그 날을 골라 주세요.</p>}
    <DateField label="참여하는 날" value={date} first={first ?? today} last={last ?? addYear(today)} onChange={setDate}
      note={first && last ? `1365 모집 기간 ${first.slice(5).replace('-', '/')} ~ ${last.slice(5).replace('-', '/')} 안에서 골라요` : '1년 안에서 골라요'} />
    {outside && <span className="m-err">1365 모집 기간({first} ~ {last}) 밖의 날짜예요. 맞는지 확인해 주세요.</span>}
    <div className="m-two"><TimeField label="시작" value={start} onChange={setStart} /><TimeField label="종료" value={end} onChange={setEnd} /></div>
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
const hoursOf = (minutes: number) => `${Math.floor(minutes / 60)}시간${minutes % 60 ? ' ' + (minutes % 60) + '분' : ''}`

export function RecordRow({ r }: { r: ExternalRecord }) {
  const tag = recordTag(r)
  const wait = waiting(r, useExtMode())
  const word = wait ? '실적 확인 대기' : r.reflected ? '반영됨' : r.status === 'ATTENDED' ? '다녀옴' : r.status === 'MISSED' ? '못 감' : r.started ? '다녀왔어요?' : dDay(r.date) ?? '예정'
  return <a className="m-row" href={'#/record/' + r.id}>
    <span className="m-row-ico ext"><b>1365</b></span>
    <span className="m-row-main"><strong>{r.title}</strong><small>{r.extKind
      ? `${r.date.slice(0, 4) === String(new Date().getFullYear()) ? r.date.slice(5).replace('-', '/') : r.date.replaceAll('-', '.')} · ${r.extKind === 'TIME' ? (r.extMinutes != null ? hoursOf(r.extMinutes) : '시간 미정') : '활동 1회'} · ${r.extKind === 'TIME' ? '시간인증' : '활동인증'}`
      : r.certified && r.certDate
      // A certificate (2026-11-07: it may be years ago and sum a period): its day with the year when it is not this year, and its hours.
      ? `${r.certDate.slice(0, 4) === String(new Date().getFullYear()) ? r.certDate.slice(5).replace('-', '/') : r.certDate.replaceAll('-', '.')} · ${tag.text} · ${hoursOf(r.certMinutes ?? 0)}`
      : `${recordWhen(r)} · ${tag.text}${r.certMinutes ? ` · 인정 ${Math.round(r.certMinutes / 6) / 10}시간` : ''}`}</small></span>
    <span className={'m-badge ' + (wait ? 'amber' : r.reflected ? 'blue' : r.status === 'PLANNED' && r.started ? 'hot' : r.status === 'ATTENDED' ? 'mint' : 'gray')}>{word}</span>
  </a>
}

/** One 1365 record: went or not, certificate, review, links to 1365. */
export function RecordScreen({ id }: { id: number }) {
  const [record, setRecord] = useState<ExternalRecord | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState<null | 'delete'>(null)
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
      {record.status === 'ATTENDED' && !record.reflected && <div className="m-state mint"><strong>다녀왔다고 남겼어요</strong><span>{record.certified ? `실적확인서 · ${record.certDate} · 인정 ${Math.round((record.certMinutes ?? 0) / 6) / 10}시간` : '본인 기록이에요.'}</span></div>}
      {record.status === 'MISSED' && <div className="m-state gray"><strong>못 갔다고 남겼어요</strong><span>1365 신청은 1365에서 취소해 주세요.</span></div>}
      <nav className="mg-ops">
        {record.status === 'PLANNED' && !record.started && <button type="button" onClick={() => void recordToCalendar(record)}><MIcon name="calendar" size={20} /><span>내 캘린더에 추가<small>{record.timeKnown ? '갤럭시 기본 캘린더에 바로 넣어요' : '시간이 없어 9시로 넣어요 · 캘린더에서 고쳐 주세요'}</small></span><MIcon name="chevron" size={18} /></button>}
        <a href={SITE_1365} target="_blank" rel="noopener noreferrer"><MIcon name="outward" size={20} /><span>1365에서 신청 상태 보기<small>신청·승인·취소는 1365에서 해요</small></span><MIcon name="chevron" size={18} /></a>
      </nav>
      <p className="m-help">Volink가 1365 신청이나 실적을 확인한 건 아니에요. 공식 봉사실적과 보험은 1365 기준이에요.</p>
    </div>
    {action && <ActionBar>{action}</ActionBar>}
    {connectSheet}
    {sheet === 'delete' && <Sheet title="이 기록을 지울까요?" onClose={() => setSheet(null)} footer={<button type="button" className="m-btn danger" onClick={remove}>지우기</button>}>
      <p className="m-help">1365 신청은 그대로예요. 취소하려면 1365에서 해 주세요.</p></Sheet>}
  </div>
}



/**
 * 1365 연결 › 신청 현황 › 직접 추가하기 (2026-11-07): find the 1365 activity (nationwide search) and put in the day, or type the name
 * and day by hand when it is not found. Joins 참여 예정 like ‘이미 신청했어요’.
 */
export function AddApplicationSheet({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Program[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [chosen, setChosen] = useState<Program | null>(null)
  async function search() {
    if (q.trim().length < 2) return
    setBusy(true)
    try { setFound((await api<{ items: Program[] }>('/api/volunteer-programs?nationwide=true&q=' + encodeURIComponent(q.trim()))).items.slice(0, 8)) } catch { setFound([]) } finally { setBusy(false) }
  }
  const done = () => { onClose(); if (onSaved) onSaved(); else window.location.hash = '#/mine' }
  if (chosen) return <MarkSheet program={chosen} onClose={() => setChosen(null)} onSaved={done} />
  return <Sheet title="1365 활동 찾아서 넣기" onClose={onClose}>
    <p className="m-help">1365에서 신청한 활동을 검색해서 골라 주세요.</p>
    <form className="m-search-row" onSubmit={event => { event.preventDefault(); search() }}>
      <label className="m-search"><MIcon name="search" size={18} /><TextInput type="search" enterKeyHint="search" value={q} placeholder="1365 활동 이름·기관 검색" aria-label="1365 활동 검색" onChange={event => setQ(event.target.value)} /></label>
    </form>
    {busy ? <div className="r-reading" role="status"><span className="m-spin" />찾는 중이에요</div>
      : found === null ? null
      : found.length === 0 ? <p className="m-help">찾지 못했어요. 다른 이름으로 찾거나 ‘1365에서 가져오기’로 신청 내역을 가져와 주세요.</p>
      : <div className="r-opts">{found.map(p => <button key={p.programNo} type="button" className="r-opt" onClick={() => setChosen(p)}>
        <MIcon name="calendar" size={20} /><span><b>{p.title}</b><small>{[p.organization, p.periodStart && p.periodEnd ? `${fromCompact(p.periodStart)?.slice(5).replace('-', '/')} ~ ${fromCompact(p.periodEnd)?.slice(5).replace('-', '/')}` : null].filter(Boolean).join(' · ')}</small></span></button>)}</div>}
  </Sheet>
}
