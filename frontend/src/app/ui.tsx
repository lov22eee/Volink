// Shared pieces of the Android app screens: icons, top bar, bottom tabs, bottom sheets, wheels and the keyboard helper.
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type MIconName = 'home' | 'compass' | 'plus' | 'calendar' | 'user' | 'search' | 'bell' | 'back' | 'close' | 'pin' | 'clock' | 'users'
  | 'leaf' | 'hand' | 'heart' | 'check' | 'chevron' | 'eye' | 'eyeOff' | 'mail' | 'lock' | 'qr' | 'map' | 'list' | 'bookmark' | 'bookmarked'
  | 'settings' | 'logout' | 'edit' | 'trash' | 'bolt' | 'sun' | 'chat' | 'megaphone' | 'refresh' | 'flag' | 'timer' | 'record' | 'sprout' | 'outward' | 'more' | 'send'

const paths: Record<MIconName, ReactNode> = {
  home: <><path d="m3 11 9-7 9 7" /><path d="M5 10v10h14V10M10 20v-5h4v5" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m16 8-3 5-5 3 3-5 5-3Z" /></>,
  plus: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 10h16M9 3v4M15 3v4M9 15l2 2 4-4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4Z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  back: <path d="M15 5 8 12l7 7" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.2" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5" /></>,
  leaf: <><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14Z" /><path d="m5 19 7-7" /></>,
  hand: <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-1V5a1.5 1.5 0 0 1 3 0v6m0-1V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5A5.5 5.5 0 0 1 6 17l-2-3.5a1.4 1.4 0 0 1 2.3-1.6L8 14" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 7 8.5 6 8.5-6" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" /></>,
  qr: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2M18 16v2" /></>,
  map: <><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2Z" /><path d="M9 4v14m6-12v14" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.5M3.5 12h.5M3.5 18h.5" />,
  bookmark: <path d="M6 4h12v17l-6-4-6 4Z" />,
  bookmarked: <path d="M6 4h12v17l-6-4-6 4Z" fill="currentColor" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>,
  logout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" />,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16Z" /><path d="m13.5 6.5 4 4" /></>,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  bolt: <path d="M13 3 5 13h6l-1 8 8-10h-6Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  chat: <path d="M4 5h16v11H9l-5 4Z" />,
  megaphone: <><path d="M3 11v2a1 1 0 0 0 1 1h3l8 5V5L7 10H4a1 1 0 0 0-1 1Z" /><path d="M18 9a4 4 0 0 1 0 6" /></>,
  refresh: <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5" />,
  flag: <path d="M5 21V4h11l-2 4 2 4H5" />,
  timer: <><circle cx="12" cy="13" r="7.5" /><path d="M12 13V9.5M10 3h4" /></>,
  record: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  sprout: <><path d="M12 21v-9" /><path d="M12 12c0-4-3-6-7-6 0 4 3 6 7 6ZM12 10c0-4 3-6 7-6 0 4-3 6-7 6Z" /></>,
  outward: <path d="M7 17 17 7M9 7h8v8" />,
  send: <path d="M4 12 20 4l-6 16-3-7Z" />,
  more: <><circle cx="6" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="18" cy="12" r="1.3" /></>,
}

export function MIcon({ name, size = 22 }: { name: MIconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export const go = (hash: string) => { window.location.hash = hash }

/** Screen title row: back button (sub screens) or the brand, then at most two icons. */
export function TopBar({ title, back, brand, actions }: { title?: string; back?: string | (() => void); brand?: boolean; actions?: ReactNode }) {
  const onBack = () => typeof back === 'function' ? back() : back === 'history' ? window.history.back() : go(back ?? '#/home')
  return <header className="m-top">
    {back && <button type="button" className="m-icon-btn" aria-label="뒤로" onClick={onBack}><MIcon name="back" /></button>}
    {brand ? <span className="m-brand">volink<i>.</i></span> : <h1 className="m-title">{title}</h1>}
    <span className="m-top-actions">{actions}</span>
  </header>
}

export function BellLink({ unread }: { unread: number }) {
  return <a href="#/notifications" className="m-icon-btn" aria-label={'알림' + (unread ? ' ' + unread + '개 안 읽음' : '')}>
    <MIcon name="bell" />{unread > 0 && <span className="m-dot">{unread > 9 ? '9+' : unread}</span>}</a>
}

export type Tab = 'home' | 'find' | 'community' | 'mine' | 'my'
const tabs: { id: Tab; label: string; icon: MIconName }[] = [
  { id: 'home', label: '홈', icon: 'home' }, { id: 'find', label: '찾기', icon: 'compass' }, { id: 'community', label: '커뮤니티', icon: 'chat' },
  { id: 'mine', label: '내 활동', icon: 'calendar' }, { id: 'my', label: '마이', icon: 'user' },
]

export function TabBar({ active }: { active: Tab | null }) {
  return <nav className="m-tabs" aria-label="주요 메뉴">{tabs.map(tab =>
    <a key={tab.id} href={'#/' + tab.id} className={'m-tab' + (active === tab.id ? ' on' : '')} aria-current={active === tab.id ? 'page' : undefined}>
      <span className="m-tab-ico"><MIcon name={tab.icon} size={23} /></span>{tab.label}</a>)}</nav>
}

/** Round "+ 모집하기" button above the tab bar (모집 is no longer a tab, 2026-11-05). */
export function RecruitFab() {
  return <a className="m-fab" href="#/host"><MIcon name="plus" size={20} />모집하기</a>
}

/** The one main action of a screen, fixed above the bottom edge (and above the keyboard). */
export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="m-action">{children}</div>
}

/** A panel that slides up from the bottom. Closes on the dim area, the close button or Escape. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    document.documentElement.classList.add('m-locked')
    return () => { window.removeEventListener('keydown', key); document.documentElement.classList.remove('m-locked') }
  }, [onClose])
  return createPortal(<div className="m-sheet-wrap">
    <div className="m-dim" onClick={onClose} />
    <section className="m-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <span className="m-grab" aria-hidden="true" />
      <div className="m-sheet-head"><h2>{title}</h2><button type="button" className="m-icon-btn" aria-label="닫기" onClick={onClose}><MIcon name="close" /></button></div>
      <div className="m-sheet-body">{children}</div>
      {footer && <div className="m-sheet-foot">{footer}</div>}
    </section>
  </div>, document.body)
}

/** One scrolling column of a wheel picker. The middle row is the chosen one; tapping a row also chooses it. */
export function WheelColumn<T extends string | number>({ items, value, label, render, onChange }: { items: T[]; value: T; label: string; render?: (item: T) => string; onChange: (item: T) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const row = 44
  const settle = useRef<number | undefined>(undefined)
  useEffect(() => {
    const index = items.indexOf(value)
    if (box.current && index >= 0 && Math.abs(box.current.scrollTop - index * row) > 2) box.current.scrollTop = index * row
  }, [items, value])
  return <div className="m-wheel-col" ref={box} role="listbox" aria-label={label} tabIndex={0}
    onScroll={() => {
      window.clearTimeout(settle.current)
      settle.current = window.setTimeout(() => {
        const index = Math.max(0, Math.min(items.length - 1, Math.round((box.current?.scrollTop ?? 0) / row)))
        if (items[index] !== value) onChange(items[index])
      }, 90)
    }}
    onKeyDown={event => {
      const index = items.indexOf(value)
      if (event.key === 'ArrowDown' && index < items.length - 1) { event.preventDefault(); onChange(items[index + 1]) }
      if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); onChange(items[index - 1]) }
    }}>
    <div className="m-wheel-pad" />
    {items.map(item => <button type="button" key={String(item)} role="option" aria-selected={item === value} className={item === value ? 'on' : ''}
      onClick={() => onChange(item)}>{render ? render(item) : String(item)}</button>)}
    <div className="m-wheel-pad" />
  </div>
}

export function Wheels({ children }: { children: ReactNode }) {
  return <div className="m-wheels"><span className="m-wheel-band" aria-hidden="true" />{children}</div>
}

/** A field that looks like an input and opens a sheet (date, time, choices). */
export function PickField({ label, value, placeholder, hint, error, icon, onOpen, name }: { label: string; value: string; placeholder?: string; hint?: string; error?: string; icon?: MIconName; onOpen: () => void; name?: string }) {
  return <div className="m-field">
    <span className="m-label">{label}</span>
    <button type="button" name={name} className={'m-input m-pick' + (error ? ' bad' : '')} aria-label={label + ' ' + (value || placeholder || '')} onClick={onOpen}>
      {icon && <MIcon name={icon} size={19} />}<span className={value ? '' : 'ph'}>{value || placeholder}</span>{hint && <small>{hint}</small>}<MIcon name="chevron" size={17} /></button>
    {error && <span className="m-err" role="alert">{error}</span>}
  </div>
}

export function Empty({ icon, title, text, action }: { icon: MIconName; title: string; text?: string; action?: ReactNode }) {
  return <div className="m-empty"><span className="m-empty-ico"><MIcon name={icon} size={26} /></span><strong>{title}</strong>{text && <p>{text}</p>}{action}</div>
}

export function Loading() {
  return <div className="m-loading" role="status"><span className="m-spin" />불러오는 중</div>
}

/**
 * Phone keyboard: when it opens, the visible area shrinks. This keeps the field being typed in visible:
 * - sets --kb (keyboard height) so fixed bars sit on top of the keyboard, and hides the tab bar meanwhile;
 * - after focus (and again when the keyboard finishes opening) scrolls the field to the middle of what is left.
 */
export function useKeyboardAware() {
  useEffect(() => {
    const viewport = window.visualViewport
    const root = document.documentElement
    let focused: HTMLElement | null = null
    const reveal = () => {
      if (!focused || !document.contains(focused)) return
      const box = focused.closest('.m-field, .m-reveal') as HTMLElement | null ?? focused
      const rect = box.getBoundingClientRect()
      const visibleTop = 64, visibleBottom = (viewport?.height ?? window.innerHeight) - (root.classList.contains('m-kb') ? 84 : 120)
      if (rect.top < visibleTop || rect.bottom > visibleBottom) {
        const sheet = focused.closest('.m-sheet-body') as HTMLElement | null
        const target = rect.top - visibleTop - Math.max(0, (visibleBottom - visibleTop - rect.height) / 3)
        if (sheet) sheet.scrollBy({ top: target, behavior: 'smooth' })
        else window.scrollBy({ top: target, behavior: 'smooth' })
      }
    }
    // Android (Capacitor, adjustResize) shrinks the whole page, so fixed bars already sit on the keyboard: only the
    // class changes. A browser that overlays the keyboard keeps the page height, so --kb lifts the bars by hand.
    let full = window.innerHeight
    const resize = () => {
      const visible = viewport?.height ?? window.innerHeight
      if (!focused) full = Math.max(window.innerHeight, visible)
      const overlay = Math.max(0, window.innerHeight - visible - (viewport?.offsetTop ?? 0))
      root.style.setProperty('--kb', overlay + 'px')
      root.classList.toggle('m-kb', full - visible > 120)
      window.setTimeout(reveal, 60)
    }
    const typing = (element: EventTarget | null) => element instanceof HTMLElement && (element.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=button])') || element.isContentEditable)
    const onFocus = (event: FocusEvent) => {
      if (!typing(event.target)) return
      focused = event.target as HTMLElement
      root.classList.add('m-typing')
      window.setTimeout(reveal, 320)
    }
    const onBlur = () => window.setTimeout(() => { if (!typing(document.activeElement)) { focused = null; root.classList.remove('m-typing') } }, 50)
    viewport?.addEventListener('resize', resize)
    window.addEventListener('resize', resize)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)
    return () => { viewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize); document.removeEventListener('focusin', onFocus); document.removeEventListener('focusout', onBlur) }
  }, [])
}

/** Countdown-free relative day: 오늘 / 내일 / 모레 / 11월 7일 (토). */
export function dayWord(date: string) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  const diff = Math.round((new Date(date + 'T12:00:00Z').getTime() - new Date(today + 'T12:00:00Z').getTime()) / 86_400_000)
  if (diff === 0) return '오늘'
  if (diff === 1) return '내일'
  if (diff === 2) return '모레'
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(date + 'T12:00:00+09:00'))
}

export function dDay(date: string) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  const diff = Math.round((new Date(date + 'T12:00:00Z').getTime() - new Date(today + 'T12:00:00Z').getTime()) / 86_400_000)
  return diff === 0 ? 'D-DAY' : diff > 0 ? 'D-' + diff : null
}

export function useToggle(initial = false): [boolean, () => void, (value: boolean) => void] {
  const [value, setValue] = useState(initial)
  return [value, () => setValue(v => !v), setValue]
}
