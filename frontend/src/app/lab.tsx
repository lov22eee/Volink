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
import { AddApplicationSheet } from './record'
import { ActionBar, MIcon, Sheet, TextArea, TopBar } from './ui'

const lab = registerPlugin<{ open(options: { guide: string; step?: string; target?: 'S' | 'A' | 'P'; url?: string; next?: string; program?: string; other?: string }): Promise<{ text: string; texts?: string[]; host?: string; applied?: boolean }> }>('VolinkLab')
/** The two 1365 pages (addresses from the user's phone, 2026-11-06): opened directly, so nobody has to find them in the menu. */
export const PAGE_1365 = { S: 'https://www.1365.go.kr/vols/1472178091420/mypage/partcptnAcmslt.do', A: 'https://www.1365.go.kr/vols/1472178171182/mypage/reqstDtls.do' } as const
const KEY = 'volink.lab1365'
/** Set after the first time something was brought in from 1365: from then on a card asks 1365에서 가져오기 / 직접 추가하기. */
const USED = 'volink.lab1365.used'

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
  if (sum || app) return '3-|③ ' + want + ' 화면으로 이동하고 있어요';
  if (pw) return '1-|① 1365 아이디·비밀번호나 간편인증으로 로그인해 주세요';
  var inside = /로그아웃/.test(s) || /로그아웃/.test(String(full || '')) || !!was;
  if (inside) return '2-|② ' + want + ' 화면으로 이동하고 있어요';
  return '1-|① 1365에 로그인해 주세요. 로그인하면 ' + want + ' 화면으로 바로 가요';
`
/** The same rule in the app (tests). */
export function labStep(text: string, password: boolean, tookSummary = false, tookApplications = false, full = '', wasLogin = false, target: '' | 'S' | 'A' = ''): { step: number; kind: string; line: string } {
  const out = String(new Function('t', 'pw', 'ds', 'da', 'full', 'was', 'tg', LAB_STEP_BODY)(text, password, tookSummary, tookApplications, full, wasLogin, target))
  return { step: Number(out.slice(0, 1)), kind: out.slice(1, 2), line: out.slice(3) }
}

/** What happens when connecting (2026-11-07: shown every time a card is tapped, before 1365 opens). */
function ConsentSheet({ onAgree, onClose }: { onAgree: () => void; onClose: () => void }) {
  return <Sheet title="연결 전에 확인해 주세요" onClose={onClose}
    footer={<><button type="button" className="m-btn blue" onClick={onAgree}>동의하고 계속하기</button>
      <button type="button" className="m-btn line" onClick={onClose}>다음에 할게요</button></>}>
    <ul className="lab-consent">
      <li><MIcon name="lock" size={18} /><span><b>비밀번호는 Volink로 오지 않아요</b><small>1365에 직접 로그인하고, 창을 닫으면 로그아웃돼요</small></span></li>
      <li><MIcon name="record" size={18} /><span><b>필요한 것만 가져와요</b><small>봉사시간·건수와 내가 체크한 활동만 저장해요. 이름은 저장하지 않아요</small></span></li>
      <li><MIcon name="checkCircle" size={18} /><span><b>가져온 날 기준이에요</b><small>이후에 늘어난 실적은 다시 가져오면 돼요</small></span></li>
      <li><MIcon name="alert" size={18} /><span><b>1365 화면이 바뀌면 안 될 수 있어요</b><small>업데이트 전까지 신청은 직접 등록해 주세요</small></span></li>
    </ul>
  </Sheet>
}

/** 1365에서 가져오기 / 직접 추가하기 for the 실적 (S) or 신청 현황 (A) card (2026-11-07). */
function WaysSheet({ target, note, onClose, on1365, onAdd }: { target: 'S' | 'A'; note?: string; onClose: () => void; on1365: () => void; onAdd: () => void }) {
  return <Sheet title={target === 'S' ? '봉사참여 실적' : '신청 현황'} onClose={onClose}>
    <div className="lab-ways">
      <button type="button" className="lab-way" onClick={on1365}><span className="lab-way-ico"><MIcon name="refresh" size={20} /></span>
        <span><b>1365에서 가져오기</b><small>{target === 'S' ? '1365에 로그인해 총 시간·건수를 가져와요' : '1365 신청 내역을 그대로 가져와요'}</small></span></button>
      <button type="button" className="lab-way" onClick={onAdd}><span className="lab-way-ico"><MIcon name="search" size={20} /></span>
        <span><b>1365 활동 찾아서 넣기</b><small>신청한 1365 활동을 검색해서 골라요</small></span></button>
    </div>
    <p className="m-help">{note ? note + ' · ' : ''}비밀번호는 Volink로 오지 않아요</p>
  </Sheet>
}

/**
 * 내 활동의 빈 화면 [가져오기] (2026-11-07): the same 1365에서 가져오기 / 직접 추가하기 sheet as on the 1365 screen, here.
 * 1365에서 가져오기 → consent → the 1365 screen opens that page right away (#/lab1365?go=S|A). {@code onSaved} after 직접 추가.
 */
export function useImport1365(onSaved?: () => void): [ReactNode, (target: 'S' | 'A') => void] {
  const [choosing, setChoosing] = useState<'' | 'S' | 'A'>('')
  const [asking, setAsking] = useState<'' | 'S' | 'A'>('')
  const [adding, setAdding] = useState<'' | 'S' | 'A'>('')
  const node = <>
    {choosing && <WaysSheet target={choosing} onClose={() => setChoosing('')} on1365={() => { const t = choosing; setChoosing(''); setAsking(t) }} onAdd={() => { const t = choosing; setChoosing(''); setAdding(t) }} />}
    {asking && <ConsentSheet onClose={() => setAsking('')} onAgree={() => { const t = asking; setAsking(''); setLabOn(true); window.location.hash = '#/lab1365?go=' + t }} />}
    {adding === 'A' && <AddApplicationSheet onClose={() => setAdding('')} onSaved={onSaved} />}
  </>
  // 완료 기록 [가져오기]: 실적 is 1365에서 가져오기 only (2026-11-07; 확인서 PDF·사진 again in week 7) → consent right away.
  // 참여 예정 keeps 1365에서 가져오기 / 1365 활동 찾기.
  return [node, (target: 'S' | 'A') => target === 'S' ? setAsking('S') : setChoosing(target)]
}

/**
 * "1365 봉사실적 연결하기" from anywhere (마이, 완료 기록, 설정, 시작 안내): the lab turns on and its screen opens. The consent
 * sheet comes when a card there is tapped (2026-11-07). Returns nothing to render (kept for callers) and the function to start.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useConnect1365(_onCancel?: () => void): [ReactNode, () => void] {
  return [null, () => { setLabOn(true); window.location.hash = '#/lab1365' }]
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

/**
 * 1365 신청 반자동 (2026-11-08, app only): 1365 login first, then the program page in the in-app window; the person applies there
 * themselves. When 1365 says it went through, the window reads 신청 현황 and comes back. Null = closed without applying
 * (or not the app). The app never presses 신청 or ticks a consent box.
 */
export async function applyIn1365(url: string): Promise<{ applied: boolean; texts: string[] } | null> {
  if (!Capacitor.isNativePlatform() || !url.startsWith('https://www.1365.go.kr/')) return null
  try {
    // Login first: the 신청 현황 page asks for it; once logged in the window goes to the program page by itself.
    const out = await lab.open({ guide: '', target: 'P', url: PAGE_1365.A, next: PAGE_1365.A, program: url })
    const texts = (out.texts ?? (out.text ? [out.text] : [])).filter(Boolean)
    return out.applied || texts.length ? { applied: Boolean(out.applied), texts } : null
  } catch { return null }
}

/** The row of the 신청 현황 text that is this program (same name, ignoring spaces and signs), on a day in its period. */
export function findApplied(texts: string[], title: string, first?: string | null, last?: string | null): LabRow | null {
  const key = (s: string) => s.replace(/[\s·\-_()[\]「」『』<>〈〉"'.,!?~]/g, '')
  const want = key(title)
  const rows = texts.flatMap(parseLabText).filter(r => { const got = key(r.title); return got && (got === want || got.includes(want) || want.includes(got)) })
  const inside = rows.find(r => !r.date || ((!first || r.date >= first) && (!last || r.date <= last)))
  return inside ?? rows[0] ?? null
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

/** One finished activity from the list under the 1365 봉사참여 실적 page (V32): 시간인증형 with its hours, 활동인증형 counted once. */
export type LabDone = { title: string; date: string; minutes: number | null; kind: 'TIME' | 'ACTIVITY'; startTime?: string; endTime?: string; organization?: string }

const compact = (s: string) => s.replace(/\s+/g, '')
/** The 실적 list page (either tab): its header and the 봉사일자 rows. */
export const isRecordPage = (text: string) => /자원봉사실적/.test(compact(text)) && /(봉사|활동)일자/.test(compact(text))

/**
 * Reads the rows of the 1365 실적 list (2026-11-07, from the page: “[적십자사] 헌혈실적연계 · 봉사일자 2023.12.14 · 봉사시간
 * 05:01~05:02 (4시간 0분) · 인증기관 VMS · 모집기관 대한적십자사혈액관리본부”). The tab is told by the list header
 * (시간인증형 / 활동인증형 자원봉사 실적). Labels and values may be on one line or on their own lines.
 */
export function parseLabRecords(text: string): LabDone[] {
  const lines = text.replace(/\r/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const all = compact(text)
  const kind: LabDone['kind'] = all.includes('활동인증형자원봉사실적') && !all.includes('시간인증형자원봉사실적') ? 'ACTIVITY' : 'TIME'
  const badge = /^(시간인증|활동인증)\s*/
  const starts = lines.map((l, i) => /^(봉사|활동)\s*일자/.test(l) ? i : -1).filter(i => i >= 0)
  const out: LabDone[] = []
  starts.forEach((at, n) => {
    let k = at - 1
    while (k >= 0 && /^(시간인증|활동인증)$/.test(lines[k])) k--
    const title = (lines[k] ?? '').replace(badge, '').trim()
    if (title.length < 2 || /^(봉사|활동|모집|인증|중복)/.test(title) || /현재페이지|전체\s*\d+건|모두선택/.test(title)) return
    const block = lines.slice(at, Math.min(starts[n + 1] ?? lines.length, at + 14) - (starts[n + 1] ? 1 : 0)).join(' ')
    const day = new RegExp(DATE.source).exec(block)
    if (!day) return
    const paren = /\(\s*(\d{1,4})\s*시간\s*(?:(\d{1,2})\s*분)?\s*\)/.exec(block) ?? /(\d{1,4})\s*시간\s*(\d{1,2})\s*분/.exec(block)
    const time = TIME.exec(block)
    const org = /모집\s*기관\s*:?\s*(.+?)(?=\s+(?:중복\s*여부|인증\s*기관|봉사|활동|시간인증|활동인증)|$)/.exec(block)
    out.push({ title: title.slice(0, 120), date: ymdOf(day), kind, minutes: kind === 'TIME' && paren ? Number(paren[1]) * 60 + Number(paren[2] ?? 0) : null,
      startTime: time ? `${time[1].padStart(2, '0')}:${time[2]}` : undefined, endTime: time ? `${time[3].padStart(2, '0')}:${time[4]}` : undefined,
      organization: org ? org[1].trim().slice(0, 120) : undefined })
  })
  return out.slice(0, 300)
}

export function LabScreen({ go }: { go?: string }) {
  const native = Capacitor.isNativePlatform()
  // On the web (no in-app browser) a card opens the paste box for that page.
  const [webFor, setWebFor] = useState<'' | 'S' | 'A'>('')
  // The card tapped: the consent sheet first, then that 1365 page (2026-11-07).
  const [asking, setAsking] = useState<'' | 'S' | 'A'>('')
  // The page last asked for, so 다시 가져오기 opens it again; for 신청 현황, 직접 등록하기 = 1365 활동 찾아서 넣기.
  const [lastTarget, setLastTarget] = useState<'' | 'S' | 'A'>('')
  // After the first connection (2026-11-07): a card opens 1365에서 가져오기 / 직접 추가하기 first; 1365에서 가져오기 still asks the consent sheet every time.
  const [choosing, setChoosing] = useState<'' | 'S' | 'A'>('')
  const [adding, setAdding] = useState<'' | 'S' | 'A'>('')
  const used = () => { try { return localStorage.getItem(USED) === '1' } catch { return false } }
  // 실적: 1365에서 가져오기 only (2026-11-07; 확인서 PDF·사진 in week 7). 신청: after a first connection also 1365 활동 찾기.
  const tap = (target: 'S' | 'A') => target === 'A' && (last || used()) ? setChoosing(target) : setAsking(target)
  const go1365 = (target: 'S' | 'A') => { setLastTarget(target); if (native) open(target); else setWebFor(target) }
  // From 내 활동 [가져오기] (consent already given there): straight to that 1365 page, once.
  useEffect(() => {
    if (go !== 'S' && go !== 'A') return
    window.history.replaceState(null, '', '#/lab1365')
    go1365(go)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [last, setLast] = useState<(LabSummary & { fetchedAt: string }) | null>(null)
  useEffect(() => { api<LabSummary & { fetchedAt?: string }>('/api/me/external/summary').then(x => setLast(x.fetchedAt ? x as LabSummary & { fetchedAt: string } : null)).catch(() => {}) }, [])
  const [rows, setRows] = useState<LabRow[] | null>(null)
  const [summary, setSummary] = useState<LabSummary | null>(null)
  const [keepSummary, setKeepSummary] = useState(true)
  const [picked, setPicked] = useState<boolean[]>([])
  // The day the person goes, for rows where 1365 shows only a period (11/12 ~ 11/30).
  const [days, setDays] = useState<string[]>([])
  const [paste, setPaste] = useState('')
  // The 1365 실적 list (V32): every finished activity, and which are already in 내 활동 (same name and day).
  const [done, setDone] = useState<LabDone[]>([])
  const [donePicked, setDonePicked] = useState<boolean[]>([])
  const [mine, setMine] = useState<{ title: string; date: string; status: string; extKind: string | null }[]>([])
  const [activityCount, setActivityCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** One or more pages taken in one visit: the 실적 page gives the total, the 신청 현황 page the rows. */
  function read(input: string | string[]) {
    const pages = (Array.isArray(input) ? input : [input]).filter(Boolean)
    let total: LabSummary | null = null
    const found: LabRow[] = []
    const finished: LabDone[] = []
    let acts: number | null = null
    for (const page of pages) {
      const sum = parseLabSummary(page)
      if (sum && !total) total = sum
      if (isRecordPage(page)) {
        for (const row of parseLabRecords(page)) if (!finished.some(r => r.title === row.title && r.date === row.date && r.kind === row.kind)) finished.push(row)
        const a = /활동인증형활동건수총(\d{1,5})건/.exec(compact(page))
        if (a) acts = Number(a[1])
        continue
      }
      if (sum) continue
      for (const row of parseLabText(page)) if (!found.some(r => r.title === row.title && r.date === row.date) && found.length < 20) found.push(row)
    }
    finished.sort((a, b) => b.date.localeCompare(a.date))
    setDone(finished)
    setActivityCount(acts)
    if (finished.length) api<{ title: string; date: string; status: string; extKind: string | null }[]>('/api/me/external').then(list => {
      setMine(list)
      setDonePicked(finished.map(r => !list.some(m => m.title === r.title && m.date === r.date && m.extKind)))
    }).catch(() => setDonePicked(finished.map(() => true)))
    else setDonePicked([])
    setRows(found)
    setSummary(total)
    setPicked(found.map(() => true))
    setDays(found.map(r => r.date))
    setError('')
  }
  /** One page per visit (2026-11-06: going on to the second page in the same visit confused the guide): 실적 or 신청 현황. */
  async function open(target: 'S' | 'A') {
    setError('')
    setLastTarget(target)
    const guide = target === 'S' ? '로그인하면 ‘봉사참여 실적’ 화면으로 바로 가요' : '로그인하면 ‘신청 현황’ 화면으로 바로 가요'
    // A안 (2026-11-08): after the first page the 1365 window offers the other one (one login), so both may come back.
    try { const got = await lab.open({ guide, step: LAB_STEP_BODY, target, url: PAGE_1365[target], other: PAGE_1365[target === 'S' ? 'A' : 'S'] }); read(got.texts?.length ? got.texts : got.text ?? '') } catch { /* closed without taking the page */ }
  }
  /** The 실적 list: picked rows → finished 1365 activities (waiting ones of the same name and day become 실적 반영됨), then the total. */
  async function saveDone() {
    const items = done.filter((_, i) => donePicked[i])
    setBusy(true)
    try {
      const result = items.length ? await api<{ added: number; matched: number }>('/api/me/external/import', 'POST', { items }) : { added: 0, matched: 0 }
      if (summary) await api('/api/me/external/summary', 'PUT', { ...summary, listed: true })
      showToast(result.added || result.matched ? `1365 실적 ${result.added + result.matched}건을 넣었어요` : '새로 넣을 실적은 없어요',
        result.matched ? `참여 예정이던 ${result.matched}건은 실적 반영됨으로 바꿨어요` : '완료 기록에서 볼 수 있어요')
      try { localStorage.setItem(USED, '1') } catch { /* asked with the consent sheet again */ }
      window.location.hash = '#/mine?tab=done'
    } catch (cause) { setError(cause instanceof ApiError ? Object.values(cause.fieldErrors)[0] ?? cause.message : '잠시 후 다시 시도해 주세요.') } finally { setBusy(false) }
  }
  /** 실적 and 신청 현황 from one visit (A안): finished activities, the total, and the picked applications in one go. */
  async function saveBoth() {
    const finished = done.filter((_, i) => donePicked[i])
    const applied = (rows ?? []).map((r, i) => ({ ...r, date: days[i] })).filter((_, i) => picked[i])
    setBusy(true)
    try {
      const got = finished.length ? await api<{ added: number; matched: number }>('/api/me/external/import', 'POST', { items: finished }) : { added: 0, matched: 0 }
      if (summary) await api('/api/me/external/summary', 'PUT', { ...summary, listed: true })
      const planned = applied.length ? await api<{ added: number }>('/api/me/external/import', 'POST', { items: applied }) : { added: 0 }
      showToast(`1365에서 ${got.added + got.matched + planned.added}건을 넣었어요`, `실적 ${got.added + got.matched}건 · 신청 ${planned.added}건 · 내 활동에서 볼 수 있어요`)
      try { localStorage.setItem(USED, '1') } catch { /* asked with the consent sheet again */ }
      window.location.hash = '#/mine'
    } catch (cause) { setError(cause instanceof ApiError ? Object.values(cause.fieldErrors)[0] ?? cause.message : '잠시 후 다시 시도해 주세요.') } finally { setBusy(false) }
  }
  async function save() {
    const items = (rows ?? []).map((r, i) => ({ ...r, date: days[i] })).filter((_, i) => picked[i])
    const total = summary && keepSummary ? summary : null
    if (!items.length && !total) return
    setBusy(true)
    try {
      const result = items.length ? await api<{ added: number }>('/api/me/external/import', 'POST', { items }) : { added: 0 }
      // A larger count than last time: that many waiting 1365 activities become 실적 반영됨(추정) on the server.
      const saved = total ? await api<{ count?: number; before?: number | null; reflected?: number }>('/api/me/external/summary', 'PUT', total) : null
      if (saved?.reflected) showToast(`실적이 늘었어요 ${saved.before}→${saved.count}건`, `활동 ${saved.reflected}개를 ‘실적 반영됨(추정)’으로 바꿨어요`)
      else if (saved && saved.before != null && saved.before === saved.count) showToast('새로 늘어난 실적은 아직 없어요', '1365에 반영되기까지 며칠 걸릴 수 있어요')
      else showToast(total ? '1365 봉사 실적을 가져왔어요' : result.added ? `내 활동에 ${result.added}개를 넣었어요` : '이미 넣은 활동이에요', '내 활동에서 볼 수 있어요')
      try { localStorage.setItem(USED, '1') } catch { /* asked with the consent sheet again */ }
      window.location.hash = total ? '#/mine?tab=done' : '#/mine'
    } catch (cause) { setError(cause instanceof ApiError ? Object.values(cause.fieldErrors)[0] ?? cause.message : '잠시 후 다시 시도해 주세요.') } finally { setBusy(false) }
  }
  const failed = rows !== null && !rows.length && !summary && !done.length
  const listed = done.length > 0
  const both = listed && (rows?.length ?? 0) > 0
  const had = (r: LabDone) => mine.some(m => m.title === r.title && m.date === r.date && m.extKind)
  const waits = (r: LabDone) => mine.some(m => m.title === r.title && m.date === r.date && !m.extKind)
  const doneCount = donePicked.filter(Boolean).length
  const timeRows = done.filter(r => r.kind === 'TIME'), actRows = done.filter(r => r.kind === 'ACTIVITY')
  const dots = (d: string) => d.replaceAll('-', '.')
  const count = picked.filter(Boolean).length
  const undated = (rows ?? []).filter((_, i) => picked[i] && !days[i]).length
  const md = (d?: string) => d ? d.slice(5).replace('-', '/') : ''
  return <div className="m-screen">
    <TopBar title="1365 연결" back="history" />
    <div className={'m-body lab' + (!rows || failed ? ' pick' : '')}>
      {rows && !failed && <span className="lab-tag"><MIcon name="flask" size={13} />실험 기능</span>}
      {!rows ? <div className="lab-pick">
        {/* 2026-11-06 (A): two cards; each opens its own 1365 page. The app's own line icons only. 2026-11-07: in the middle of the screen. */}
        <span className="lab-tag"><MIcon name="flask" size={13} />실험 기능</span>
        <h1 className="m-h2">무엇을 가져올까요?</h1>
        <p className="lab-sub">1365에 있는 내 기록을 바로 가져와요</p>
        {last && <p className="lab-last"><MIcon name="checkCircle" size={16} />마지막으로 가져온 실적 <b>{hoursText(last.totalMinutes)}{last.count != null ? ` · ${last.count}건` : ''}</b> · {last.fetchedAt.slice(5, 10).replace('-', '/')}</p>}
        <div className="lab-choices">
          <button type="button" className="lab-choice" onClick={() => tap('S')}>
            <span className="lab-choice-ico"><MIcon name="timer" size={24} /></span>
            <span><b>봉사참여 실적</b><small>총 봉사시간·건수</small></span><MIcon name="chevron" size={18} /></button>
          <button type="button" className="lab-choice" onClick={() => tap('A')}>
            <span className="lab-choice-ico g"><MIcon name="list" size={24} /></span>
            <span><b>신청 현황</b><small>신청한 활동</small></span><MIcon name="chevron" size={18} /></button>
        </div>
        <ul className="lab-safe">
          <li><MIcon name="lock" size={14} />비밀번호는 Volink로 오지 않아요</li>
          <li><MIcon name="user" size={14} />이름은 저장하지 않아요</li>
        </ul>
        {!native && webFor && <label className="m-field"><span className="m-label">앱이 아니면: 1365 {webFor === 'S' ? '봉사참여 실적' : '신청 현황'} 화면 글자를 붙여 넣기</span>
          <TextArea className="m-input" rows={5} value={paste} onChange={event => setPaste(event.target.value)} placeholder="1365 신청 현황 화면에서 전체 선택 → 복사한 글자" /></label>}
      </div> : <>
        {listed ? <>
          {/* 2026-11-07 (V32): the whole 1365 실적 list, both tabs, every period. */}
          <h1 className="m-h2">{both ? '1365에서 가져왔어요' : `1365 실적 ${done.length}건을 찾았어요`}</h1>
          {both && <p className="lab-sub left">고른 것만 내 활동에 넣어요</p>}
          {both && <h2 className="lab-sec">봉사참여 실적 · {done.length}건</h2>}
          <div className="lab-got"><b>{summary ? hoursText(summary.totalMinutes) : hoursText(timeRows.reduce((s, r) => s + (r.minutes ?? 0), 0))} · {done.length}건</b>
            <small>시간인증 {timeRows.length}건{actRows.length || activityCount ? ` · 활동인증 ${actRows.length || activityCount}건` : ''} · 1365 공식 실적 · 오늘 기준</small></div>
          {summary?.count != null && summary.count !== timeRows.length && <p className="m-err">1365에는 시간인증 {summary.count}건인데 {timeRows.length}건만 읽었어요. 다시 가져오면 맞춰질 수 있어요.</p>}
          <div className="lab-rows">{done.map((r, i) => <div key={r.kind + r.title + r.date + i} className={'lab-item' + (had(r) ? ' had' : '')}>
            <label className="m-check">
              <input type="checkbox" disabled={had(r)} checked={Boolean(donePicked[i])} onChange={event => setDonePicked(donePicked.map((v, k) => k === i ? event.target.checked : v))} /><span className="m-box" />
              <span className="lab-row"><b>{r.title}<em className={'lab-kind' + (r.kind === 'ACTIVITY' ? ' act' : '')}>{r.kind === 'TIME' ? '시간인증' : '활동인증'}</em></b>
                <small>{dots(r.date)} · {r.kind === 'TIME' ? (r.minutes != null ? hoursText(r.minutes) : '시간 미정') : '활동 1회'}{had(r) ? ' · 이미 넣었어요' : waits(r) ? ' · 참여 예정과 같아 실적 반영됨으로 바꿔요' : ''}</small></span></label>
          </div>)}</div>
        </>
        : !rows.length && !summary ? <div className="lab-fail">
          {/* 2026-11-07: not found → what may have happened, and the next step right here (again / by hand / later). */}
          <span className="lab-fail-ico"><MIcon name="alert" size={30} /></span>
          <h1 className="m-h2">1365 화면을 읽지 못했어요</h1>
          <p className="lab-sub">1365 화면이 바뀌었거나<br />아직 기록이 없을 수 있어요</p>
          <ul className="lab-fail-why">
            <li>실적·신청 내역 화면에서 버튼을 눌렀는지 확인해 주세요</li>
            <li>계속 안 되면 잠시 뒤 다시 가져와 주세요</li>
          </ul>
        </div>
        : <h1 className="m-h2">{summary && !rows.length ? '1365 봉사 실적을 찾았어요' : `신청 내역 ${rows.length}개를 찾았어요`}</h1>}
        {summary && !listed && <label className="m-check lab-sum"><input type="checkbox" checked={keepSummary} onChange={event => setKeepSummary(event.target.checked)} /><span className="m-box" />
          <span className="lab-row"><b>봉사 실적 총 {hoursText(summary.totalMinutes)}{summary.count != null ? ` · ${summary.count}건` : ''}</b>
            <small>{summary.fields.length ? summary.fields.map(f => `${f.name} ${hoursText(f.minutes)}`).join(' · ') + ' · ' : ''}1365 공식 실적 · 오늘 기준</small></span></label>}
        {both ? <h2 className="lab-sec">신청 현황 · {rows.length}건</h2> : rows.length > 0 && <p className="m-help">넣을 것만 골라 주세요.</p>}
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
    </div>
    {asking && <ConsentSheet onClose={() => setAsking('')} onAgree={() => { const t = asking; setAsking(''); go1365(t) }} />}
    {choosing && <WaysSheet target={choosing} note={last ? `마지막 연동 ${last.fetchedAt.slice(5, 10).replace('-', '/')}` : undefined} onClose={() => setChoosing('')}
      on1365={() => { const t = choosing; setChoosing(''); setAsking(t) }} onAdd={() => { const t = choosing; setChoosing(''); setAdding(t) }} />}
    {adding === 'A' && <AddApplicationSheet onClose={() => setAdding('')} />}
    {(rows || (!native && webFor)) && <ActionBar>{!rows
      ? (native ? null : webFor ? <button className="m-btn" disabled={!paste.trim()} onClick={() => read(paste)}>붙여 넣은 글자 읽기</button> : null)
      : both ? <button className="m-btn" disabled={busy || undated > 0 || (!doneCount && !count && !summary)} onClick={saveBoth}>{undated ? `참여하는 날을 골라 주세요 (${undated}개)` : `${doneCount + count}건 내 활동에 넣기`}</button>
      : listed ? <button className="m-btn" disabled={busy || (!doneCount && !summary)} onClick={saveDone}>{doneCount ? `${doneCount}건 완료 기록에 넣기` : '새로 넣을 실적이 없어요 · 합계만 갱신'}</button>
      : rows.length || summary ? <button className="m-btn" disabled={busy || undated > 0 || (!count && !(summary && keepSummary))} onClick={save}>{undated ? `참여하는 날을 골라 주세요 (${undated}개)` : rows.length ? `${count}개 내 활동에 넣기` : '실적 가져오기'}</button>
      : <div className="lab-actions">
        <button className="m-btn" onClick={() => { setRows(null); setPaste(''); if (native && lastTarget) open(lastTarget) }}>다시 가져오기</button>
        {lastTarget === 'A' && <button className="m-btn line" onClick={() => setAdding('A')}>직접 등록하기</button>}
        <button className="m-text-btn" onClick={() => { setRows(null); setWebFor('') }}>나중에 할게요</button>
      </div>}</ActionBar>}
  </div>
}
