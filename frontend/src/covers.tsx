// Category covers (Volink 2.0): activities have no photos yet, so each card gets a drawn cover in its
// category's colours. The layout and tone change with the activity id so neighbouring cards do not repeat,
// and the drawing is plainly graphic, never presented as a photo of the activity.
import type { ReactNode } from 'react'

type Tone = { bg: string[]; deep: string; mid: string; light: string; accent: string }
const tones: Record<string, Tone> = {
  '환경 정화': { bg: ['#DCE9DA', '#E5EDD7', '#D4E5DC', '#E9EFE1'], deep: '#2D6A4F', mid: '#6FA383', light: '#B7D3BE', accent: '#F0D58A' },
  '생활 지원': { bg: ['#F5E6CC', '#F1DCC0', '#F7EBD8', '#EEE0C7'], deep: '#B4722C', mid: '#DDA35F', light: '#EDCB98', accent: '#8DB79A' },
  '지역 돌봄': { bg: ['#F4DED6', '#F0D4CA', '#F6E5DF', '#EED8CF'], deep: '#B0553E', mid: '#DB8A73', light: '#EDB9A9', accent: '#F0D58A' },
  other: { bg: ['#DCE5F2', '#E3E9F3', '#D6E1EF', '#E7ECF4'], deep: '#2F5DA0', mid: '#7E9FCE', light: '#B9CBE6', accent: '#F0D58A' },
}

// Motifs drawn around (0,0), roughly 100 units tall.
function motif(category: string, t: Tone, k: number): ReactNode {
  if (category === '환경 정화') return k % 2
    ? <g><path d="M0 0C-38-6-52-48-44-92 2-80 18-40 0 0Z" fill={t.deep} /><path d="M0 0C30-10 52-44 50-80 12-70-6-36 0 0Z" fill={t.mid} /><path d="M0 0V-70" stroke={t.light} strokeWidth="3" /></g>
    : <g><path d="M0 0C-50-20-60-70-30-104 10-80 22-40 0 0Z" fill={t.mid} /><path d="M0 0C-8-36-22-62-34-92" stroke={t.light} strokeWidth="3" fill="none" /><circle cx="26" cy="-30" r="18" fill={t.deep} /></g>
  if (category === '생활 지원') return k % 2
    ? <g><rect x="-50" y="-44" width="56" height="44" rx="6" fill={t.mid} /><rect x="-4" y="-80" width="52" height="80" rx="6" fill={t.deep} /><rect x="-34" y="-86" width="40" height="38" rx="6" fill={t.light} /><path d="M-2 -66h46" stroke={t.light} strokeWidth="3" /></g>
    : <g><path d="M-44-70h88l-8 70h-72Z" fill={t.deep} /><path d="M-20-70v-14a20 20 0 0 1 40 0v14" stroke={t.mid} strokeWidth="7" fill="none" /><rect x="-30" y="-46" width="60" height="10" rx="5" fill={t.light} /></g>
  if (category === '지역 돌봄') return k % 2
    ? <g><circle cx="-24" cy="-74" r="16" fill={t.deep} /><path d="M-52 0a28 34 0 0 1 56 0Z" fill={t.deep} /><circle cx="26" cy="-64" r="13" fill={t.mid} /><path d="M4 0a22 28 0 0 1 44 0Z" fill={t.mid} /></g>
    : <g><path d="M0-12C-40-40-48-70-28-86c12-10 26-4 28 8 2-12 16-18 28-8 20 16 12 46-28 74Z" fill={t.deep} /><circle cx="40" cy="-86" r="10" fill={t.light} /></g>
  return <g><rect x="-44" y="-84" width="88" height="84" rx="10" fill={t.deep} /><path d="M-26-56h52M-26-38h52M-26-20h34" stroke={t.light} strokeWidth="6" strokeLinecap="round" /></g>
}

export function CategoryCover({ category, seed, className }: { category: string; seed: number; className?: string }) {
  const t = tones[category] ?? tones.other
  const n = Math.abs(seed)
  const layout = n % 4
  const bg = t.bg[(n >> 2) % t.bg.length]
  const ground = <path d={layout % 2 ? 'M0 250Q120 220 230 240T400 228V300H0Z' : 'M0 238Q140 262 260 236T400 246V300H0Z'} fill={t.light} opacity=".75" />
  const scenes: ReactNode[] = [
    <>{ground}<circle cx="318" cy="70" r="34" fill={t.accent} opacity=".9" /><g transform="translate(210 250) scale(1.45)">{motif(category, t, n)}</g><g transform="translate(92 252) scale(.75)">{motif(category, t, n + 1)}</g></>,
    <><rect x="0" y="0" width="400" height="300" fill={`url(#stripe-${n})`} />{ground}<g transform="translate(110 246) scale(1.1)">{motif(category, t, n + 1)}</g><g transform="translate(220 246) scale(1.35)">{motif(category, t, n)}</g><g transform="translate(320 248) scale(.8)">{motif(category, t, n + 1)}</g></>,
    <><circle cx="200" cy="160" r="112" fill={t.light} opacity=".7" /><circle cx="86" cy="64" r="18" fill={t.accent} /><g transform="translate(200 230) scale(1.6)">{motif(category, t, n)}</g></>,
    <><path d="M-20 300 260 -20H420L140 300Z" fill={t.light} opacity=".6" />{ground}<g transform="translate(300 250) scale(1.3)">{motif(category, t, n + 1)}</g><circle cx="96" cy="96" r="44" fill={t.accent} opacity=".85" /><g transform="translate(118 252) scale(.9)">{motif(category, t, n)}</g></>,
  ]
  return <svg className={'cover' + (className ? ' ' + className : '')} viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${category} 기본 커버 그림`}>
    <defs><pattern id={`stripe-${n}`} width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="22" height="22" fill={bg} /><rect width="3" height="22" fill={t.light} opacity=".55" /></pattern></defs>
    <rect width="400" height="300" fill={bg} />
    {scenes[layout]}
  </svg>
}

/** Hero mosaic: one tile per real category, no photo. */
export function CategoryMosaic({ categories }: { categories: string[] }) {
  return <div className="cover-mosaic" aria-hidden="true">
    {categories.slice(0, 3).map((category, i) => <CategoryCover key={category} category={category} seed={i * 5 + 2} />)}
  </div>
}
