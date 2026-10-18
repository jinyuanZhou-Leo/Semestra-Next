import type { PageProps } from '@/app/extensions'
import { CardGrid } from '@/app/host/CardGrid'
import { m } from '@/paraglide/messages'
import { longDayLabel, weekLabel } from '../labels'
import { useToday } from '../queries'

/**
 * The Program's "today" page (M04 §5.1): a fixed header with the date and the term week, then
 * the `today` board. Works on phones (the board falls back to one column).
 */
export default function TodayPage({ scope }: PageProps) {
  const today = useToday(scope.programId).data
  const week = today?.week
  return (
    <div className="space-y-4">
      <header className="space-y-0.5">
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          {today ? longDayLabel(today.day) : m.schedule_today()}
        </h2>
        {week ? (
          <p className="text-sm text-muted-foreground">
            {week.term_name} · {weekLabel(week.number, week.break_name)}
            {week.number != null && week.break_name ? ` · ${week.break_name}` : ''}
          </p>
        ) : today ? (
          <p className="text-sm text-muted-foreground">{m.schedule_no_term_today()}</p>
        ) : null}
      </header>
      <CardGrid scope={scope} board="today" />
    </div>
  )
}
