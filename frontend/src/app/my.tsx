// 마이: profile, my numbers, saved activities, interests, notifications, the notice about records, sign out.
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { LiveActivity, MyRecord, User } from '../api'
import { hostedRecords } from './mine'
import { categories, showToast } from '../App'
import { signupRules } from '../rules'
import { ActivityRow, fieldIcon } from './cards'
import { CommunitySetup } from './community'
import { loginLabel, shownEmail } from './settings'
import { ActionBar, Empty, Loading, MIcon, Sheet, TopBar } from './ui'
import type { MIconName } from './ui'
import { hoursText, useConnect1365 } from './lab'
import { useRecords } from './record'
import type { LabSummary } from './lab'

/**
 * 함께한 시간 animation (2026-11-08): the numbers count up and the bar fills (1365 blue first, then Volink green) the first
 * time 마이 opens after the app starts or after more than 30 minutes away; otherwise they are just shown. When a total grew
 * since last seen (1365 갱신, a finished activity) it counts up from the old value and a "+4시간 30분" chip shows for 2 s.
 * Phones set to reduce motion get the final numbers at once.
 */
const SEEN = 'volink.my.minutes'
const AWAY = 30 * 60_000
let shownAt = 0
let hiddenAt = 0
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return }
  if (hiddenAt && Date.now() - hiddenAt > AWAY) shownAt = 0
  hiddenAt = 0
})
type Parts = { ext: number; volink: number }
function useTimeMotion(final: Parts | null) {
  const [view, setView] = useState<Parts | null>(null)
  const [gain, setGain] = useState<{ minutes: number; ext: boolean } | null>(null)
  const key = final ? final.ext + '/' + final.volink : ''
  useEffect(() => {
    if (!final) return
    let prev: Parts | null = null
    try { const raw = localStorage.getItem(SEEN); if (raw) prev = JSON.parse(raw) as Parts } catch { /* first time or private mode */ }
    try { localStorage.setItem(SEEN, JSON.stringify(final)) } catch { /* private mode */ }
    const grownExt = prev ? Math.max(0, final.ext - prev.ext) : 0
    const grownVolink = prev ? Math.max(0, final.volink - prev.volink) : 0
    const fresh = !shownAt
    shownAt = shownAt || Date.now()
    let hide = 0
    if (grownExt + grownVolink > 0) { setGain({ minutes: grownExt + grownVolink, ext: grownExt >= grownVolink }); hide = window.setTimeout(() => setGain(null), 2600) }
    const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still || (!fresh && !(grownExt + grownVolink))) { setView(final); return () => window.clearTimeout(hide) }
    const from: Parts = fresh ? { ext: 0, volink: 0 } : { ext: final.ext - grownExt, volink: final.volink - grownVolink }
    const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = (now - start) / 1000
      // 1365 over the first 0.75 s, Volink from 0.55 s to 1 s.
      setView({ ext: Math.round(from.ext + (final.ext - from.ext) * ease(t / 0.75)), volink: Math.round(from.volink + (final.volink - from.volink) * ease((t - 0.55) / 0.45)) })
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    setView(from)
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); window.clearTimeout(hide) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return { view: view ?? final, gain }
}

export function MyScreen({ user, actions }: { user: User; actions: ReactNode }) {
  const [records, setRecords] = useState<MyRecord[] | null>(null)
  const [saved, setSaved] = useState<number | null>(null)
  const [hosted, setHosted] = useState<LiveActivity[] | null>(null)
  const [about, setAbout] = useState(false)
  const [nickname, setNickname] = useState<string | null>(null)
  // A (2026-11-06): one total = Volink records + the 1365 total read from the person's own 1365 page (not checked by Volink).
  const [ext, setExt] = useState<(LabSummary & { fetchedAt: string }) | null | undefined>(undefined)
  const [connectSheet, connect] = useConnect1365()
  useEffect(() => {
    api<LabSummary & { fetchedAt?: string }>('/api/me/external/summary').then(x => setExt(x.fetchedAt ? x as LabSummary & { fetchedAt: string } : null)).catch(() => setExt(null))
    api<{ nickname: string | null }>('/api/community/me').then(p => setNickname(p.nickname)).catch(() => {})
    api<MyRecord[]>('/api/me/records').then(setRecords).catch(() => setRecords([]))
    api<LiveActivity[]>('/api/me/activities').then(setHosted).catch(() => setHosted([]))
    api<LiveActivity[]>('/api/me/saved').then(list => setSaved(list.length)).catch(() => setSaved(0))
  }, [])
  const valid = (records ?? []).filter(x => x.status === 'VALID')
  // 2026-11-08 (user decision): a personal member who ran an activity volunteered too — finished ones count as Volink time.
  const led = user.memberType === 'INSTITUTION' ? [] : hostedRecords(hosted ?? [])
  const volinkMinutes = valid.reduce((sum, x) => sum + x.durationMinutes, 0) + led.reduce((sum, a) => sum + a.durationMinutes, 0)
  // 1365 part: the imported official total; without one (직접 남기기), the hours on the certificates entered.
  const extRecords = useRecords()
  const certs = (extRecords ?? []).filter(r => r.certified)
  const extMinutes = ext ? ext.totalMinutes : certs.reduce((sum, r) => sum + (r.certMinutes ?? 0), 0)
  const extCount = ext ? ext.count : certs.length
  const extNote = ext ? ext.fetchedAt.slice(5, 10).replace('-', '/') + ' 가져옴' : certs.length ? '실적확인서 기준' : '연결 전'
  const allMinutes = volinkMinutes + extMinutes
  const ready = records !== null && hosted !== null && ext !== undefined && (ext !== null || extRecords !== null)
  const motion = useTimeMotion(ready ? { ext: extMinutes, volink: volinkMinutes } : null)
  const shownExt = motion.view?.ext ?? 0, shownVolink = motion.view?.volink ?? 0, shownAll = shownExt + shownVolink
  const connected = !!ext || certs.length > 0
  type Item = { icon: MIconName; label: string; href?: string; note?: string; onClick?: () => void }
  const mine: Item[] = [
    { icon: 'record', label: '활동 기록', href: '#/records', note: (() => { const n = valid.length + led.length + (extRecords ?? []).filter(r => r.status === 'ATTENDED').length; return n ? n + '건' : undefined })() },
    { icon: 'bookmark', label: '저장한 봉사', href: '#/my?view=saved', note: saved ? saved + '개' : undefined },
    { icon: 'heart', label: '관심 분야', href: '#/my?view=interests', note: user.interests.join(', ') || '선택 안 함' },
  ]
  const more: Item[] = [
    { icon: 'chat', label: '커뮤니티 닉네임', href: '#/my?view=nickname', note: nickname ?? '정하지 않음' },
    { icon: 'flag', label: '활동 기록·보험 안내', onClick: () => setAbout(true) },
  ]
  const list = (title: string, items: Item[]) => <section className="my-group" aria-label={title}><h2>{title}</h2><nav className="m-menu">{items.map(item => item.href
    ? <a key={item.label} href={item.href}><MIcon name={item.icon} size={21} /><span>{item.label}</span>{item.note && <small>{item.note}</small>}<MIcon name="chevron" size={18} /></a>
    : <button key={item.label} type="button" onClick={item.onClick}><MIcon name={item.icon} size={21} /><span>{item.label}</span><MIcon name="chevron" size={18} /></button>)}</nav></section>
  return <div className="m-screen">
    <TopBar title="마이페이지" actions={<>{actions}<a className="m-icon-btn" href="#/settings" aria-label="설정"><MIcon name="settings" /></a></>} />
    <div className="m-body">
      {/* 마이 A안 (2026-11-08): one card — profile, then 함께한 시간, then the 1365 line (no separate boxes). */}
      <section className="m-profile my-card">
        <div className="m-profile-top"><span className="m-avatar"><MIcon name="user" size={26} /></span>
          {/* 2026-11-06: the member type sits next to the name; the (up to 3) interests stay on one line. */}
          <div><span className="m-profile-name"><strong>{user.name}</strong>{user.memberType === 'INSTITUTION' ? <span className="m-badge blue">기관 회원</span> : <span className="m-badge mint">일반 회원</span>}</span>
            <small>{shownEmail(user.email) ?? loginLabel(user)}</small>
            {user.interests.length > 0 && <span className="m-tags one-line">{user.interests.map(i => <span key={i} className="m-badge gray"><MIcon name={fieldIcon[i] ?? 'sprout'} size={13} />{i}</span>)}</span>}</div></div>
        <hr className="my-rule" />
      <div className="my-total in" role="region" aria-label="함께한 시간">
        <small>함께한 시간</small>
        {motion.gain && <span className={'my-gain' + (motion.gain.ext ? ' ext' : '')}>+{hoursText(motion.gain.minutes)}</span>}
        <b>{ready ? <>{Math.floor(shownAll / 60)}<em>시간</em>{shownAll % 60 ? <> {shownAll % 60}<em>분</em></> : null}</> : '–'}</b>
        {ready && <span className="my-sum">1365 {hoursText(extMinutes)} + Volink {hoursText(volinkMinutes)}</span>}
        {allMinutes > 0 && <i className="my-split"><span className="ext" style={{ width: (shownExt / allMinutes * 100) + '%' }} /><span style={{ width: (shownVolink / allMinutes * 100) + '%' }} /></i>}
        <div className="my-parts">
          <a className="ext" href="#/records?kind=1365"><small>{ext || !connected ? '1365 공식 실적' : '1365 실적확인서'}</small>{connected ? <><b>{hoursText(shownExt)}</b><em>{extCount != null ? extCount + '건 · ' : ''}{extNote}</em></> : <><b>연결 전</b><em>1365 실적을 함께 모아요</em></>}</a>
          <a href="#/records?kind=volink"><small>Volink 활동</small><b>{hoursText(shownVolink)}</b><em>{valid.length + led.length}건 · 자체 기록</em></a>
        </div>
        </div>
        {user.memberType === 'INSTITUTION' ? null : ext ? <button type="button" className="my-line" onClick={connect}><span><b>1365 연결됨</b> · {ext.fetchedAt.slice(5, 10).replace('-', '/')} 가져온 1365 공식 실적</span><em>갱신하기<MIcon name="chevron" size={15} /></em></button>
          : ext === null && <button type="button" className="my-line" onClick={connect}><span><b>1365 연결하기</b> · 봉사 시간을 한곳에</span><em>연결<MIcon name="chevron" size={15} /></em></button>}
      </section>
      {list('내 봉사', mine)}
      {list('커뮤니티 · 안내', more)}
    </div>
    {connectSheet}
    {about && <Sheet title="활동 기록·보험 안내" onClose={() => setAbout(false)}>
      <ul className="m-bullets">
        <li>Volink 활동 기록은 우리 동네 자체 기록이에요. <b>공식 봉사실적이 아니에요.</b></li>
        <li>Volink 활동에는 <b>자원봉사 종합보험이 적용되지 않아요.</b> 공식 실적·보험은 1365 활동에만 해당돼요.</li>
        <li>QR·위치 확인은 현장 참여를 돕는 장치예요. 모든 부정 참여를 막지는 못해요.</li>
        <li>연락처는 서로 공개하지 않아요. 활동 소식(공지·질문)으로만 이야기해요.</li>
        <li>사고가 나면 먼저 119에 신고해 주세요.</li>
      </ul>
    </Sheet>}
  </div>
}

export function SavedScreen() {
  const [items, setItems] = useState<LiveActivity[] | null>(null)
  const load = useCallback(() => api<LiveActivity[]>('/api/me/saved').then(setItems).catch(() => setItems([])), [])
  useEffect(() => { load() }, [load])
  return <div className="m-screen"><TopBar title="저장한 봉사" back="#/my" />
    <div className="m-body">{!items ? <Loading /> : items.length ? <div className="m-list">{items.map(a => <div key={a.id} className="m-row-wrap">
      <ActivityRow activity={a} note={a.status !== 'RECRUITING' ? '모집이 끝났어요' : undefined} />
      <button type="button" className="m-icon-btn sm" aria-label={a.title + ' 저장 취소'} onClick={async () => { await api('/api/me/saved/' + a.id, 'DELETE').catch(() => {}); showToast('저장을 취소했어요'); load() }}><MIcon name="bookmarked" size={20} /></button></div>)}</div>
      : <Empty icon="bookmark" title="저장한 봉사가 없어요" text="활동 상세에서 책갈피를 누르면 여기에 모여요." action={<a className="m-btn sm" href="#/find">봉사 찾아보기</a>} />}</div>
  </div>
}

export function InterestsScreen({ user, onChange }: { user: User; onChange: (user: User) => void }) {
  const [picked, setPicked] = useState<string[]>(user.interests)
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      const updated = await api<User>('/api/me/interests', 'PUT', { interests: picked })
      onChange({ ...user, ...updated, interests: updated.interests ?? picked })
      showToast('관심 분야를 바꿨어요')
      window.location.hash = '#/my'
    } catch { showToast('저장하지 못했어요') } finally { setBusy(false) }
  }
  return <div className="m-screen"><TopBar title="관심 분야" back="#/my" />
    <div className="m-body"><p className="m-lede">추천에 써요 · 최대 {signupRules.maxInterests}개</p>
      <div className="m-tiles">{categories.map(c => { const on = picked.includes(c)
        return <button type="button" key={c} className={'m-tile' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setPicked(on ? picked.filter(x => x !== c) : picked.length < signupRules.maxInterests ? [...picked, c] : picked)}>
          <MIcon name={fieldIcon[c] ?? 'sprout'} size={24} />{c}</button> })}</div>
      <ActionBar><button className="m-btn" disabled={busy} onClick={save}>저장</button></ActionBar></div>
  </div>
}

export function NicknameScreen() {
  const [profile, setProfile] = useState<{ nickname: string | null; agreed: boolean; ready: boolean; nextChange: string | null } | null | undefined>(undefined)
  useEffect(() => { api<NonNullable<typeof profile>>('/api/community/me').then(setProfile).catch(() => setProfile(null)) }, [])
  return <div className="m-screen m-create"><TopBar title="커뮤니티 닉네임" back="#/my" />
    {profile === undefined ? <Loading /> : <CommunitySetup profile={profile} change={Boolean(profile?.ready)} onDone={() => { window.location.hash = '#/my' }} />}</div>
}

