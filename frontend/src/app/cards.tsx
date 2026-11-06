// Small activity rows used on several app screens (home, find, host, saved).
import { Capacitor, registerPlugin } from '@capacitor/core'
import { categoryTone } from '../categories'
import type { LiveActivity } from '../api'
import { durationLabel } from '../create'
import { dayWord, MIcon } from './ui'
import type { MIconName } from './ui'

export const fieldIcon: Record<string, MIconName> = { 환경: 'leaf', 교육: 'book', 복지: 'hand', '문화·예술': 'palette', 동물: 'paw', 지역사회: 'users', 기타: 'sprout' }
export const difficultyLabel = { EASY: '가벼워요', NORMAL: '보통', HARD: '힘들어요' } as const
export const placeKindLabel = { OUTDOOR: '야외', INDOOR: '실내', MIXED: '실내·야외' } as const

export const seatsLeft = (a: Pick<LiveActivity, 'capacity' | 'confirmed'>) => Math.max(0, a.capacity - a.confirmed)
export const startsAt = (a: Pick<LiveActivity, 'date' | 'startTime'>) => new Date(`${a.date}T${a.startTime}:00+09:00`).getTime()
export const isNewcomer = (a: Pick<LiveActivity, 'newcomerOk'>) => a.newcomerOk === undefined || Boolean(a.newcomerOk)

/** The single most useful badge for a card: 마감 임박 > 처음 환영 > N자리 남음. */
export function badgeOf(a: LiveActivity): { text: string; tone: 'hot' | 'mint' | 'gray' } {
  const left = seatsLeft(a)
  if (left === 0) return { text: '정원 마감', tone: 'gray' }
  if (startsAt(a) - Date.now() < 48 * 3_600_000) return { text: left + '자리 남음', tone: 'hot' }
  if (isNewcomer(a)) return { text: '처음 환영', tone: 'mint' }
  return { text: left + '자리 남음', tone: 'gray' }
}

export function ActivityRow({ activity, note, href }: { activity: LiveActivity; note?: string; href?: string }) {
  const badge = badgeOf(activity)
  const meta = [dayWord(activity.date) + ' ' + activity.startTime, durationLabel(activity.durationMinutes),
    activity.distanceKm != null ? activity.distanceKm + 'km' : activity.placeName ?? ''].filter(Boolean).join(' · ')
  return <a className="m-row" href={href ?? '#/activity/' + activity.id}>
    <span className={'m-row-ico f' + categoryTone(activity.category)}><MIcon name={fieldIcon[activity.category] ?? 'sprout'} size={22} /></span>
    <span className="m-row-main"><strong>{activity.title}</strong><small>{meta}</small>{note && <em>{note}</em>}</span>
    <span className={'m-badge ' + badge.tone}>{badge.text}</span>
  </a>
}

const nativeCalendar = registerPlugin<{ add(event: { title: string; begin: number; end: number; location: string; description: string }): Promise<{ opened: boolean }> }>('VolinkCalendar')

type CalendarActivity = Pick<LiveActivity, 'id' | 'title' | 'date' | 'startTime' | 'durationMinutes' | 'placeName' | 'meetingPoint'>

/**
 * In the app: opens the phone calendar's own "new event" screen already filled in (Galaxy: Samsung Calendar) — the person
 * only taps save. Elsewhere, or when no calendar app answers: an .ics file. Nothing is sent anywhere.
 * Returns 'app' when the calendar screen opened, 'file' when a file was downloaded.
 */
/** `note`: the event description (default: the Volink line; a 1365 record says where to check or cancel). */
export async function addToCalendar(a: CalendarActivity, note = 'Volink 활동 · 못 가게 되면 앱에서 미리 알려 주세요.'): Promise<'app' | 'file'> {
  const start = new Date(`${a.date}T${a.startTime}:00+09:00`)
  const end = new Date(start.getTime() + a.durationMinutes * 60_000)
  if (Capacitor.isNativePlatform()) {
    try {
      await nativeCalendar.add({ title: a.title, begin: start.getTime(), end: end.getTime(),
        location: [a.placeName, a.meetingPoint].filter(Boolean).join(' · '), description: note })
      return 'app'
    } catch { /* no calendar app or an older APK without the plugin: fall back to the file */ }
  }
  calendarFile(a, start, end, note)
  return 'file'
}

function calendarFile(a: CalendarActivity, start: Date, end: Date, note: string) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const text = (value: string) => value.replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n')
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Volink//KO', 'BEGIN:VEVENT', `UID:volink-${a.id}@volink`, `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${text(a.title)}`, `LOCATION:${text([a.placeName, a.meetingPoint].filter(Boolean).join(' · '))}`,
    `DESCRIPTION:${text(note)}`, 'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:봉사 1시간 전', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }))
  link.download = `volink-${a.id}.ics`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 4000)
}
