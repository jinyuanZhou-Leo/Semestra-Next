import type { PageProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { longDayLabel, weekLabel } from '../labels'
import { useToday } from '../queries'

/** The date and the term week, under the title of the Today page. */
export function TodaySubtitle({ scope }: PageProps) {
  const today = useToday(scope.programId).data
  const week = today?.week
  if (!today) return null
  if (!week) return `${longDayLabel(today.day)} · ${m.schedule_no_term_today()}`
  return [
    longDayLabel(today.day),
    week.term_name,
    weekLabel(week.number, week.break_name),
    week.number != null ? week.break_name : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
