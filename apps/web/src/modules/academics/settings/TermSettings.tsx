import type { BreakIn, Term, TermUpdateInputBody } from '@semestra/api-client'
import {
  academicsTermGetOptions,
  academicsTermUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import {
  DangerZone,
  SettingRow,
  SettingsBlock,
  SettingsGroup,
  TextRow,
  useAutosave,
} from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Switch } from '@/ui/switch'
import { BreaksTable, completeBreaks } from '../components/BreaksTable'
import { DateRangeField } from '../components/DateRangeField'
import { DeleteTermDialog } from '../components/DeleteTermDialog'
import { invalidateAcademics } from '../queries'

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
  return (
    <>
      <SettingsGroup>
        <TextRow
          label={m.academics_term_name()}
          value={term.name}
          required
          onChange={(name) => queue({ name })}
        />
        <SettingRow label={m.academics_term_dates()}>
          {(labelId) => (
            <DateRangeField
              labelledBy={labelId}
              className="w-80"
              start={start}
              end={end}
              weeks
              holidays={completeBreaks(breaks).map((b) => ({
                start: b.start_date,
                end: b.end_date,
              }))}
              onChange={(nextStart, nextEnd) => {
                setStart(nextStart)
                setEnd(nextEnd)
                if (nextStart && nextEnd) queue({ start_date: nextStart, end_date: nextEnd })
              }}
            />
          )}
        </SettingRow>
        <SettingRow
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
        </SettingRow>
      </SettingsGroup>
      <SettingsBlock title={m.academics_term_breaks()}>
        <BreaksTable
          value={breaks}
          min={start}
          max={end}
          onChange={(next) => {
            setBreaks(next)
            // Half-filled rows wait until they are complete.
            if (completeBreaks(next).length === next.length) queue({ breaks: next })
          }}
        />
      </SettingsBlock>
    </>
  )
}

/** Delete the term, at the end of its general settings. */
export function TermDangerSection({ scope }: SettingsSectionProps) {
  const termId = scope?.kind === 'term' ? scope.termId : ''
  const term = useQuery(academicsTermGetOptions({ path: { term_id: termId } }))
  return <AsyncBoundary query={term}>{(t) => <TermDanger key={t.id} term={t} />}</AsyncBoundary>
}

function TermDanger({ term }: { term: Term }) {
  const [deleting, setDeleting] = useState(false)
  return (
    <>
      <DangerZone>
        <SettingRow
          label={m.academics_term_delete()}
          description={m.academics_term_delete_description()}
        >
          <Button variant="destructive" onClick={() => setDeleting(true)}>
            {m.common_delete()}
          </Button>
        </SettingRow>
      </DangerZone>
      <DeleteTermDialog term={term} open={deleting} onOpenChange={setDeleting} />
    </>
  )
}
