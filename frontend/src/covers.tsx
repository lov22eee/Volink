// Category covers (Volink 2.0): activities have no photos yet, so each card gets a drawn cover in its category's
// colours: soft tonal shapes and the category's icon on a white badge. Shapes and tint change with the activity id so
// neighbouring cards differ, and the drawing is plainly a graphic, never presented as a photo of the activity.
import type { ReactNode } from 'react'

type Tone = { key: string; bg: string[]; shape: string; ring: string; ink: string }
const tones: Record<string, Tone> = {
  '환경 정화': { key: 'env', bg: ['#E3EEE2', '#E8F0DF', '#DDEBE3', '#EAF1E6'], shape: '#C9DECB', ring: '#B2CFB7', ink: '#245E48' },
  '생활 지원': { key: 'life', bg: ['#F6EADA', '#F3E4D0', '#F8EEE1', '#F1E6D6'], shape: '#EDD3B2', ring: '#E2BF93', ink: '#9A5B1B' },
  '지역 돌봄': { key: 'care', bg: ['#F5E4DE', '#F2DDD5', '#F7E9E4', '#F0DFD8'], shape: '#EBC7BB', ring: '#DFAE9F', ink: '#9E4632' },
  other: { key: 'other', bg: ['#E3EAF4', '#E7EDF5', '#DEE6F2', '#E9EEF5'], shape: '#C9D6EA', ring: '#B1C3E0', ink: '#2F5A9A' },
}

// 24-unit line icons, drawn with the tone's ink.
const icons: Record<string, ReactNode> = {
  '환경 정화': <><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14Z" /><path d="m5 19 7-7" /></>,
  '생활 지원': <><path d="M5.5 8h13l-1.2 12H6.7Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /><path d="M10 14.2c0-1 1.4-1.6 2-.6.6-1 2-.4 2 .6 0 1.2-2 2.4-2 2.4s-2-1.2-2-2.4Z" /></>,
  '지역 돌봄': <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" /><path d="M16 5.8a3 3 0 0 1 0 5.6M17.5 14.2a5 5 0 0 1 3 4.6" /></>,
  other: <><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 10h16M9 3v4M15 3v4" /><path d="m9.5 14.6 1.8 1.8 3.4-3.6" /></>,
}

function Badge({ category, x, y, size = 96 }: { category: string; x: number; y: number; size?: number }) {
  const t = tones[category] ?? tones.other
  const s = size / 96
  return <g transform={`translate(${x - size / 2} ${y - size / 2})`}>
    <rect width={size} height={size} rx={26 * s} fill="#fff" filter="url(#cover-lift)" />
    <g transform={`translate(${size / 2 - 22 * s} ${size / 2 - 22 * s}) scale(${(44 / 24) * s})`} fill="none" stroke={t.ink} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icons[category] ?? icons.other}</g>
  </g>
}

function Shapes({ t, n }: { t: Tone; n: number }) {
  const spots = [[60, 250, 150, 340, 40, 110], [340, 260, 60, 40, 170, 120], [330, 40, 70, 270, 150, 130], [70, 40, 340, 270, 130, 150]][n % 4]
  return <>
    <circle cx={spots[0]} cy={spots[1]} r={spots[4]} fill={t.shape} opacity=".7" />
    <circle cx={spots[2]} cy={spots[3]} r={spots[5]} fill="none" stroke={t.ring} strokeWidth="2" opacity=".8" />
    <rect x={n % 2 ? 24 : 300} y={n % 2 ? 22 : 214} width="76" height="64" fill={`url(#cover-dots-${t.key})`} opacity=".9" />
  </>
}

const defs = (t: Tone) => <defs>
  <filter id="cover-lift" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#1d2a24" floodOpacity=".10" /></filter>
  <pattern id={'cover-dots-' + t.key} width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill={t.ring} /></pattern>
</defs>

export function CategoryCover({ category, seed, className }: { category: string; seed: number; className?: string }) {
  const t = tones[category] ?? tones.other
  const n = Math.abs(seed)
  return <svg className={'cover' + (className ? ' ' + className : '')} viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${category} 기본 커버 그림`}>
    {defs(t)}
    <rect width="400" height="300" fill={t.bg[(n >> 2) % t.bg.length]} />
    <Shapes t={t} n={n} />
    <Badge category={category} x={200} y={150} />
  </svg>
}

/** Hero visual without a photo: the three fields as badges on one calm panel. */
export function HeroCover({ categories }: { categories: string[] }) {
  const t = tones['환경 정화']
  return <svg className="cover" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" role="img" aria-label="환경 정화·생활 지원·지역 돌봄 분야를 나타낸 그림">
    {defs(t)}
    <rect width="400" height="500" fill="#E6EFE4" />
    <circle cx="330" cy="90" r="150" fill="#D6E6D5" />
    <circle cx="60" cy="420" r="170" fill="#DCEADB" />
    <circle cx="210" cy="250" r="128" fill="none" stroke="#BCD5C0" strokeWidth="2" strokeDasharray="4 8" />
    <rect x="34" y="40" width="88" height="76" fill="url(#cover-dots-env)" />
    {categories.slice(0, 3).map((category, i) => <Badge key={category} category={category} x={[160, 300, 312][i]} y={[150, 236, 384][i]} size={[104, 88, 92][i]} />)}
  </svg>
}
