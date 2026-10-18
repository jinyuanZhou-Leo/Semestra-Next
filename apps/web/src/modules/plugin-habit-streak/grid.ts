/** Calendar arithmetic for the habit board on ISO dates ("2026-01-15"), free of time zones. */

export type WeekStart = 1 | 7

const DAY = 86_400_000

function toUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * DAY)
}

/** The first day of the week containing `iso`. */
export function weekStartOf(iso: string, weekStart: WeekStart): string {
  const weekday = new Date(toUtc(iso)).getUTCDay() // 0 = Sunday
  const offset = weekStart === 7 ? weekday : (weekday + 6) % 7
  return addDays(iso, -offset)
}

export type DayCell = { date: string; future: boolean }

/** The last `weeks` weeks ending with the week of `today`; each week has seven days. */
export function weekColumns(today: string, weekStart: WeekStart, weeks: number): DayCell[][] {
  const first = addDays(weekStartOf(today, weekStart), -7 * (weeks - 1))
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (__, d) => {
      const date = addDays(first, w * 7 + d)
      return { date, future: date > today }
    }),
  )
}

/** The first and last date shown by `weekColumns`, to fetch the check-ins in one call. */
export function columnsRange(today: string, weekStart: WeekStart, weeks: number) {
  return {
    from: addDays(weekStartOf(today, weekStart), -7 * (weeks - 1)),
    to: addDays(weekStartOf(today, weekStart), 6),
  }
}

export const MILESTONES = [7, 30, 100] as const

/** The milestone a streak of `streak` has just reached, if any. */
export function milestoneAt(streak: number): number | null {
  return (MILESTONES as readonly number[]).includes(streak) ? streak : null
}

/** Weeks the board shows per card size (M14 §2). */
export const BOARD_WEEKS = { m: 5, l: 10, xl: 20 } as const
