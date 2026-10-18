import type { BreakIn } from '@semestra/api-client'
import { Plus, Trash2 } from 'lucide-react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'

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
          <Input
            type="date"
            aria-label={m.academics_break_start()}
            className="w-40"
            min={min}
            max={max}
            value={b.start_date}
            onChange={(event) => update(index, { start_date: event.target.value })}
          />
          <span aria-hidden className="text-muted-foreground">
            –
          </span>
          <Input
            type="date"
            aria-label={m.academics_break_end()}
            className="w-40"
            min={b.start_date || min}
            max={max}
            value={b.end_date}
            onChange={(event) => update(index, { end_date: event.target.value })}
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

/** Breaks the API accepts: named, with both dates. Half-filled rows stay out of a save. */
export function completeBreaks(breaks: readonly BreakIn[]): BreakIn[] {
  return breaks.filter((b) => b.name.trim() && b.start_date && b.end_date)
}
