// 마이: profile, my numbers, saved activities, interests, notifications, the notice about records, sign out.
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { LiveActivity, MyParticipation, MyRecord, User } from '../api'
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

export function MyScreen({ user, actions }: { user: User; actions: ReactNode }) {
  const [records, setRecords] = useState<MyRecord[] | null>(null)
  const [hosted, setHosted] = useState<LiveActivity[] | null>(null)
  const [joined, setJoined] = useState<MyParticipation[] | null>(null)
  const [saved, setSaved] = useState<number | null>(null)
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
    api<MyParticipation[]>('/api/me/participations').then(setJoined).catch(() => setJoined([]))
    api<LiveActivity[]>('/api/me/saved').then(list => setSaved(list.length)).catch(() => setSaved(0))
  }, [])
  const valid = (records ?? []).filter(x => x.status === 'VALID')
  const volinkMinutes = valid.reduce((sum, x) => sum + x.durationMinutes, 0)
  // 1365 part: the imported official total; without one (직접 남기기), the hours on the certificates entered.
  const extRecords = useRecords()
  const certs = (extRecords ?? []).filter(r => r.certified)
  const extMinutes = ext ? ext.totalMinutes : certs.reduce((sum, r) => sum + (r.certMinutes ?? 0), 0)
  const extCount = ext ? ext.count : certs.length
  const extNote = ext ? ext.fetchedAt.slice(5, 10).replace('-', '/') + ' 가져옴' : certs.length ? '실적확인서 기준' : '연결 전'
  const allMinutes = volinkMinutes + extMinutes
  const hostedDone = (hosted ?? []).filter(a => a.status === 'FINISHED').length
  const upcoming = (joined ?? []).filter(p => ['APPLIED', 'CONFIRMED', 'WAITLISTED', 'OFFERED'].includes(p.status)).length
  type Item = { icon: MIconName; label: string; href?: string; note?: string; onClick?: () => void }
  const mine: Item[] = [
    { icon: 'record', label: '활동 기록', href: '#/mine?tab=done', note: valid.length || ext ? (valid.length + (ext?.count ?? 0)) + '건' : undefined },
    { icon: 'calendar', label: '참여 예정', href: '#/mine', note: upcoming ? upcoming + '개' : undefined },
    { icon: 'users', label: '내 모집', href: '#/mine?tab=host', note: hostedDone ? '완료 ' + hostedDone + '개' : undefined },
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
      <section className="m-profile">
        <div className="m-profile-top"><span className="m-avatar"><MIcon name="user" size={26} /></span>
          <div><strong>{user.name}</strong><small>{shownEmail(user.email) ?? loginLabel(user)}</small>
            <span className="m-tags">{user.memberType === 'INSTITUTION' ? <span className="m-badge blue">기관 회원</span> : <span className="m-badge mint">일반 회원</span>}
              {user.interests.map(i => <span key={i} className="m-badge gray"><MIcon name={fieldIcon[i] ?? 'sprout'} size={13} />{i}</span>)}</span></div></div>
      </section>
      <section className="my-total" aria-label="함께한 시간">
        <small>함께한 시간</small>
        <b>{records && ext !== undefined ? <>{Math.floor(allMinutes / 60)}<em>시간</em>{allMinutes % 60 ? <> {allMinutes % 60}<em>분</em></> : null}</> : '–'}</b>
        {records && ext !== undefined && <span className="my-sum">1365 {hoursText(extMinutes)} + Volink {hoursText(volinkMinutes)}</span>}
        {allMinutes > 0 && <i className="my-split"><span className="ext" style={{ width: (extMinutes / allMinutes * 100) + '%' }} /><span style={{ width: (volinkMinutes / allMinutes * 100) + '%' }} /></i>}
        <div className="my-parts">
          <div className="ext"><small>{ext ? '1365 공식 실적' : '1365 실적확인서'}</small><b>{hoursText(extMinutes)}</b><em>{extCount != null ? extCount + '건 · ' : ''}{extNote}</em></div>
          <div><small>Volink 활동</small><b>{hoursText(volinkMinutes)}</b><em>{valid.length}건 · 자체 기록</em></div>
        </div>
      </section>
      {user.memberType === 'INSTITUTION' ? null : ext ? <button type="button" className="my-conn" onClick={connect}><MIcon name="refresh" size={18} /><span><b>1365 연결됨</b> · {ext.fetchedAt.slice(5, 10).replace('-', '/')} 가져온 1365 공식 실적</span><em>새로고침</em></button>
        : ext === null && <button type="button" className="my-conn" onClick={connect}><MIcon name="outward" size={18} /><span><b>1365 봉사실적 연결하기</b> · 1365에서 한 봉사도 함께 모아요</span><em>연결</em></button>}
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

