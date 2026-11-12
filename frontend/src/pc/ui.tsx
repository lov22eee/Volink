// PC 화면 shared pieces (2026-11-11): header, icons, the app download QR, date words.
import { useEffect, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import QRCode from 'qrcode'
import type { User } from '../api'

const paths = {
  leaf: <><path d="M19 3c-11 0-16 7-12 12s13 1 12-12Z" /><path d="m4 21 10-12" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  building: <path d="M5 21V3h14v18M3 21h18M10 21v-4h4v4M9 7h1m4 0h1M9 11h1m4 0h1" />,
  download: <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  link: <path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" />,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4Z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  qr: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" /></>,
  record: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  chat: <path d="M5 5h14v10H9l-4 4z" />,
  pin: <><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></>,
}
export type PcIconName = keyof typeof paths
export function PcIcon({ name, size = 16 }: { name: PcIconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>{paths[name]}</svg>
}

export function Logo({ sub, href = '#/' }: { sub?: string; href?: string }) {
  return <a className="pc-logo" href={href} aria-label={sub ? 'Volink ' + sub : 'Volink 홈'}><i><PcIcon name="leaf" size={14} /></i>volink{sub && <em>{sub}</em>}</a>
}

/** Where the Android app file is served (nginx: /download/volink.apk). */
export const appUrl = () => window.location.origin + '/download/volink.apk'

export function AppQr({ size = 112 }: { size?: number }) {
  const [src, setSrc] = useState('')
  useEffect(() => { QRCode.toDataURL(appUrl(), { margin: 1, width: size * 2, color: { dark: '#1f2421', light: '#ffffff' } }).then(setSrc).catch(() => setSrc('')) }, [size])
  return src ? <img src={src} alt="앱 받기 QR 코드" width={size} height={size} /> : <span style={{ width: size, height: size, display: 'inline-block' }} />
}

export function PublicHeader({ user, current, onSignOut }: { user: User | null; current?: 'find' | 'org'; onSignOut: () => void }) {
  const about = (event: MouseEvent) => {
    const el = document.getElementById('pc-about')
    if (el) { event.preventDefault(); el.scrollIntoView({ behavior: 'smooth' }) }
  }
  return <header className="pc-hd">
    <Logo />
    <nav className="pc-nav" aria-label="주요 메뉴"><a href="#/" aria-current={current === 'find' ? 'page' : undefined}>봉사 찾기</a><a href="#/" onClick={about}>앱 소개</a>
      <a href="#/org" aria-current={current === 'org' ? 'page' : undefined}>기관센터</a></nav>
    <div className="pc-sp" />
    {user ? <div className="pc-who"><a href={user.role === 'ADMIN' ? '#/admin' : user.memberType === 'INSTITUTION' ? '#/org' : '#/app'}>{user.role === 'ADMIN' ? '관리자' : user.memberType === 'INSTITUTION' ? (user.organization?.name ?? '기관센터') : user.name}</a><button type="button" onClick={onSignOut}>로그아웃</button></div>
      : <><a className="mu" href="#/login" style={{ fontWeight: 600 }}>로그인</a><a className="pc-btn" href={appUrl()}><PcIcon name="download" />앱 받기</a></>}
  </header>
}

export function PublicFooter() {
  return <footer className="pc-foot"><b>volink</b><span>Volink 활동은 공식 봉사실적이 아니며 자원봉사 종합보험이 적용되지 않습니다.</span><span>연락처는 다른 회원에게 공개하지 않습니다.</span></footer>
}

const weekdays = ['일', '월', '화', '수', '목', '금', '토']
/** "11월 15일 (토) 10:00" from yyyy-MM-dd and HH:mm (Korean dates). */
export function when(date: string, time?: string) {
  const d = new Date(date + 'T12:00:00+09:00')
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${weekdays[d.getUTCDay()]})${time ? ' ' + time : ''}`
}
export const minutesWord = (m: number) => m % 60 ? (m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`) : `${m / 60}시간`
/** "3시간 전" / "2일 전" from "yyyy-MM-dd HH:mm" or "yyyy-MM-ddTHH:mm" (Korean time). */
export function ago(value: string) {
  const then = new Date(value.replace(' ', 'T').slice(0, 16) + ':00+09:00').getTime()
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000))
  return m < 60 ? `${Math.max(1, m)}분 전` : m < 1440 ? `${Math.floor(m / 60)}시간 전` : `${Math.floor(m / 1440)}일 전`
}
export const hoursSince = (value: string) => (Date.now() - new Date(value.replace(' ', 'T').slice(0, 16) + ':00+09:00').getTime()) / 3_600_000

export function Loading({ text = '불러오는 중입니다.' }: { text?: string }) {
  return <p className="pc-empty" role="status">{text}</p>
}

export function Panel({ title, note, right, children, className }: { title?: ReactNode; note?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={'pc-pn' + (className ? ' ' + className : '')} aria-label={typeof title === 'string' ? title : undefined}>
    {title && <div className="pc-ph"><h2>{title}</h2>{note && <small>{note}</small>}{right && <div className="r">{right}</div>}</div>}
    {children}
  </section>
}
