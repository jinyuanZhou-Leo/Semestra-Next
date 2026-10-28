import { CalendarIcon } from 'lucide-react'
import { differenceInCalendarWeeks } from 'date-fns'
import { useId, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { calendarLocale } from '@/lib/calendar'
import { isoDay, parseDay } from '@/lib/day'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Calendar } from '@/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'

/** Calendar weeks a range touches, counted like the API's week numbers (M02 §3). */
export function rangeWeeks(start: string, end: string): number | null {
  const from = parseDay(start)
  const to = parseDay(end)
  if (!from || !to || to < from) return null
  return differenceInCalendarWeeks(to, from, { weekStartsOn: calendarLocale().weekStartsOn }) + 1
}

/**
 * A range of days (a term, a break), picked like shadcn's date-picker-range: an outline button
 * that opens a two-month calendar over the page, so the layout stays the same open or closed.
 * `short` leaves out the year, for breaks inside a term already shown with its year.
 */
export function DateRangeField({
  id,
  label,
  labelledBy,
  start,
  end,
  onChange,
  min,
  max,
  holidays = [],
  weeks,
  short,
  placeholder,
  invalid,
  describedBy,
  align = 'start',
  className,
}: {
  id?: string
  /** For a field without a visible label (a table cell). */
  label?: string
  /** A visible label elsewhere (a settings row); the button reads as that label, then its dates. */
  labelledBy?: string
  start: string
  end: string
  onChange: (start: string, end: string) => void
  min?: string
  max?: string
  /** Ranges struck through in the calendar (a term's breaks). */
  holidays?: readonly { start: string; end: string }[]
  /** Shows the number of weeks at the end of the button. */
  weeks?: boolean
  short?: boolean
  placeholder?: string
  invalid?: boolean
  describedBy?: string
  align?: 'start' | 'end'
  className?: string
}) {
  const generated = useId()
  // The first click of a new range lives here until the second one; only whole ranges reach
  // `onChange`, so autosaving callers never store a half-picked range.
  const [pending, setPending] = useState<DateRange | null>(null)
  const buttonId = id ?? generated
  const from = parseDay(start)
  const to = parseDay(end)
  const minDate = min ? parseDay(min) : undefined
  const maxDate = max ? parseDay(max) : undefined
  const show = (iso: string) => formatDate(iso, { short })
  const count = weeks ? rangeWeeks(start, end) : null
  const struck = holidays.flatMap((h) => {
    const hFrom = parseDay(h.start)
    const hTo = parseDay(h.end)
    return hFrom && hTo ? [{ from: hFrom, to: hTo }] : []
  })
  const disabled = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ]
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) setPending(null)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            id={buttonId}
            aria-label={label}
            aria-labelledby={labelledBy ? `${labelledBy} ${buttonId}` : undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn('justify-start px-2.5 font-normal', className)}
          />
        }
      >
        <CalendarIcon data-icon="inline-start" />
        {from ? (
          <span className="truncate">
            {to && end !== start ? `${show(start)} – ${show(end)}` : show(start)}
          </span>
        ) : (
          <span className="truncate text-muted-foreground">
            {placeholder ?? m.academics_date_placeholder()}
          </span>
        )}
        {count ? (
          <span className="ml-auto text-muted-foreground">{m.academics_term_weeks({ count })}</span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          {...calendarLocale()}
          mode="range"
          numberOfMonths={2}
          defaultMonth={from ?? minDate}
          resetOnSelect
          required
          selected={pending ?? { from, to }}
          disabled={disabled.length > 0 ? disabled : undefined}
          modifiers={struck.length > 0 ? { holiday: struck } : undefined}
          modifiersClassNames={{ holiday: 'text-muted-foreground line-through' }}
          onSelect={(range) => {
            if (range?.from && range.to) {
              setPending(null)
              onChange(isoDay(range.from), isoDay(range.to))
            } else setPending(range)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
