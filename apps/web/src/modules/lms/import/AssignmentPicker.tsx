import type { ImportSessionDetail } from '@semestra/api-client'
import { lmsAssignmentListOptions, lmsCourseLinkGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Link2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useSettingsDialog } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { AiAction } from '@/components/AiAction'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { DialogFooter } from '@/ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { Field, FieldLabel } from '@/ui/field'
import { Label } from '@/ui/label'
import { ChoiceControl } from '@/app/settings/choice'
import { type AssignmentImportKind, startAssignmentImport } from './assignments'
import { ProgramUnbound, startedSession } from './CoursePicker'
import { useProviderName } from '../providers'

type Kind = AssignmentImportKind

/**
 * "Import assignments from LMS" (M09 §7.2): tick assignments, choose whether they start as
 * assessments or tasks, then the M08 review, where each item can still switch.
 */
export function AssignmentPicker({
  courseId,
  onStarted,
}: {
  courseId: string
  onStarted: (session: ImportSessionDetail) => void
}) {
  const settings = useSettingsDialog()
  const state = useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } }))
  return (
    <AsyncBoundary query={state}>
      {(data) =>
        data.link ? (
          <AssignmentList courseId={courseId} kind={data.link.provider} onStarted={onStarted} />
        ) : data.program_connection_id ? (
          <Empty className="min-h-0 flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Link2 aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.lms_course_not_linked()}</EmptyTitle>
              <EmptyDescription>{m.lms_course_not_linked_hint()}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                size="sm"
                onClick={() => settings.open({ level: 'course', group: 'integrations' })}
              >
                {m.lms_course_open_settings()}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <ProgramUnbound />
        )
      }
    </AsyncBoundary>
  )
}

function AssignmentList({
  courseId,
  kind: providerKind,
  onStarted,
}: {
  courseId: string
  kind: string
  onStarted: (session: ImportSessionDetail) => void
}) {
  const id = useId()
  const [kind, setKind] = useState<Kind>('assessment')
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const assignments = useQuery(lmsAssignmentListOptions({ path: { course_id: courseId } }))
  const provider = useProviderName(providerKind) ?? providerKind

  const start = () => {
    setStarting(true)
    setStartError(null)
    startAssignmentImport(courseId, [...picked], kind)
      .then(startedSession)
      .then(onStarted, (error: unknown) => {
        setStartError(errorMessage(error))
        setStarting(false)
      })
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <Label id={`${id}-kind`}>{m.lms_import_as()}</Label>
        <ChoiceControl<Kind>
          labelId={`${id}-kind`}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'assessment', label: m.imports_type_assessment() },
            { value: 'task', label: m.imports_type_task() },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AsyncBoundary
          query={assignments}
          isEmpty={(data) => data.items.length === 0}
          empty={
            <Empty className="border-0 p-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ClipboardList aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{m.lms_assignments_empty({ provider })}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          }
        >
          {(data) => (
            <ul>
              {data.items.map((a) => {
                const box = `${id}-${a.external_id}`
                const imported = a.imported_as.length > 0
                const detail = [
                  a.group_name,
                  a.due_at ? formatDateTime(a.due_at) : m.lms_no_due_date(),
                  a.points != null ? m.lms_points({ points: a.points }) : null,
                ].filter(Boolean)
                return (
                  <li key={a.external_id}>
                    <Field
                      orientation="horizontal"
                      data-disabled={imported || undefined}
                      className="rounded-xl px-2 py-1.5 hover:bg-muted/50"
                    >
                      <Checkbox
                        id={box}
                        disabled={imported}
                        checked={picked.has(a.external_id)}
                        onCheckedChange={(on) =>
                          setPicked((current) => {
                            const next = new Set(current)
                            if (on) next.add(a.external_id)
                            else next.delete(a.external_id)
                            return next
                          })
                        }
                      />
                      <FieldLabel htmlFor={box} className="min-w-0 flex-1 font-normal">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{a.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {detail.join(' · ')}
                          </span>
                        </span>
                        {imported ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {m.lms_imported()}
                          </span>
                        ) : null}
                      </FieldLabel>
                    </Field>
                  </li>
                )
              })}
            </ul>
          )}
        </AsyncBoundary>
      </div>
      <DialogFooter>
        <AiAction
          state={starting ? 'running' : startError ? 'error' : 'idle'}
          label={m.lms_import_review({ count: picked.size })}
          error={startError}
          disabled={picked.size === 0}
          className="w-56"
          onClick={start}
        />
      </DialogFooter>
    </>
  )
}
