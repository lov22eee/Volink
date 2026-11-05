// Category covers (Volink 2.0): activities have no photos yet, so each card gets a drawn cover in its category's
// colours: soft tonal shapes and the category's icon on a white badge. Shapes and tint change with the activity id so
// neighbouring cards differ, and the drawing is plainly a graphic, never presented as a photo of the activity.
import type { ReactNode } from 'react'

type Tone = { key: string; bg: string[]; shape: string; ring: string; ink: string }
const tones: Record<string, Tone> = {
  환경: { key: 'env', bg: ['#E3EEE2', '#E8F0DF', '#DDEBE3', '#EAF1E6'], shape: '#C9DECB', ring: '#B2CFB7', ink: '#245E48' },
  교육: { key: 'edu', bg: ['#E6ECF6', '#E9EEF7', '#E1E8F4', '#ECF0F7'], shape: '#CBD7EC', ring: '#B4C5E3', ink: '#2F5A9A' },
  복지: { key: 'care', bg: ['#F5E4DE', '#F2DDD5', '#F7E9E4', '#F0DFD8'], shape: '#EBC7BB', ring: '#DFAE9F', ink: '#9E4632' },
  '문화·예술': { key: 'art', bg: ['#EFE6F4', '#F1E9F5', '#ECE2F2', '#F3ECF6'], shape: '#DCCBE8', ring: '#CBB3DD', ink: '#6B3F8E' },
  동물: { key: 'animal', bg: ['#F6EADA', '#F3E4D0', '#F8EEE1', '#F1E6D6'], shape: '#EDD3B2', ring: '#E2BF93', ink: '#9A5B1B' },
  지역사회: { key: 'town', bg: ['#E2EFEE', '#E6F1F0', '#DDEBEA', '#E9F3F2'], shape: '#C6DEDB', ring: '#ADCFCB', ink: '#24645E' },
  기타: { key: 'etc', bg: ['#ECEDEA', '#EFF0ED', '#E8E9E5', '#F1F2EF'], shape: '#D6D8D2', ring: '#C3C6BE', ink: '#55594F' },
  other: { key: 'other', bg: ['#E3EAF4', '#E7EDF5', '#DEE6F2', '#E9EEF5'], shape: '#C9D6EA', ring: '#B1C3E0', ink: '#2F5A9A' },
}

// 24-unit line icons, drawn with the tone's ink.
const icons: Record<string, ReactNode> = {
  환경: <><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14Z" /><path d="m5 19 7-7" /></>,
  교육: <><path d="M4 6.5c2.8-1 5.4-.8 8 .9 2.6-1.7 5.2-1.9 8-.9v12c-2.8-1-5.4-.8-8 .9-2.6-1.7-5.2-1.9-8-.9Z" /><path d="M12 7.4v12" /></>,
  복지: <><path d="M5.5 8h13l-1.2 12H6.7Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /><path d="M10 14.2c0-1 1.4-1.6 2-.6.6-1 2-.4 2 .6 0 1.2-2 2.4-2 2.4s-2-1.2-2-2.4Z" /></>,
  '문화·예술': <><path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-1 1.6-2.1-.5-1.2.3-2.4 1.6-2.4H17a4 4 0 0 0 4-4c0-5.2-4-9.5-9-9.5Z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></>,
  동물: <><circle cx="7" cy="9" r="1.8" /><circle cx="11" cy="6" r="1.8" /><circle cx="15.5" cy="7" r="1.8" /><circle cx="18" cy="11" r="1.8" /><path d="M12 12c-3 0-6 3.5-6 6 0 1.5 1.2 2.2 2.6 2 1.3-.2 2.2-.8 3.4-.8s2.1.6 3.4.8c1.4.2 2.6-.5 2.6-2 0-2.5-3-6-6-6Z" /></>,
  지역사회: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" /><path d="M16 5.8a3 3 0 0 1 0 5.6M17.5 14.2a5 5 0 0 1 3 4.6" /></>,
  기타: <><circle cx="12" cy="12" r="8.5" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></>,
  other: <><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 10h16M9 3v4M15 3v4" /><path d="m9.5 14.6 1.8 1.8 3.4-3.6" /></>,
}

// 1365 programs keep the blue tone (so they read as 1365) and only change the drawing by field.
const programIcons: Record<string, ReactNode> = {
  care: icons['복지'],
  life: icons['복지'],
  env: icons['환경'],
  animal: icons['동물'],
  art: icons['문화·예술'],
  town: icons['지역사회'],
  edu: <><path d="M4 6.5c2.8-1 5.4-.8 8 .9 2.6-1.7 5.2-1.9 8-.9v12c-2.8-1-5.4-.8-8 .9-2.6-1.7-5.2-1.9-8-.9Z" /><path d="M12 7.4v12" /></>,
  event: <><path d="M6 21V4" /><path d="M6 5h11l-2.5 4L17 13H6" /></>,
  safety: <><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6Z" /><path d="m9 12 2 2 4-4" /></>,
}

function Badge({ category, x, y, size = 96, icon }: { category: string; x: number; y: number; size?: number; icon?: string }) {
  const t = tones[category] ?? tones.other
  const s = size / 96
  return <g transform={`translate(${x - size / 2} ${y - size / 2})`}>
    <rect width={size} height={size} rx={26 * s} fill="#fff" filter="url(#cover-lift)" />
    <g transform={`translate(${size / 2 - 22 * s} ${size / 2 - 22 * s}) scale(${(44 / 24) * s})`} fill="none" stroke={t.ink} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{(icon && programIcons[icon]) ?? icons[category] ?? icons.other}</g>
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

export function CategoryCover({ category, seed, className, icon }: { category: string; seed: number; className?: string; icon?: string }) {
  const t = tones[category] ?? tones.other
  const n = Math.abs(seed)
  return <svg className={'cover' + (className ? ' ' + className : '')} viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${category} 기본 커버 그림`}>
    {defs(t)}
    <rect width="400" height="300" fill={t.bg[(n >> 2) % t.bg.length]} />
    <Shapes t={t} n={n} />
    <Badge category={category} x={200} y={150} icon={icon} />
  </svg>
}

/** Hero visual without a photo: the three fields as badges on one calm panel. */
export function HeroCover({ categories }: { categories: string[] }) {
  const t = tones['환경']
  return <svg className="cover" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" role="img" aria-label="봉사 분야를 나타낸 그림">
    {defs(t)}
    <rect width="400" height="500" fill="#E6EFE4" />
    <circle cx="330" cy="90" r="150" fill="#D6E6D5" />
    <circle cx="60" cy="420" r="170" fill="#DCEADB" />
    <circle cx="210" cy="250" r="128" fill="none" stroke="#BCD5C0" strokeWidth="2" strokeDasharray="4 8" />
    <rect x="34" y="40" width="88" height="76" fill="url(#cover-dots-env)" />
    {categories.slice(0, 3).map((category, i) => <Badge key={category} category={category} x={[160, 300, 312][i]} y={[150, 236, 384][i]} size={[104, 88, 92][i]} />)}
  </svg>
}

/** Wide strip for the bottom of the sign-up / login card: the three fields joined by a dotted path. */
export function FieldStrip({ categories }: { categories: string[] }) {
  const t = tones['환경']
  return <svg className="cover" viewBox="0 0 400 170" preserveAspectRatio="xMidYMid slice" role="img" aria-label="봉사 분야를 나타낸 그림">
    {defs(t)}
    <rect width="400" height="170" fill="#E6EFE4" />
    <circle cx="40" cy="170" r="110" fill="#DCEADB" />
    <circle cx="370" cy="10" r="90" fill="#D6E6D5" />
    <path d="M70 92 C130 40 170 140 200 88 S290 40 330 92" fill="none" stroke="#BCD5C0" strokeWidth="2" strokeDasharray="4 8" />
    <rect x="300" y="118" width="76" height="40" fill="url(#cover-dots-env)" />
    {categories.slice(0, 3).map((category, i) => <Badge key={category} category={category} x={[80, 200, 320][i]} y={[92, 80, 92][i]} size={[68, 76, 68][i]} />)}
  </svg>
}
