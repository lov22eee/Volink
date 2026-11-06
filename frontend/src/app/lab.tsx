// 실험실 · 1365 연결 (2026-11-06, off by default; 마이 › 설정 › 실험실). The person logs in to 1365 in an in-app browser
// (native VolinkLab plugin), opens their own application list and taps "이 화면 가져오기": the page's visible text comes back,
// the rows are read on the phone, and only the rows the person picks are saved (title, day, time, 1365 status).
// The password never reaches Volink; the 1365 login is cleared when that screen closes. Without the app (web), the text can be pasted.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { api, ApiError } from '../api'
import { showToast } from '../App'
import { ActionBar, MIcon, Sheet, TextArea, TopBar } from './ui'

const lab = registerPlugin<{ open(options: { guide: string }): Promise<{ text: string; host?: string }> }>('VolinkLab')
const KEY = 'volink.lab1365'

const AGREED = 'volink.lab1365.agreed'
/** The one line shown above the 1365 page in the app (plan 1, 2026-11-06): where to go after logging in. */
export const LAB_GUIDE = '로그인 → ☰ 메뉴 › 나의 봉사 › 봉사참여 실적(또는 신청 현황) → 위 ‘이 화면 가져오기’'
const agreed = () => { try { return localStorage.getItem(AGREED) === '1' } catch { return false } }

/**
 * "1365 봉사실적 연결하기" from anywhere (마이, 완료 기록, 설정): the first time a consent sheet, then the lab turns on and its
 * screen opens. Returns the sheet to render and the function to start.
 */
export function useConnect1365(): [ReactNode, () => void] {
  const [open, setOpen] = useState(false)
  const go = () => { setLabOn(true); window.location.hash = '#/lab1365' }
  const start = () => agreed() ? go() : setOpen(true)
  const sheet = open && <Sheet title="연결 전에 확인해 주세요" onClose={() => setOpen(false)}
    footer={<><button type="button" className="m-btn blue" onClick={() => { try { localStorage.setItem(AGREED, '1') } catch { /* asked again next time */ } setOpen(false); go() }}>동의하고 계속하기</button>
      <button type="button" className="m-btn line" onClick={() => setOpen(false)}>다음에 할게요</button></>}>
    <span className="lab-tag"><MIcon name="flask" size={13} />실험 기능</span>
    <ul className="lab-consent">
      <li><MIcon name="lock" size={18} /><span><b>비밀번호는 Volink로 오지 않아요</b><small>1365 화면에 직접 로그인하고, 닫으면 로그인도 지워요</small></span></li>
      <li><MIcon name="record" size={18} /><span><b>내가 연 화면의 글자만 폰 안에서 읽어요</b><small>총 시간·건수·분야와 고른 신청 내역만 남기고, 이름은 남기지 않아요</small></span></li>
      <li><MIcon name="checkCircle" size={18} /><span><b>공식 실적이 아니에요</b><small>Volink가 확인한 기록이 아니에요. 공식 실적은 1365 기준이에요</small></span></li>
      <li><MIcon name="alert" size={18} /><span><b>1365 화면이 바뀌면 멈출 수 있어요</b><small>그때는 ‘이미 신청했어요’나 실적확인서로 넣어 주세요</small></span></li>
    </ul>
  </Sheet>
  return [sheet, start]
}

export function labOn() { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
export function setLabOn(on: boolean) { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY) } catch { /* private mode: stays off */ } }

export type LabRow = { title: string; date: string; startTime?: string; endTime?: string; labStatus?: string }
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
const DATE = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/
const TIME = /([01]?\d|2[0-3]):([0-5]\d)\s*[~\-–]\s*([01]?\d|2[0-3]):([0-5]\d)/

/**
 * Reads application rows from the text of a 1365 list page: each line (or line pair) with a date becomes a row; the title is
 * the longest remaining Korean text on that line or the line above, the status a known 1365 word. The person checks every row.
 */
export function parseLabText(text: string): LabRow[] {
  const lines = text.replace(/\r/g, '').split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const rows: LabRow[] = []
  const seen = new Set<string>()
  lines.forEach((line, i) => {
    const d = DATE.exec(line)
    if (!d) return
    const date = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`
    const time = TIME.exec(line) ?? TIME.exec(lines[i + 1] ?? '')
    const status = STATUS.exec(line)?.[1] ?? STATUS.exec(lines[i + 1] ?? '')?.[1]
    const clean = (s: string) => s.replace(DATE, ' ').replace(TIME, ' ').replace(STATUS, ' ').replace(/[~|·:\[\]()]/g, ' ').replace(/\s+/g, ' ').trim()
    const candidates = [clean(line), clean(lines[i - 1] ?? '')].filter(s => /[가-힣]{2,}/.test(s) && !/^(신청일|활동일|봉사일|기간|일시|상태)\b/.test(s))
    const title = candidates.sort((a, b) => b.length - a.length)[0]
    if (!title || title.length < 2) return
    const key = title + date
    if (seen.has(key)) return
    seen.add(key)
    rows.push({ title: title.slice(0, 120), date, startTime: time ? `${time[1].padStart(2, '0')}:${time[2]}` : undefined, endTime: time ? `${time[3].padStart(2, '0')}:${time[4]}` : undefined, labStatus: status?.replace(/\s+/g, '') })
  })
  return rows.slice(0, 20)
}

export function LabScreen() {
  const native = Capacitor.isNativePlatform()
  const [rows, setRows] = useState<LabRow[] | null>(null)
  const [summary, setSummary] = useState<LabSummary | null>(null)
  const [keepSummary, setKeepSummary] = useState(true)
  const [picked, setPicked] = useState<boolean[]>([])
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  function read(text: string) {
    const found = parseLabText(text)
    const total = parseLabSummary(text)
    setRows(found)
    setSummary(total)
    setPicked(found.map(() => true))
    setError(found.length || total ? '' : '읽을 내용을 찾지 못했어요. 1365 ‘나의 봉사’의 신청 현황이나 봉사참여 실적 화면에서 가져와 주세요.')
  }
  async function open() {
    setError('')
    try { read((await lab.open({ guide: LAB_GUIDE })).text ?? '') } catch { /* closed without taking the page */ }
  }
  async function save() {
    const items = (rows ?? []).filter((_, i) => picked[i])
    const total = summary && keepSummary ? summary : null
    if (!items.length && !total) return
    setBusy(true)
    try {
      if (total) await api('/api/me/external/summary', 'PUT', total)
      const result = items.length ? await api<{ added: number }>('/api/me/external/import', 'POST', { items }) : { added: 0 }
      showToast(total ? '1365 봉사 실적을 가져왔어요' : result.added ? `내 활동에 ${result.added}개를 넣었어요` : '이미 넣은 활동이에요', '내 활동 › 완료 기록에서 볼 수 있어요')
      window.location.hash = total ? '#/mine?tab=done' : '#/mine'
    } catch (cause) { setError(cause instanceof ApiError ? Object.values(cause.fieldErrors)[0] ?? cause.message : '잠시 후 다시 시도해 주세요.') } finally { setBusy(false) }
  }
  const count = picked.filter(Boolean).length
  return <div className="m-screen">
    <TopBar title="1365 연결" back="history" />
    <div className="m-body lab">
      <span className="lab-tag"><MIcon name="flask" size={13} />실험 기능</span>
      {!rows ? <>
        <h1 className="m-h2">이렇게 가져와요</h1>
        <p className="m-help">1365에서 세 번만 누르면 돼요. 1365 화면 위에도 같은 안내가 떠요.</p>
        <ol className="lab-guide">
          <li><b>1</b><span><strong>1365에 로그인</strong><small>아이디나 간편인증으로 직접 로그인해요</small></span></li>
          <li><b>2</b><span><strong>☰ 메뉴 › 나의 봉사 › 봉사참여 실적</strong><small>신청한 활동은 ‘신청 현황’으로 가요</small></span></li>
          <li><b>3</b><span><strong>위쪽 ‘이 화면 가져오기’</strong><small>그 화면의 총 시간·건수·분야(또는 신청 목록)만 읽어요</small></span></li>
        </ol>
        {!native && <label className="m-field"><span className="m-label">앱이 아니면: 신청 현황 화면 글자를 붙여 넣기</span>
          <TextArea className="m-input" rows={5} value={paste} onChange={event => setPaste(event.target.value)} placeholder="1365 신청 현황 화면에서 전체 선택 → 복사한 글자" /></label>}
      </> : <>
        <h1 className="m-h2">{summary && !rows.length ? '1365 봉사 실적을 찾았어요' : rows.length ? `신청 내역 ${rows.length}개를 찾았어요` : '읽을 내용을 찾지 못했어요'}</h1>
        {summary && <label className="m-check lab-sum"><input type="checkbox" checked={keepSummary} onChange={event => setKeepSummary(event.target.checked)} /><span className="m-box" />
          <span className="lab-row"><b>봉사 실적 총 {hoursText(summary.totalMinutes)}{summary.count != null ? ` · ${summary.count}건` : ''}</b>
            <small>{summary.fields.length ? summary.fields.map(f => `${f.name} ${hoursText(f.minutes)}`).join(' · ') : '분야별 시간은 ‘분야별 봉사시간 조회’ 화면에서 가져올 수 있어요'}</small></span></label>}
        {rows.length > 0 && <p className="m-help">내 활동에 넣을 것만 골라 주세요. 지난 활동은 ‘다녀옴’으로 들어가요.</p>}
        <div className="lab-rows">{rows.map((r, i) => <label key={r.title + r.date} className="m-check">
          <input type="checkbox" checked={picked[i]} onChange={event => setPicked(picked.map((v, k) => k === i ? event.target.checked : v))} /><span className="m-box" />
          <span className="lab-row"><b>{r.title}</b><small>{r.date.slice(5).replace('-', '/')}{r.startTime ? ' ' + r.startTime : ''}{r.labStatus ? ' · 1365 ' + r.labStatus : ''}</small></span></label>)}</div>
      </>}
      {error && <p className="m-err" role="alert">{error}</p>}
      <p className="m-help">Volink가 1365 신청이나 실적을 확인하는 기능이 아니에요. 공식 실적은 1365에서 확인해 주세요.</p>
    </div>
    <ActionBar>{!rows
      ? (native ? <button className="m-btn blue" onClick={open}>1365 열기</button> : <button className="m-btn" disabled={!paste.trim()} onClick={() => read(paste)}>붙여 넣은 글자 읽기</button>)
      : rows.length || summary ? <button className="m-btn" disabled={busy || (!count && !(summary && keepSummary))} onClick={save}>{rows.length ? `${count}개 내 활동에 넣기` : '실적 가져오기'}</button>
      : <button className="m-btn line" onClick={() => setRows(null)}>다시 하기</button>}</ActionBar>
  </div>
}
