import type { BreakIn } from '@semestra/api-client'
import { ChevronDownIcon, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Calendar } from '@/ui/calendar'
import { Input } from '@/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'

/** Reading weeks and holidays of a term (M02 §2): name and an inclusive date range each. */
export function BreaksEditor({
  value,
  onChange,
  min,
  max,
}: {
  value: readonly BreakIn[]
  onChange: (value: BreakIn[]) => void
  min?: string
  max?: string
}) {
  const update = (index: number, patch: Partial<BreakIn>) =>
    onChange(value.map((b, i) => (i === index ? { ...b, ...patch } : b)))
  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">{m.academics_breaks_none()}</p>
      ) : null}
      {value.map((b, index) => (
        // Breaks have no stable id until saved; their position is their identity while editing.
        // oxlint-disable-next-line react/no-array-index-key
        <div key={b.id ?? `new-${index}`} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={m.academics_break_name()}
            placeholder={m.academics_break_name_placeholder()}
            className="w-44"
            value={b.name}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <IsoDateField
            label={m.academics_break_start()}
            className="w-40"
            value={b.start_date}
            min={min}
            max={max}
            onChange={(start_date) => update(index, { start_date })}
          />
          <span aria-hidden className="text-muted-foreground">
            –
          </span>
          <IsoDateField
            label={m.academics_break_end()}
            className="w-40"
            value={b.end_date}
            min={b.start_date || min}
            max={max}
            onChange={(end_date) => update(index, { end_date })}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.academics_break_remove({ name: b.name || m.academics_break_name() })}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([...value, { name: '', start_date: min ?? '', end_date: min ?? '' }])
        }
      >
        <Plus aria-hidden />
        {m.academics_break_add()}
      </Button>
    </div>
  )
}

function parseIsoDate(value: string): Date | undefined {
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

function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function dayNumber(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
}

/** One `yyyy-MM-dd` day, edited with the base-luma date picker. */
function IsoDateField({
  id,
  label,
  value,
  onChange,
  invalid,
  describedBy,
  min,
  max,
  className,
}: {
  id?: string
  label?: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  describedBy?: string
  min?: string
  max?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = parseIsoDate(value)
  const minDate = min ? parseIsoDate(min) : undefined
  const maxDate = max ? parseIsoDate(max) : undefined
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            id={id}
            aria-label={label}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            data-empty={!selected}
            className={cn(
              'justify-between text-left font-normal data-[empty=true]:text-muted-foreground',
              className,
            )}
          />
        }
      >
        {value && selected ? formatDate(value) : <span>{m.academics_date_placeholder()}</span>}
        <ChevronDownIcon data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          disabled={
            minDate || maxDate
              ? (date) => {
                  const day = dayNumber(date)
                  if (minDate && day < dayNumber(minDate)) return true
                  if (maxDate && day > dayNumber(maxDate)) return true
                  return false
                }
              : undefined
          }
          onSelect={(next) => {
            onChange(next ? toIsoDate(next) : '')
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/** Breaks the API accepts: named, with both dates. Half-filled rows stay out of a save. */
export function completeBreaks(breaks: readonly BreakIn[]): BreakIn[] {
  return breaks.filter((b) => b.name.trim() && b.start_date && b.end_date)
}
