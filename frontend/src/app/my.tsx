// 마이: profile, my numbers, saved activities, interests, notifications, the notice about records, sign out.
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { LiveActivity, MyParticipation, MyRecord, User } from '../api'
import { categories, showToast } from '../App'
import { signupRules } from '../rules'
import { ActivityRow, fieldIcon } from './cards'
import { CommunitySetup } from './community'
import { ActionBar, Empty, Loading, MIcon, Sheet, TopBar } from './ui'
import type { MIconName } from './ui'

export function MyScreen({ user, actions, onSignOut }: { user: User; actions: ReactNode; onSignOut: () => void }) {
  const [records, setRecords] = useState<MyRecord[] | null>(null)
  const [hosted, setHosted] = useState<LiveActivity[] | null>(null)
  const [joined, setJoined] = useState<MyParticipation[] | null>(null)
  const [saved, setSaved] = useState<number | null>(null)
  const [about, setAbout] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [nickname, setNickname] = useState<string | null>(null)
  useEffect(() => {
    api<{ nickname: string | null }>('/api/community/me').then(p => setNickname(p.nickname)).catch(() => {})
    api<MyRecord[]>('/api/me/records').then(setRecords).catch(() => setRecords([]))
    api<LiveActivity[]>('/api/me/activities').then(setHosted).catch(() => setHosted([]))
    api<MyParticipation[]>('/api/me/participations').then(setJoined).catch(() => setJoined([]))
    api<LiveActivity[]>('/api/me/saved').then(list => setSaved(list.length)).catch(() => setSaved(0))
  }, [])
  const valid = (records ?? []).filter(x => x.status === 'VALID')
  const hours = Math.round(valid.reduce((sum, x) => sum + x.durationMinutes, 0) / 6) / 10
  const hostedDone = (hosted ?? []).filter(a => a.status === 'FINISHED').length
  const upcoming = (joined ?? []).filter(p => ['APPLIED', 'CONFIRMED', 'WAITLISTED', 'OFFERED'].includes(p.status)).length
  const menu: { icon: MIconName; label: string; href?: string; note?: string; onClick?: () => void }[] = [
    { icon: 'record', label: '내 활동 기록', href: '#/mine?tab=done', note: valid.length ? valid.length + '개' : undefined },
    { icon: 'bookmark', label: '저장한 봉사', href: '#/my?view=saved', note: saved ? saved + '개' : undefined },
    { icon: 'heart', label: '관심 분야', href: '#/my?view=interests', note: user.interests.join(', ') || '선택 안 함' },
    { icon: 'chat', label: '커뮤니티 닉네임', href: '#/my?view=nickname', note: nickname ?? '정하지 않음' },
    { icon: 'bell', label: '알림', href: '#/notifications' },
    { icon: 'settings', label: '알림 설정', href: '#/my?view=notice-settings' },
    { icon: 'flag', label: '활동 기록·보험 안내', onClick: () => setAbout(true) },
  ]
  return <div className="m-screen">
    <TopBar title="마이페이지" actions={actions} />
    <div className="m-body">
      <section className="m-profile">
        <div className="m-profile-top"><span className="m-avatar"><MIcon name="user" size={26} /></span>
          <div><strong>{user.name}</strong><small>{user.email}</small>
            <span className="m-tags">{user.memberType === 'INSTITUTION' ? <span className="m-badge blue">기관 회원</span> : <span className="m-badge mint">일반 회원</span>}
              {user.interests.map(i => <span key={i} className="m-badge gray"><MIcon name={fieldIcon[i] ?? 'sprout'} size={13} />{i}</span>)}</span></div></div>
        <div className="m-stats">
          <div><b>{records ? valid.length : '–'}</b><span>완료 활동</span></div>
          <div><b>{records ? hours + 'h' : '–'}</b><span>함께한 시간</span></div>
          <div><b>{hosted ? hostedDone : '–'}</b><span>모집 완료</span></div>
        </div>
        {upcoming > 0 && <a className="m-profile-next" href="#/mine">참여 예정 {upcoming}개 <MIcon name="chevron" size={16} /></a>}
      </section>
      <nav className="m-menu" aria-label="마이 메뉴">{menu.map(item => item.href
        ? <a key={item.label} href={item.href}><MIcon name={item.icon} size={21} /><span>{item.label}</span>{item.note && <small>{item.note}</small>}<MIcon name="chevron" size={18} /></a>
        : <button key={item.label} type="button" onClick={item.onClick}><MIcon name={item.icon} size={21} /><span>{item.label}</span><MIcon name="chevron" size={18} /></button>)}</nav>
      <button type="button" className="m-btn line" onClick={() => setLeaving(true)}><MIcon name="logout" size={19} />로그아웃</button>
      {user.memberType !== 'INSTITUTION' && <p className="m-help center">기관 회원 가입·기관 확인은 PC에서 할 수 있어요.</p>}
    </div>
    {about && <Sheet title="활동 기록·보험 안내" onClose={() => setAbout(false)}>
      <ul className="m-bullets">
        <li>Volink 활동 기록은 우리 동네 자체 기록이에요. <b>공식 봉사실적이 아니에요.</b></li>
        <li>Volink 활동에는 <b>자원봉사 종합보험이 적용되지 않아요.</b> 공식 실적·보험은 1365 활동에만 해당돼요.</li>
        <li>QR·위치 확인은 현장 참여를 돕는 장치예요. 모든 부정 참여를 막지는 못해요.</li>
        <li>연락처는 서로 공개하지 않아요. 활동 소식(공지·질문)으로만 이야기해요.</li>
        <li>사고가 나면 먼저 119에 신고해 주세요.</li>
      </ul>
    </Sheet>}
    {leaving && <Sheet title="로그아웃할까요?" onClose={() => setLeaving(false)} footer={<div className="m-two"><button type="button" className="m-btn line" onClick={() => setLeaving(false)}>돌아가기</button><button type="button" className="m-btn" onClick={onSignOut}>로그아웃</button></div>}>
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

