import type { BreakIn, Term, TermUpdateInputBody } from '@semestra/api-client'
import { academicsTermUpdateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import { DangerZone, useAutosave } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { SettingList } from '@/components/SettingRow'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Switch } from '@/ui/switch'
import { academicsTermGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
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
  const rangeInvalid = Boolean(start && end && end < start)
  return (
    <>
      <SettingList>
        <TextRow
          label={m.academics_term_name()}
          value={term.name}
          required
          onChange={(name) => queue({ name })}
        />
        <TextRow
          label={m.academics_term_start()}
          type="date"
          value={start}
          required
          onChange={(value) => {
            setStart(value)
            if (!(end && end < value)) queue({ start_date: value, end_date: end })
          }}
        />
        <TextRow
          label={m.academics_term_end()}
          type="date"
          value={end}
          required
          invalid={rangeInvalid ? m.error_academics_term_date_range_invalid() : null}
          onChange={(value) => {
            setEnd(value)
            if (!(start && value < start)) queue({ start_date: start, end_date: value })
          }}
        />
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
        <div className="space-y-2 p-4">
          <p className="text-sm font-medium">{m.academics_term_breaks()}</p>
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
        </div>
      </SettingList>
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
