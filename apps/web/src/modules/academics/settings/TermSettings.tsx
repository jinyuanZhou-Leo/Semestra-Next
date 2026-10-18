import type { BreakIn, Term, TermUpdateInputBody } from '@semestra/api-client'
import {
  academicsTermGetOptions,
  academicsTermUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDownIcon } from 'lucide-react'
import { useId, useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import { DangerZone, useAutosave } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { toastError } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Calendar } from '@/ui/calendar'
import { FieldError } from '@/ui/field'
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from '@/ui/item'
import { Label } from '@/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Switch } from '@/ui/switch'
import { BreaksEditor, completeBreaks } from '../components/BreaksEditor'
import { DeleteTermDialog } from '../components/DeleteTermDialog'
import { invalidateAcademics } from '../queries'
import { ControlRow, TextRow } from './rows'

/** Term "basics" (M02 §5.4): name, dates, breaks, week numbering; delete with a preview. */
export function TermBasicsSection({ scope }: SettingsSectionProps) {
  const termId = scope?.kind === 'term' ? scope.termId : ''
  const term = useQuery(academicsTermGetOptions({ path: { term_id: termId } }))
  return <AsyncBoundary query={term}>{(t) => <TermBasics key={t.id} term={t} />}</AsyncBoundary>
}

function TermBasics({ term }: { term: Term }) {
  const queryClient = useQueryClient()
  const update = useMutation({ ...academicsTermUpdateMutation() })
  const { queue } = useAutosave<TermUpdateInputBody>({
    save: async (body) => {
      try {
        await update.mutateAsync({ path: { term_id: term.id }, body })
      } catch (error) {
        toastError(error)
        throw error
      }
      await invalidateAcademics(queryClient)
    },
  })
  const [start, setStart] = useState(term.start_date)
  const [end, setEnd] = useState(term.end_date)
  const [breaks, setBreaks] = useState<BreakIn[]>(term.breaks)
  const [countBreakWeeks, setCountBreakWeeks] = useState(term.count_break_weeks)
  const [deleting, setDeleting] = useState(false)
  const id = useId()
  const rangeInvalid = Boolean(start && end && end < start)
  return (
    <>
      <ItemGroup className="gap-0 rounded-2xl border">
        <TextRow
          label={m.academics_term_name()}
          value={term.name}
          required
          onChange={(name) => queue({ name })}
        />
        <ItemSeparator className="my-0" />
        <Item>
          <ItemContent className="min-w-0 basis-64">
            <ItemTitle>
              <Label htmlFor={`${id}-start`}>{m.academics_term_start()}</Label>
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <IsoDateField
              id={`${id}-start`}
              className="w-44"
              value={start}
              onChange={(value) => {
                setStart(value)
                if (!(end && end < value)) queue({ start_date: value, end_date: end })
              }}
            />
          </ItemActions>
        </Item>
        <ItemSeparator className="my-0" />
        <Item>
          <ItemContent className="min-w-0 basis-64">
            <ItemTitle>
              <Label htmlFor={`${id}-end`}>{m.academics_term_end()}</Label>
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <div className="flex flex-col items-end gap-1">
              <IsoDateField
                id={`${id}-end`}
                className="w-44"
                value={end}
                invalid={rangeInvalid}
                describedBy={rangeInvalid ? `${id}-end-error` : undefined}
                onChange={(value) => {
                  setEnd(value)
                  if (!(start && value < start)) queue({ start_date: start, end_date: value })
                }}
              />
              <FieldError id={`${id}-end-error`} className="text-xs">
                {rangeInvalid ? m.error_academics_term_date_range_invalid() : null}
              </FieldError>
            </div>
          </ItemActions>
        </Item>
        <ItemSeparator className="my-0" />
        <ControlRow
          label={m.academics_term_count_break_weeks()}
          description={m.academics_term_count_break_weeks_hint()}
        >
          {(labelId) => (
            <Switch
              aria-labelledby={labelId}
              checked={countBreakWeeks}
              onCheckedChange={(on) => {
                setCountBreakWeeks(on)
                queue({ count_break_weeks: on })
              }}
            />
          )}
        </ControlRow>
        <ItemSeparator className="my-0" />
        <Item>
          <ItemContent className="gap-2">
            <ItemTitle>{m.academics_term_breaks()}</ItemTitle>
            <BreaksEditor
              value={breaks}
              min={start}
              max={end}
              onChange={(next) => {
                setBreaks(next)
                // Half-filled rows wait until they are complete.
                if (completeBreaks(next).length === next.length) queue({ breaks: next })
              }}
            />
          </ItemContent>
        </Item>
      </ItemGroup>
      <DangerZone>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{m.academics_term_delete_description()}</p>
          <Button variant="destructive" onClick={() => setDeleting(true)}>
            {m.academics_term_delete()}
          </Button>
        </div>
      </DangerZone>
      <DeleteTermDialog term={term} open={deleting} onOpenChange={setDeleting} />
    </>
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

/** One `yyyy-MM-dd` day, edited with the base-luma date picker. */
function IsoDateField({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  className,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  describedBy?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = parseIsoDate(value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            id={id}
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
          onSelect={(next) => {
            onChange(next ? toIsoDate(next) : '')
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
