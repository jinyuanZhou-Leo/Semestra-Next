import { CalendarIcon } from 'lucide-react'
import { useState } from 'react'
import { calendarLocale } from '@/lib/calendar'
import { dayDate, isoDay } from '@/lib/day'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/button'
import { Calendar } from '@/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'

const DAY = /^\d{4}-\d{2}-\d{2}$/

const clamp = (day: string, range: { start: string; end: string }) =>
  day < range.start ? range.start : day > range.end ? range.end : day

/**
 * One day, picked like shadcn's date picker: an outline button that opens a calendar and closes
 * once a day is picked. The value is `YYYY-MM-DD`, or empty when nothing is picked.
 */
export function DateField({
  id,
  value,
  onChange,
  placeholder,
  allowed,
  range,
  invalid,
  disabled,
  className,
  ...aria
}: {
  id?: string
  value: string
  onChange: (day: string) => void
  placeholder: string
  /** Limits the days that can be picked. */
  allowed?: (day: Date) => boolean
  /** The first and last day the calendar shows (e.g. the term's); with nothing picked it opens on
   * `today`, kept within them. */
  range?: { start: string; end: string; today: string }
  invalid?: boolean
  disabled?: boolean
  className?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}) {
  const [open, setOpen] = useState(false)
  const picked = DAY.test(value) ? dayDate(value) : undefined
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={invalid || undefined}
            data-empty={!picked}
            className={cn(
              'justify-start text-left font-normal data-[empty=true]:text-muted-foreground',
              className,
            )}
            {...aria}
          />
        }
      >
        <CalendarIcon data-icon="inline-start" />
        <span className="truncate">{picked ? formatDate(value) : placeholder}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          {...calendarLocale()}
          mode="single"
          selected={picked}
          defaultMonth={picked ?? (range ? dayDate(clamp(range.today, range)) : undefined)}
          startMonth={range ? dayDate(range.start) : undefined}
          endMonth={range ? dayDate(range.end) : undefined}
          disabled={allowed ? (day) => !allowed(day) : undefined}
          onSelect={(next) => {
            onChange(next ? isoDay(next) : '')
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
