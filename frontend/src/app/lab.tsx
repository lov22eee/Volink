// 실험실 · 1365 연결 (2026-11-06, off by default; 마이 › 설정 › 실험실). The person logs in to 1365 in an in-app browser
// (native VolinkLab plugin), opens their own application list and taps "이 화면 가져오기": the page's visible text comes back,
// the rows are read on the phone, and only the rows the person picks are saved (title, day, time, 1365 status).
// The password never reaches Volink; the 1365 login is cleared when that screen closes. Without the app (web), the text can be pasted.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { api, ApiError } from '../api'
import { showToast } from '../App'
import { DateField } from './host'
import { ActionBar, MIcon, Sheet, TextArea, TopBar } from './ui'

const lab = registerPlugin<{ open(options: { guide: string; step?: string; target?: 'S' | 'A' }): Promise<{ text: string; texts?: string[]; host?: string }> }>('VolinkLab')
const KEY = 'volink.lab1365'

const AGREED = 'volink.lab1365.agreed'
/** The one line shown above the 1365 page in the app (plan 1, 2026-11-06): where to go after logging in. */
export const LAB_GUIDE = '로그인 → ☰ 메뉴 › 나의 봉사 › 봉사참여 실적 → 아래 ‘이 화면 가져오기’ (신청 현황도 이어서)'
/**
 * Step-by-step guide on the 1365 page (2026-11-06, without the 1365 addresses): the in-app browser runs this every 1.5s on
 * the page and shows what it returns above the page. It guesses the step from the visible words only (a password box,
 * 로그아웃, 나의 봉사, 총 ○시간, 신청 현황 with dates). `t` page text, `pw` a password box is shown, `ds`/`da` the 실적 /
 * 신청 현황 page was already taken (several pages can be taken in one visit), `full` all words on the page including the
 * closed ☰ menu (on the phone '로그아웃' lives only there), `was` a login page was seen and left (2026-11-06: the guide stayed on
 * ① after logging in because '로그아웃' is hidden in the menu). Returns "<step><kind>|<line>": step 1-5,
 * kind S (실적 page), A (신청 현황 page) or -. Plain ES5 inside a string so the Android side runs it as it is.
 */
export const LAB_STEP_BODY = `
  var s = String(t || '').replace(/\\s+/g, ' ');
  var date = /20\\d{2}\\s*[.\\-\\/]\\s*\\d{1,2}\\s*[.\\-\\/]\\s*\\d{1,2}/;
  var sum = /봉사\\s*참여\\s*실적|시간인증형/.test(s) && /총\\s*\\d+\\s*시간/.test(s);
  var app = /신청\\s*현황|신청\\s*내역/.test(s) && date.test(s) && /(승인|신청\\s*완료|대기|취소|활동\\s*완료)/.test(s);
  var want = tg === 'A' ? '‘신청 현황’' : '‘봉사참여 실적’';
  if (sum && tg !== 'A' && !ds) return '4S|④ 실적 화면이에요. 아래 ‘이 화면 가져오기’를 눌러 주세요';
  if (app && tg !== 'S' && !da) return '4A|④ 신청 현황이에요. 아래 ‘이 화면 가져오기’를 눌러 주세요';
  if (sum || app) return '3-|③ 이 화면이 아니에요. ☰ › 나의 봉사 › ' + want + '으로 가 주세요';
  if (pw) return '1-|① 1365 아이디·비밀번호나 간편인증으로 로그인해 주세요';
  var inside = /로그아웃/.test(s) || /로그아웃/.test(String(full || '')) || !!was;
  if (inside && /나의\\s*봉사|마이\\s*페이지/.test(s) && /봉사\\s*참여\\s*실적|신청\\s*현황/.test(s)) return '3-|③ ' + want + '을 눌러 주세요';
  if (inside) return '2-|② 오른쪽 위 ☰ 메뉴 › ‘나의 봉사’로 가 주세요';
  return '1-|① ☰ 메뉴에서 ‘로그인’을 눌러 주세요';
`
/** The same rule in the app (tests). */
export function labStep(text: string, password: boolean, tookSummary = false, tookApplications = false, full = '', wasLogin = false, target: '' | 'S' | 'A' = ''): { step: number; kind: string; line: string } {
  const out = String(new Function('t', 'pw', 'ds', 'da', 'full', 'was', 'tg', LAB_STEP_BODY)(text, password, tookSummary, tookApplications, full, wasLogin, target))
  return { step: Number(out.slice(0, 1)), kind: out.slice(1, 2), line: out.slice(3) }
}

const agreed = () => { try { return localStorage.getItem(AGREED) === '1' } catch { return false } }

/**
 * "1365 봉사실적 연결하기" from anywhere (마이, 완료 기록, 설정): the first time a consent sheet, then the lab turns on and its
 * screen opens. Returns the sheet to render and the function to start.
 */
export function useConnect1365(onCancel?: () => void): [ReactNode, () => void] {
  const [open, setOpen] = useState(false)
  const go = () => { setLabOn(true); window.location.hash = '#/lab1365' }
  const start = () => agreed() ? go() : setOpen(true)
  const sheet = open && <Sheet title="연결 전에 확인해 주세요" onClose={() => setOpen(false)}
    footer={<><button type="button" className="m-btn blue" onClick={() => { try { localStorage.setItem(AGREED, '1') } catch { /* asked again next time */ } setOpen(false); go() }}>동의하고 계속하기</button>
      <button type="button" className="m-btn line" onClick={() => { setOpen(false); onCancel?.() }}>다음에 할게요</button></>}>
    <span className="lab-tag"><MIcon name="flask" size={13} />실험 기능</span>
    <ul className="lab-consent">
      <li><MIcon name="lock" size={18} /><span><b>비밀번호는 Volink로 오지 않아요</b><small>1365 화면에 직접 로그인하고, 닫으면 로그인도 지워요</small></span></li>
      <li><MIcon name="record" size={18} /><span><b>내가 연 화면의 글자만 폰 안에서 읽어요</b><small>총 시간·건수·분야와 고른 신청 내역만 남기고, 이름은 남기지 않아요</small></span></li>
      <li><MIcon name="checkCircle" size={18} /><span><b>1365 공식 실적을 내 화면에서 옮겨 와요</b><small>가져온 날 기준이에요. 그 뒤 바뀐 실적과 확인서 발급은 1365에서 확인해 주세요</small></span></li>
      <li><MIcon name="alert" size={18} /><span><b>1365 화면이 바뀌면 멈출 수 있어요</b><small>그때는 ‘이미 신청했어요’나 실적확인서로 넣어 주세요</small></span></li>
    </ul>
  </Sheet>
  return [sheet, start]
}

/**
 * V29 (2026-11-06): how the person keeps 1365 activities, chosen once right after signup (설정 › 실험실 to change).
 * IMPORT = 가져오기 (1365 화면에서 신청 현황·실적), MANUAL = 직접 남기기 (참여했나요? → 실적확인서), null = not chosen.
 */
export type ExtMode = 'IMPORT' | 'MANUAL' | null
let modeCache: ExtMode | undefined
const modeListeners = new Set<(mode: ExtMode) => void>()
export async function saveExtMode(mode: 'IMPORT' | 'MANUAL') {
  await api('/api/me/external/mode', 'PUT', { mode })
  modeCache = mode
  if (mode === 'IMPORT') setLabOn(true)
  modeListeners.forEach(listen => listen(mode))
}
export function useExtMode(): ExtMode | undefined {
  const [mode, setMode] = useState<ExtMode | undefined>(modeCache)
  useEffect(() => {
    modeListeners.add(setMode)
    if (modeCache === undefined) api<{ mode: ExtMode }>('/api/me/external/mode').then(x => { modeCache = x.mode ?? null; modeListeners.forEach(listen => listen(modeCache as ExtMode)) }).catch(() => setMode(null))
    return () => { modeListeners.delete(setMode) }
  }, [])
  return mode
}

export function labOn() { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
export function setLabOn(on: boolean) { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY) } catch { /* private mode: stays off */ } }

/** A row from the 1365 application list. `date` is '' when 1365 only shows a period (11/12 ~ 11/30): the person picks the day. */
export type LabRow = { title: string; date: string; periodStart?: string; periodEnd?: string; startTime?: string; endTime?: string; labStatus?: string }
export type LabSummary = { totalMinutes: number; count?: number; fields: { name: string; minutes: number }[] }

/**
 * The 1365 봉사참여 실적 page: "총 57시간 30분", "총 14건" and the per-field table ("기타 57시간 30분"). The person's name on
 * that page is never read into anything that is sent.
 */
export function parseLabSummary(text: string): LabSummary | null {
  const flat = text.replace(/\s+/g, ' ')
  if (!/(봉사참여 실적|봉사시간|시간인증형)/.test(flat)) return null
  const total = /총\s*(\d{1,5})\s*시간\s*(?:(\d{1,2})\s*분)?/.exec(flat)
  if (!total) return null
  const count = /총\s*(\d{1,5})\s*건/.exec(flat)
  const fields: LabSummary['fields'] = []
  for (const line of text.replace(/\r/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim())) {
    const m = /^([가-힣·/ ]{2,12}?)\s+(\d{1,5})\s*시간\s*(?:(\d{1,2})\s*분)?$/.exec(line)
    if (m && !/^(총|봉사시간|봉사분야)/.test(m[1]) && !fields.some(f => f.name === m[1].trim())) fields.push({ name: m[1].trim(), minutes: Number(m[2]) * 60 + Number(m[3] ?? 0) })
  }
  return { totalMinutes: Number(total[1]) * 60 + Number(total[2] ?? 0), count: count ? Number(count[1]) : undefined, fields: fields.slice(0, 20) }
}

export const hoursText = (minutes: number) => `${Math.floor(minutes / 60)}시간${minutes % 60 ? ' ' + (minutes % 60) + '분' : ''}`

const STATUS = /(승인\s*완료|승인\s*대기|신청\s*완료|활동\s*완료|모집\s*중|모집\s*완료|봉사\s*완료|취소|반려|대기)/
const DATE = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g
const TIME = /([01]?\d|2[0-3]):([0-5]\d)\s*[~\-–]\s*([01]?\d|2[0-3]):([0-5]\d)/
/** Labels on the 1365 list, never a title. 모집·접수·신청 periods are not the day of the activity, so they are skipped. */
const LABEL = /^(봉사|활동|모집|접수|신청|인정)\s*(기간|일시|일자|일|시간)|^(기간|일시|상태|장소|봉사장소|모집기관|등록기관|수요처|봉사분야|분야|구분|번호)\b/
const NOT_DAY = /^(모집|접수|신청)\s*(기간|일시|일자|일)/
const ymdOf = (m: RegExpExecArray) => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`

/**
 * Reads application rows from the text of a 1365 list page (2026-11-06, after a real page gave rows named '봉사기간'):
 * a title line, then its 봉사기간/활동일 line. A period of several days leaves `date` empty so the person picks the day they
 * go; 모집기간 lines are skipped; a time is kept only when the page shows one. The person checks every row.
 */
export function parseLabText(text: string): LabRow[] {
  const lines = text.replace(/\r/g, '').split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const rows: LabRow[] = []
  const seen = new Set<string>()
  let lastTitle = ''
  const clean = (s: string) => s.replace(new RegExp(DATE.source, 'g'), ' ').replace(TIME, ' ').replace(STATUS, ' ').replace(LABEL, ' ').replace(/[~|·:：\[\]()]/g, ' ').replace(/\s+/g, ' ').trim()
  const isTitle = (s: string) => s.length >= 4 && s.length <= 80 && /[가-힣]{2,}/.test(s) && !LABEL.test(s) && !STATUS.test(s.replace(/\s/g, '').slice(0, 6))
    && !/(로그인|로그아웃|메뉴|검색|나의\s*봉사|신청\s*현황|봉사참여\s*실적|이전|다음|목록|페이지|전체|조회)/.test(s)
  lines.forEach((line, i) => {
    const dates = [...line.matchAll(new RegExp(DATE.source, 'g'))].map(ymdOf)
    if (!dates.length) { if (isTitle(line)) lastTitle = line; return }
    if (NOT_DAY.test(line)) return
    const own = clean(line)
    const title = isTitle(own) ? own : lastTitle
    if (!title) return
    const start = dates[0], end = dates[1] && dates[1] >= start ? dates[1] : start
    const time = TIME.exec(line) ?? TIME.exec(lines[i + 1] ?? '')
    const status = STATUS.exec(line)?.[1] ?? STATUS.exec(lines[i + 1] ?? '')?.[1] ?? STATUS.exec(lines[i + 2] ?? '')?.[1]
    const key = title + start
    if (seen.has(key)) return
    seen.add(key)
    rows.push({ title: title.slice(0, 120), date: start === end ? start : '', periodStart: start, periodEnd: end,
      startTime: time ? `${time[1].padStart(2, '0')}:${time[2]}` : undefined, endTime: time ? `${time[3].padStart(2, '0')}:${time[4]}` : undefined, labStatus: status?.replace(/\s+/g, '') })
  })
  return rows.slice(0, 20)
}

export function LabScreen() {
  const native = Capacitor.isNativePlatform()
  const [rows, setRows] = useState<LabRow[] | null>(null)
  const [summary, setSummary] = useState<LabSummary | null>(null)
  const [keepSummary, setKeepSummary] = useState(true)
  const [picked, setPicked] = useState<boolean[]>([])
  // The day the person goes, for rows where 1365 shows only a period (11/12 ~ 11/30).
  const [days, setDays] = useState<string[]>([])
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 예시로 해보기 (2026-11-06): someone without 1365 applications can see the flow; nothing is saved.
  const [sample, setSample] = useState(false)
  /** One or more pages taken in one visit: the 실적 page gives the total, the 신청 현황 page the rows. */
  function read(input: string | string[]) {
    const pages = (Array.isArray(input) ? input : [input]).filter(Boolean)
    let total: LabSummary | null = null
    const found: LabRow[] = []
    for (const page of pages) {
      const sum = parseLabSummary(page)
      if (sum) { total = sum; continue }
      for (const row of parseLabText(page)) if (!found.some(r => r.title === row.title && r.date === row.date) && found.length < 20) found.push(row)
    }
    setRows(found)
    setSummary(total)
    setPicked(found.map(() => true))
    setDays(found.map(r => r.date))
    setError(found.length || total ? '' : '읽을 내용을 찾지 못했어요. 1365 ‘나의 봉사’의 신청 현황이나 봉사참여 실적 화면에서 가져와 주세요.')
  }
  /** One page per visit (2026-11-06: going on to the second page in the same visit confused the guide): 실적 or 신청 현황. */
  async function open(target: 'S' | 'A') {
    setError(''); setSample(false)
    const guide = target === 'S' ? '로그인 → ☰ 메뉴 › 나의 봉사 › 봉사참여 실적 → 아래 ‘이 화면 가져오기’' : '로그인 → ☰ 메뉴 › 나의 봉사 › 신청 현황 → 아래 ‘이 화면 가져오기’'
    try { const got = await lab.open({ guide, step: LAB_STEP_BODY, target }); read(got.texts?.length ? got.texts : got.text ?? '') } catch { /* closed without taking the page */ }
  }
  function trySample() {
    const d = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 86_400_000)).replaceAll('-', '.')
    setSample(true)
    read(`나의 봉사 신청 현황\n어르신 말벗 봉사 (예시)\n봉사기간 ${d(3)} ~ ${d(20)}\n승인완료\n하천 정화 활동 (예시)\n봉사기간 ${d(6)} ~ ${d(6)} 10:00~12:00\n신청완료`)
  }
  async function save() {
    const items = (rows ?? []).map((r, i) => ({ ...r, date: days[i] })).filter((_, i) => picked[i])
    const total = summary && keepSummary ? summary : null
    if (!items.length && !total) return
    if (sample) { showToast('예시라 저장하지 않았어요', '내 1365 화면에서 가져오면 내 활동에 들어가요'); setRows(null); setSample(false); return }
    setBusy(true)
    try {
      const result = items.length ? await api<{ added: number }>('/api/me/external/import', 'POST', { items }) : { added: 0 }
      // A larger count than last time: that many waiting 1365 activities become 실적 반영됨(추정) on the server.
      const saved = total ? await api<{ count?: number; before?: number | null; reflected?: number }>('/api/me/external/summary', 'PUT', total) : null
      if (saved?.reflected) showToast(`실적이 늘었어요 ${saved.before}→${saved.count}건`, `활동 ${saved.reflected}개를 ‘실적 반영됨(추정)’으로 바꿨어요`)
      else if (saved && saved.before != null && saved.before === saved.count) showToast('새로 늘어난 실적은 아직 없어요', '1365에 반영되기까지 며칠 걸릴 수 있어요')
      else showToast(total ? '1365 봉사 실적을 가져왔어요' : result.added ? `내 활동에 ${result.added}개를 넣었어요` : '이미 넣은 활동이에요', '내 활동에서 볼 수 있어요')
      window.location.hash = total ? '#/mine?tab=done' : '#/mine'
    } catch (cause) { setError(cause instanceof ApiError ? Object.values(cause.fieldErrors)[0] ?? cause.message : '잠시 후 다시 시도해 주세요.') } finally { setBusy(false) }
  }
  const count = picked.filter(Boolean).length
  const undated = (rows ?? []).filter((_, i) => picked[i] && !days[i]).length
  const md = (d?: string) => d ? d.slice(5).replace('-', '/') : ''
  return <div className="m-screen">
    <TopBar title="1365 연결" back="history" />
    <div className="m-body lab">
      <span className="lab-tag"><MIcon name="flask" size={13} />실험 기능</span>{sample && <span className="lab-tag sample">예시 화면 · 저장되지 않아요</span>}
      {!rows ? <>
        <h1 className="m-h2">이렇게 가져와요</h1>
        <p className="m-help">1365에서 세 번만 누르면 돼요. 1365 화면 위에 지금 할 일이 단계별로 떠요.</p>
        <ol className="lab-guide">
          <li><b>1</b><span><strong>1365에 로그인</strong><small>아이디나 간편인증으로 직접 로그인해요</small></span></li>
          <li><b>2</b><span><strong>☰ 메뉴 › 나의 봉사</strong><small>‘봉사참여 실적’ 또는 ‘신청 현황’으로 가요 (아래에서 고른 쪽)</small></span></li>
          <li><b>3</b><span><strong>아래 ‘이 화면 가져오기’</strong><small>누르면 바로 돌아와요 · 다른 쪽은 한 번 더 하면 돼요</small></span></li>
        </ol>
        {!native && <label className="m-field"><span className="m-label">앱이 아니면: 신청 현황 화면 글자를 붙여 넣기</span>
          <TextArea className="m-input" rows={5} value={paste} onChange={event => setPaste(event.target.value)} placeholder="1365 신청 현황 화면에서 전체 선택 → 복사한 글자" /></label>}
      </> : <>
        <h1 className="m-h2">{summary && !rows.length ? '1365 봉사 실적을 찾았어요' : rows.length ? `신청 내역 ${rows.length}개를 찾았어요` : '읽을 내용을 찾지 못했어요'}</h1>
        {summary && <label className="m-check lab-sum"><input type="checkbox" checked={keepSummary} onChange={event => setKeepSummary(event.target.checked)} /><span className="m-box" />
          <span className="lab-row"><b>봉사 실적 총 {hoursText(summary.totalMinutes)}{summary.count != null ? ` · ${summary.count}건` : ''}</b>
            <small>{summary.fields.length ? summary.fields.map(f => `${f.name} ${hoursText(f.minutes)}`).join(' · ') : '분야별 시간은 ‘분야별 봉사시간 조회’ 화면에서 가져올 수 있어요'}</small></span></label>}
        {rows.length > 0 && <p className="m-help">내 활동에 넣을 것만 골라 주세요. 기간만 있는 활동은 실제로 가는 날을 골라 주세요.</p>}
        <div className="lab-rows">{rows.map((r, i) => <div key={r.title + r.periodStart} className={'lab-item' + (picked[i] && !days[i] ? ' need' : '')}>
          <label className="m-check">
            <input type="checkbox" checked={picked[i]} onChange={event => setPicked(picked.map((v, k) => k === i ? event.target.checked : v))} /><span className="m-box" />
            <span className="lab-row"><b>{r.title}</b>
              <small>{r.date ? md(r.date) : `기간 ${md(r.periodStart)} ~ ${md(r.periodEnd)}`}{r.startTime ? ' ' + r.startTime : ''}{r.labStatus ? ' · 1365 ' + r.labStatus : ''}</small></span></label>
          {!r.date && picked[i] && <div className="lab-day"><DateField label={r.title + ' · 참여하는 날'} value={days[i] ?? ''} first={r.periodStart ?? ''} last={r.periodEnd ?? ''}
            note={`1365 기간 ${md(r.periodStart)} ~ ${md(r.periodEnd)} 안에서 골라 주세요`} onChange={date => setDays(days.map((v, k) => k === i ? date : v))} /></div>}
        </div>)}</div>
      </>}
      {error && <p className="m-err" role="alert">{error}</p>}
      <p className="m-help">가져온 실적은 내 1365 화면에 나온 공식 실적을 옮긴 거예요(가져온 날 기준). 최신 실적·확인서는 1365에서 확인해 주세요.</p>
    </div>
    <ActionBar>{!rows
      ? <div className="lab-actions">{native ? <><button className="m-btn blue" onClick={() => open('S')}>실적 가져오기</button><button className="m-btn line" onClick={() => open('A')}>신청 현황 가져오기</button></>
          : <button className="m-btn" disabled={!paste.trim()} onClick={() => read(paste)}>붙여 넣은 글자 읽기</button>}
        <button type="button" className="m-text-btn" onClick={trySample}>신청 내역이 없다면 · 예시로 해보기</button></div>
      : rows.length || summary ? <button className="m-btn" disabled={busy || undated > 0 || (!count && !(summary && keepSummary))} onClick={save}>{undated ? `참여하는 날을 골라 주세요 (${undated}개)` : sample ? '예시 확인 끝 (저장 안 함)' : rows.length ? `${count}개 내 활동에 넣기` : '실적 가져오기'}</button>
      : <button className="m-btn line" onClick={() => setRows(null)}>다시 하기</button>}</ActionBar>
  </div>
}
