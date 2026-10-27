import { CalendarIcon } from 'lucide-react'
import { useId } from 'react'
import type { DateRange } from 'react-day-picker'
import { calendarLocale } from '@/lib/calendar'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Calendar } from '@/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'

/** A `yyyy-MM-dd` day as a local date, or undefined when it is not a real day. */
export function parseIsoDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined
  }
  return date
}

export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Calendar weeks a range touches, counting a started week (Sep 8 – Dec 18 is 15). */
export function rangeWeeks(start: string, end: string): number | null {
  const from = parseIsoDate(start)
  const to = parseIsoDate(end)
  if (!from || !to || to < from) return null
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
  return Math.ceil(days / 7)
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
  const buttonId = id ?? generated
  const from = parseIsoDate(start)
  const to = parseIsoDate(end)
  const minDate = min ? parseIsoDate(min) : undefined
  const maxDate = max ? parseIsoDate(max) : undefined
  const show = (iso: string) => formatDate(iso, { short })
  const count = weeks ? rangeWeeks(start, end) : null
  const struck = holidays.flatMap((h) => {
    const hFrom = parseIsoDate(h.start)
    const hTo = parseIsoDate(h.end)
    return hFrom && hTo ? [{ from: hFrom, to: hTo }] : []
  })
  const disabled = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ]
  return (
    <Popover>
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
          selected={from ? ({ from, to } satisfies DateRange) : undefined}
          disabled={disabled.length > 0 ? disabled : undefined}
          modifiers={struck.length > 0 ? { holiday: struck } : undefined}
          modifiersClassNames={{ holiday: 'text-muted-foreground line-through' }}
          onSelect={(range) =>
            onChange(
              range?.from ? toIsoDate(range.from) : '',
              range?.to ? toIsoDate(range.to) : range?.from ? toIsoDate(range.from) : '',
            )
          }
        />
      </PopoverContent>
    </Popover>
  )
}
