/** The habit history's grid of ISO dates ("2026-01-15"). */
import { plusDays, weekStartOf } from '@/lib/day'

export type WeekStart = 1 | 7

export type DayCell = { date: string; future: boolean }

/** The last `weeks` weeks ending with the week of `today`; each week has seven days. */
export function weekColumns(today: string, weekStart: WeekStart, weeks: number): DayCell[][] {
  const first = plusDays(weekStartOf(today, weekStart), -7 * (weeks - 1))
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (__, d) => {
      const date = plusDays(first, w * 7 + d)
      return { date, future: date > today }
    }),
  )
}

/** The first and last date shown by `weekColumns`, to fetch the check-ins in one call. */
export function columnsRange(today: string, weekStart: WeekStart, weeks: number) {
  return {
    from: plusDays(weekStartOf(today, weekStart), -7 * (weeks - 1)),
    to: plusDays(weekStartOf(today, weekStart), 6),
  }
}

export const MILESTONES = [7, 30, 100] as const

/** The milestone a streak of `streak` has just reached, if any. */
export function milestoneAt(streak: number): number | null {
  return (MILESTONES as readonly number[]).includes(streak) ? streak : null
}

/** The most weeks the history shows; the card fits as many as its width allows (M14 §2). */
export const HISTORY_WEEKS = 52
