// 알림센터 (A안): filter chips, today / yesterday / date groups, one card per notification (new applications for the
// same activity within 30 minutes come as one "3건" card), mark all read, and the push settings page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { showToast } from '../App'
import { askNotifications } from './native'
import { Empty, Loading, MIcon, Sheet, TopBar, WheelColumn, Wheels } from './ui'
import type { MIconName } from './ui'

type Category = 'ALL' | 'APPLY' | 'ACTIVITY' | 'TALK'
export type CenterItem = {
  id: number; ids: number[]; count: number; type: string; category: string; title: string; body: string; link: string | null
  read: boolean; activityId: number | null; activityTitle: string | null; activityGone: boolean; createdAt: string
  /** Handled (승인 완료 · 거절함 · 답변 완료 …), set by the server once the organizer acted on it. */
  done?: string | null
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
              return <li key={item.id}><div role="button" tabIndex={0} className={'m-center-card' + (item.read ? '' : ' new') + (item.done ? ' done' : '')} onClick={() => open(item)} onKeyDown={event => { if (event.key === 'Enter') void open(item) }}>
                <span className={'m-center-ico' + (style.tone ? ' ' + style.tone : '')}><MIcon name={style.icon} size={20} /></span>
                <span className="m-center-main">
                  <span className="m-center-title"><strong>{item.title}</strong>{!item.read && <em>NEW</em>}</span>
                  {item.activityTitle && <span className="m-center-act">{item.activityGone ? '삭제된 활동' : item.activityTitle}</span>}
                  <span className="m-center-body">{stripTitle(item.body, item.activityTitle)}</span>
                  <span className="m-center-foot"><small>{group.label === '오늘' || group.label === '어제' ? item.createdAt.slice(11, 16) : item.createdAt.slice(5, 10).replace('-', '월 ') + '일 · ' + item.createdAt.slice(11, 16)}</small>
                    {item.done ? <span className="m-center-done"><MIcon name="check" size={14} />{item.done}</span>
                      : to.label && !item.activityGone && <span className="m-center-go">{to.label}<MIcon name="chevron" size={15} /></span>}</span>
                </span></div></li>
            })}</ul></section>)}
          {next && <button type="button" className="m-btn line" disabled={more} onClick={() => { setMore(true); void load(next, false) }}>{more ? '불러오는 중…' : '이전 알림 더 보기'}</button>}
        </>}
    </div>
  </div>
}

export type NoticeSettings = { push: boolean; apply: boolean; activity: boolean; talk: boolean; quiet: boolean; quietStart: string; quietEnd: string }
const defaults: NoticeSettings = { push: true, apply: true, activity: true, talk: true, quiet: true, quietStart: '22:00', quietEnd: '08:00' }
const ampm = (time: string) => { const h = Number(time.slice(0, 2)); return (h < 12 ? '오전 ' : '오후 ') + (h % 12 === 0 ? 12 : h % 12) + '시' + (time.slice(3) === '00' ? '' : ' ' + Number(time.slice(3)) + '분') }

/**
 * 마이 > 알림 설정: phone notifications on/off (and the phone's own permission), which kinds, and quiet hours
 * (방해 금지) at times the person picks. The in-app list always keeps everything.
 */
export function NoticeSettingsScreen() {
  const [settings, setSettings] = useState<NoticeSettings | null>(null)
  const [phoneOff, setPhoneOff] = useState(false)
  const [picking, setPicking] = useState<'quietStart' | 'quietEnd' | null>(null)
  useEffect(() => { api<NoticeSettings>('/api/me/notification-settings').then(setSettings).catch(() => setSettings(defaults)) }, [])
  async function save(change: Partial<NoticeSettings>) {
    if (!settings) return
    const before = settings
    setSettings({ ...settings, ...change })
    try { setSettings(await api<NoticeSettings>('/api/me/notification-settings', 'PUT', change)) }
    catch (cause) { setSettings(before); showToast('저장하지 못했어요', cause instanceof Error ? cause.message : '잠시 후 다시 시도해 주세요') }
  }
  async function togglePush() {
    if (!settings) return
    if (!settings.push) setPhoneOff(!(await askNotifications()))
    void save({ push: !settings.push })
  }
  const kinds: [keyof NoticeSettings, string, string][] = [
    ['apply', '신청·참여', '새 신청, 승인·거절, 자리 제안, 대기'],
    ['activity', '활동', '하루 전·당일 안내, 체크인, 일정 변경, 활동 기록'],
    ['talk', '공지·소통', '공지, 질문과 답변, 커뮤니티 댓글'],
  ]
  const off = settings ? !settings.push : false
  return <div className="m-screen"><TopBar title="알림 설정" back="#/my" />
    <div className="m-body">
      {!settings ? <Loading /> : <>
        <ul className="m-switches"><li><label><span><strong>휴대폰 알림 받기</strong><small>끄면 휴대폰으로 알림이 오지 않아요</small></span>
          <input type="checkbox" role="switch" checked={settings.push} onChange={togglePush} /><i aria-hidden="true" /></label></li></ul>
        <p className="m-help">휴대폰 푸시는 준비 중이에요. 지금은 앱 안 알림으로 알려 드려요.</p>
        {phoneOff && settings.push && <p className="m-err" role="alert">휴대폰에서 알림이 꺼져 있어요. 휴대폰 설정 › 애플리케이션 › Volink › 알림에서 켜 주세요.</p>}

        <h2 className="m-set-title">받을 알림</h2>
        <ul className={'m-switches' + (off ? ' off' : '')}>{kinds.map(([key, title, text]) => <li key={key}>
          <label><span><strong>{title}</strong><small>{text}</small></span>
            <input type="checkbox" role="switch" disabled={off} checked={Boolean(settings[key])} onChange={() => save({ [key]: !settings[key] })} /><i aria-hidden="true" /></label></li>)}</ul>

        <h2 className="m-set-title">방해 금지 시간</h2>
        <ul className={'m-switches' + (off ? ' off' : '')}>
          <li><label><span><strong>방해 금지</strong><small>{settings.quiet ? `${ampm(settings.quietStart)} ~ ${ampm(settings.quietEnd)}에는 알림을 보내지 않아요` : '하루 종일 알림을 받아요'}</small></span>
            <input type="checkbox" role="switch" disabled={off} checked={settings.quiet} onChange={() => save({ quiet: !settings.quiet })} /><i aria-hidden="true" /></label></li>
          {settings.quiet && <li className="m-set-times">
            <button type="button" disabled={off} onClick={() => setPicking('quietStart')}><small>시작</small><strong>{ampm(settings.quietStart)}</strong></button>
            <span aria-hidden="true">~</span>
            <button type="button" disabled={off} onClick={() => setPicking('quietEnd')}><small>끝</small><strong>{ampm(settings.quietEnd)}{settings.quietEnd <= settings.quietStart ? ' (다음 날)' : ''}</strong></button></li>}
        </ul>
      </>}
    </div>
    {picking && settings && <QuietTimeSheet title={picking === 'quietStart' ? '방해 금지 시작' : '방해 금지 끝'} value={settings[picking]} other={settings[picking === 'quietStart' ? 'quietEnd' : 'quietStart']}
      onClose={() => setPicking(null)} onPick={time => { void save({ [picking]: time }); setPicking(null) }} />}
  </div>
}

function QuietTimeSheet({ title, value, other, onPick, onClose }: { title: string; value: string; other: string; onPick: (time: string) => void; onClose: () => void }) {
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const [h, setH] = useState(Number(value.slice(0, 2)))
  const [m, setM] = useState(Number(value.slice(3)) >= 30 ? 30 : 0)
  const time = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
  return <Sheet title={title} onClose={onClose} footer={<button type="button" className="m-btn" disabled={time === other} onClick={() => onPick(time)}>{time === other ? '시작과 끝이 같아요' : ampm(time) + '로 정하기'}</button>}>
    <Wheels>
      <WheelColumn label="시" items={hours} value={h} render={x => (x < 12 ? '오전 ' : '오후 ') + (x % 12 === 0 ? 12 : x % 12) + '시'} onChange={setH} />
      <WheelColumn label="분" items={[0, 30]} value={m} render={x => String(x).padStart(2, '0') + '분'} onChange={setM} />
    </Wheels>
  </Sheet>
}
