// Line icons drawn for Volink (same 24px grid and 1.7 stroke as the menu icons). No emoji.
import type { ReactNode } from 'react'

export type GlyphName = 'pin' | 'calendar' | 'clock' | 'timer' | 'users' | 'leaf' | 'hand' | 'search' | 'map' | 'check' | 'bolt'
  | 'sun' | 'arrow' | 'close' | 'target' | 'refresh' | 'external' | 'building' | 'alert' | 'chevron'
  | 'glove' | 'tongs' | 'bag' | 'water' | 'hat' | 'shoe' | 'plus' | 'link' | 'info' | 'filter'

const paths: Record<GlyphName, ReactNode> = {
  pin: <><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11Z" /><circle cx="12" cy="10" r="2.2" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></>,
  timer: <><circle cx="12" cy="13" r="7" /><path d="M12 13V9.5M10 3h4M18 6l1.5-1.5" /></>,
  users: <><circle cx="9" cy="9" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.5M17.5 14.5a5 5 0 0 1 3 4.5" /></>,
  leaf: <><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14Z" /><path d="m5 19 7-7" /></>,
  hand: <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-1V5a1.5 1.5 0 0 1 3 0v6m0-1V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5A5.5 5.5 0 0 1 6 17l-2-3.5a1.4 1.4 0 0 1 2.3-1.6L8 14" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
  map: <><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2Z" /><path d="M9 4v14m6-12v14" /></>,
  check: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.4 2.4 4.6-5" /></>,
  bolt: <path d="M13 3 5 13h6l-1 8 8-10h-6Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  target: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></>,
  refresh: <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5" />,
  external: <path d="M14 4h6v6m0-6-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />,
  building: <path d="M5 21V3h14v18M3 21h18M10 21v-4h4v4M9 7h1m4 0h1M9 11h1m4 0h1" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  glove: <path d="M8 21v-6l-3-4a1.5 1.5 0 0 1 2.4-1.8L9 11V5a1.5 1.5 0 0 1 3 0v5m0-1V4a1.5 1.5 0 0 1 3 0v6m0-1V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-3 6v1" />,
  tongs: <path d="m7 3 5 12m5-12-5 12m0 0v6" />,
  bag: <><path d="M6 7h12l-1 13H7Z" /><path d="M9 7V4h6v3M4 7h16" /></>,
  water: <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z" />,
  hat: <path d="M4 16h16M6 16c0-5 2.5-8 6-8s6 3 6 8" />,
  shoe: <path d="M3 17h18v-2l-6-2-3-4H7v6H3Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5m0-8v.5" /></>,
  alert: <><path d="M12 4 3 20h18Z" /><path d="M12 10v4m0 3v.5" /></>,
}

export function Glyph({ name, size = 18 }: { name: GlyphName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

/** Icon for a supply name; anything typed by hand gets the check mark. */
export function supplyGlyph(name: string): GlyphName {
  return ({ 장갑: 'glove', 집게: 'tongs', 봉투: 'bag', 물: 'water', 모자: 'hat', '편한 신발': 'shoe' } as Record<string, GlyphName>)[name] ?? 'check'
}

export type Supply = { name: string; provided: boolean }

/** Supplies as small chips: what to bring, then what the organizer brings. */
export function SupplyChips({ supplies, limit }: { supplies: Supply[]; limit?: number }) {
  const shown = limit ? supplies.slice(0, limit) : supplies
  return <span className="supply-chips">{shown.map(item => <span key={item.name} className={'supply-chip' + (item.provided ? ' provided' : '')} title={item.provided ? '모집자가 준비해요' : '챙겨 올 것'}><Glyph name={supplyGlyph(item.name)} size={14} />{item.name}</span>)}
    {limit && supplies.length > limit && <span className="supply-chip more">+{supplies.length - limit}</span>}</span>
}
