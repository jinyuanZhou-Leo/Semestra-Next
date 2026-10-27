import type { Locale } from 'react-day-picker'
import { enUS, zhCN } from 'react-day-picker/locale'
import { getLocale } from '@/paraglide/runtime'
import { firstDayOfWeek } from './format'

/**
 * What every `Calendar` gets: month and weekday names in the interface language, and the first
 * day of the week from the user's preference (M11). Called while rendering; a language change
 * remounts the app, so nothing here is cached.
 */
export function calendarLocale(): { locale: Locale; weekStartsOn: 0 | 1 } {
  return {
    locale: getLocale().startsWith('zh') ? zhCN : enUS,
    weekStartsOn: firstDayOfWeek() === 1 ? 1 : 0,
  }
}
