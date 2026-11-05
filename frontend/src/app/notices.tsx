// 알림센터 (A안): filter chips, today / yesterday / date groups, one card per notification (new applications for the
// same activity within 30 minutes come as one "3건" card), mark all read, and the push settings page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { showToast } from '../App'
import { Empty, Loading, MIcon, TopBar } from './ui'
import type { MIconName } from './ui'

type Category = 'ALL' | 'APPLY' | 'ACTIVITY' | 'TALK'
export type CenterItem = {
  id: number; ids: number[]; count: number; type: string; category: string; title: string; body: string; link: string | null
  read: boolean; activityId: number | null; activityTitle: string | null; activityGone: boolean; createdAt: string
}
type CenterPage = { items: CenterItem[]; next: number | null; unread: Record<string, number> }

const chips: [Category, string][] = [['ALL', '전체'], ['APPLY', '신청·참여'], ['ACTIVITY', '활동'], ['TALK', '공지·소통']]

/** Icon and colour by type (the app's own line icons). */
const look: Record<string, { icon: MIconName; tone?: 'hot' | 'warn' | 'blue' | 'gray' }> = {
  APPLIED: { icon: 'userPlus' }, APPROVED: { icon: 'checkCircle' }, OFFER_ACCEPTED: { icon: 'checkCircle' }, REJECTED: { icon: 'userX', tone: 'gray' },
  CANCELLED: { icon: 'userX', tone: 'warn' }, WAITLISTED: { icon: 'clock', tone: 'blue' }, OFFERED: { icon: 'bolt', tone: 'hot' },
  OFFER_EXPIRED: { icon: 'timer', tone: 'gray' }, WAITLIST_CLOSED: { icon: 'timer', tone: 'gray' }, START_EXPIRED: { icon: 'alert', tone: 'gray' },
  PENDING_REMINDER: { icon: 'clock', tone: 'warn' }, LATE: { icon: 'clock', tone: 'warn' },
  RESCHEDULED: { icon: 'calendar', tone: 'warn' }, ACTIVITY_CANCELLED: { icon: 'alert', tone: 'hot' }, DAY_BEFORE: { icon: 'calendar' }, DAY_OF: { icon: 'sun' },
  CHECKIN_OPEN: { icon: 'qr' }, QR_TIME: { icon: 'qr' }, CHECKED_IN: { icon: 'qr' }, FINISHED: { icon: 'calendar', tone: 'gray' },
  RECORD_CONFIRMED: { icon: 'record' }, REVIEW_INVITE: { icon: 'edit' },
  NOTICE: { icon: 'megaphone', tone: 'warn' }, QUESTION: { icon: 'chat', tone: 'blue' }, ANSWER: { icon: 'chat', tone: 'blue' }, COMMUNITY_COMMENT: { icon: 'chat' },
}

/** Where a card goes, by type (never a stored outside address): the existing app routes only. */
function destination(item: CenterItem): { href: string; label?: string } {
  const a = item.activityId
  if (item.type === 'COMMUNITY_COMMENT' && item.link?.startsWith('#/post/')) return { href: item.link, label: '댓글 보기' }
  if (item.type === 'RECORD_CONFIRMED') return { href: '#/mine?tab=done', label: '내 기록' }
  if (!a) return { href: item.link?.replace('#/explore', '#/find') ?? '#/home' }
  switch (item.type) {
    case 'APPLIED': case 'CANCELLED': case 'OFFER_ACCEPTED': case 'PENDING_REMINDER': case 'LATE': return { href: '#/manage/' + a, label: '신청 관리' }
    case 'QR_TIME': case 'FINISHED': return { href: '#/manage/' + a + '?tab=attendance', label: '출석 관리' }
    case 'NOTICE': case 'QUESTION': case 'ANSWER': return { href: '#/news/' + a, label: item.type === 'QUESTION' ? '답변하기' : '소식 보기' }
    case 'REVIEW_INVITE': return { href: '#/write?category=REVIEW&activity=' + a, label: '후기 쓰기' }
    case 'OFFERED': return { href: '#/activity/' + a, label: '자리 확인' }
    case 'START_EXPIRED': case 'WAITLIST_CLOSED': return { href: '#/find', label: '다른 활동 찾기' }
    default: return { href: '#/activity/' + a, label: ['APPROVED', 'DAY_BEFORE', 'DAY_OF', 'CHECKIN_OPEN', 'RESCHEDULED'].includes(item.type) ? '활동 확인' : undefined }
  }
}

/** "오늘" / "어제" / "11월 2일" in Korean time (the server sends Korean time). */
function dayLabel(createdAt: string) {
  const [date] = createdAt.split(' ')
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() + 9 * 3600_000 - 86_400_000).toISOString().slice(0, 10)
  if (date === today) return '오늘'
  if (date === yesterday) return '어제'
  const [, m, d] = date.split('-').map(Number)
  return `${m}월 ${d}일`
}

/** The activity name sits on its own line, so it is taken off the front of the text when the server put it there. */
const stripTitle = (body: string, title: string | null) => title && body.startsWith(title + ' · ') ? body.slice(title.length + 3) : body

export function NoticesScreen({ onChange }: { onChange: () => void }) {
  const [category, setCategory] = useState<Category>('ALL')
  const [items, setItems] = useState<CenterItem[] | null>(null)
  const [next, setNext] = useState<number | null>(null)
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [more, setMore] = useState(false)
  const loadId = useRef(0)

  const load = useCallback(async (from: number | null, reset: boolean) => {
    const id = ++loadId.current
    const params = new URLSearchParams({ size: '20' })
    if (category !== 'ALL') params.set('category', category)
    if (from) params.set('before', String(from))
    try {
      const page = await api<CenterPage>('/api/me/notification-center?' + params)
      if (id !== loadId.current) return
      setItems(current => reset || !current ? page.items : [...current, ...page.items])
      setNext(page.next)
      setUnread(page.unread)
    } catch {
      if (id === loadId.current && reset) setItems([])
    } finally { if (id === loadId.current) setMore(false) }
  }, [category])
  // Fresh on entry, on a chip change, and when the app comes back to the front.
  useEffect(() => { setItems(null); void load(null, true) }, [load])
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') void load(null, true) }
    document.addEventListener('visibilitychange', again)
    return () => document.removeEventListener('visibilitychange', again)
  }, [load])

  async function open(item: CenterItem) {
    const to = destination(item)
    if (!item.read) {
      // Shown as read at once; if the server did not take it, the next refresh shows the truth again.
      setItems(current => current?.map(x => x.id === item.id ? { ...x, read: true } : x) ?? current)
      await api('/api/notifications/read', 'POST', { ids: item.ids }).catch(() => {})
      onChange()
    }
    if (item.activityGone && !to.href.startsWith('#/mine') && !to.href.startsWith('#/post')) {
      showToast('삭제되었거나 볼 수 없는 활동이에요', '다른 활동을 찾아보세요')
      return
    }
    window.location.hash = to.href
  }
  async function readAll() {
    await api('/api/notifications/read-all', 'POST').catch(() => {})
    onChange()
    void load(null, true)
  }

  const groups = useMemo(() => {
    const out: { label: string; items: CenterItem[] }[] = []
    for (const item of items ?? []) {
      const label = dayLabel(item.createdAt)
      if (out.at(-1)?.label === label) out.at(-1)!.items.push(item)
      else out.push({ label, items: [item] })
    }
    return out
  }, [items])
  const total = unread.ALL ?? 0

  return <div className="m-screen m-center">
    <TopBar title="알림" back="history" actions={<button type="button" className="m-text-btn" disabled={total === 0} onClick={readAll}>모두 읽음</button>} />
    <div className="m-body">
      <div className="m-chips" role="tablist" aria-label="알림 종류">{chips.map(([value, label]) => {
        const count = value === 'ALL' ? total : unread[value] ?? 0
        return <button key={value} type="button" role="tab" aria-selected={category === value} className={'m-chip' + (category === value ? ' on' : '')} onClick={() => setCategory(value)}>
          {label}{count > 0 && <b>{count}</b>}</button>
      })}</div>
      {!items ? <Loading />
        : items.length === 0 ? <Empty icon="bell" title={category === 'ALL' ? '아직 알림이 없어요' : '이 종류의 알림이 없어요'} text="신청 결과, 자리 제안, 공지와 답변을 여기서 알려 드려요." />
        : <>{groups.map((group, index) => <section key={group.label + index} className="m-center-day" aria-label={group.label}>
            <header><h2>{group.label}</h2>{index === 0 && total > 0 && <small>읽지 않음 {total}건</small>}</header>
            <ul className="m-center-list">{group.items.map(item => {
              const style = look[item.type] ?? { icon: 'bell' as MIconName }
              const to = destination(item)
              return <li key={item.id}><div role="button" tabIndex={0} className={'m-center-card' + (item.read ? '' : ' new')} onClick={() => open(item)} onKeyDown={event => { if (event.key === 'Enter') void open(item) }}>
                <span className={'m-center-ico' + (style.tone ? ' ' + style.tone : '')}><MIcon name={style.icon} size={20} /></span>
                <span className="m-center-main">
                  <span className="m-center-title"><strong>{item.title}</strong>{!item.read && <em>NEW</em>}</span>
                  {item.activityTitle && <span className="m-center-act">{item.activityGone ? '삭제된 활동' : item.activityTitle}</span>}
                  <span className="m-center-body">{stripTitle(item.body, item.activityTitle)}</span>
                  <span className="m-center-foot"><small>{group.label === '오늘' || group.label === '어제' ? item.createdAt.slice(11, 16) : item.createdAt.slice(5, 10).replace('-', '월 ') + '일 · ' + item.createdAt.slice(11, 16)}</small>
                    {to.label && !item.activityGone && <span className="m-center-go">{to.label}<MIcon name="chevron" size={15} /></span>}</span>
                </span></div></li>
            })}</ul></section>)}
          {next && <button type="button" className="m-btn line" disabled={more} onClick={() => { setMore(true); void load(next, false) }}>{more ? '불러오는 중…' : '이전 알림 더 보기'}</button>}
        </>}
    </div>
  </div>
}

type Settings = { apply: boolean; activity: boolean; talk: boolean; quiet: boolean }

/** 마이 > 알림 설정: which kinds reach the phone as a push, and quiet hours. The in-app list always keeps all. */
export function NoticeSettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => { api<Settings>('/api/me/notification-settings').then(setSettings).catch(() => setSettings({ apply: true, activity: true, talk: true, quiet: true })) }, [])
  async function toggle(key: keyof Settings) {
    if (!settings) return
    const next = { ...settings, [key]: !settings[key] }
    setSettings(next)
    try { setSettings(await api<Settings>('/api/me/notification-settings', 'PUT', { [key]: next[key] })) }
    catch { setSettings(settings); showToast('저장하지 못했어요', '잠시 후 다시 시도해 주세요') }
  }
  const rows: [keyof Settings, string, string][] = [
    ['apply', '신청·참여', '새 신청, 승인·거절, 자리 제안, 대기'],
    ['activity', '활동', '하루 전·당일 안내, 체크인, 일정 변경, 활동 기록'],
    ['talk', '공지·소통', '공지, 질문과 답변, 커뮤니티 댓글'],
    ['quiet', '조용한 시간', '밤 10시~아침 8시에는 소리 없이 보내요'],
  ]
  return <div className="m-screen"><TopBar title="알림 설정" back="#/my" />
    <div className="m-body">
      <p className="m-help">휴대폰 알림(푸시)에 적용돼요. 앱 안 알림 목록에는 모두 그대로 남아요.</p>
      <div className="m-note">휴대폰 푸시는 준비 중이에요. 지금은 앱 안 알림으로 알려 드려요.</div>
      {!settings ? <Loading /> : <ul className="m-switches">{rows.map(([key, title, text]) => <li key={key}>
        <label><span><strong>{title}</strong><small>{text}</small></span>
          <input type="checkbox" role="switch" checked={settings[key]} onChange={() => toggle(key)} /><i aria-hidden="true" /></label></li>)}</ul>}
    </div></div>
}
