import { importsSessionGet, lmsCourseImport, type ImportSessionDetail } from '@semestra/api-client'
import { lmsCourseListOptions, lmsProgramBindingGetOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useSettingsDialog } from '@/app/settings/use-settings-dialog'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { AiAction } from '@/components/AiAction'
import { errorMessage } from '@/lib/errors'
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
import { Switch } from '@/ui/switch'
import { externalLabel, groupByTerm } from '../external'
import { useProviderName } from '../providers'

/** Where the imported courses go: a term, or the term the wizard is about to create. */
export type CourseImportTarget =
  | { termId: string }
  | { wizard: true; startDate?: string; endDate?: string }

export async function startedSession(sessionId: string): Promise<ImportSessionDetail> {
  const { data } = await importsSessionGet({ path: { session_id: sessionId }, throwOnError: true })
  return data
}

/** A Program without a connection cannot import or link; this says where to choose one. */
export function ProgramUnbound() {
  const settings = useSettingsDialog()
  return (
    <Empty className="min-h-0 flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Link2 aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{m.lms_course_program_unbound()}</EmptyTitle>
        <EmptyDescription>{m.lms_course_program_unbound_hint()}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          size="sm"
          onClick={() => settings.open({ level: 'program', group: 'integrations' })}
        >
          {m.lms_course_open_program_settings()}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

/**
 * "Import courses from {provider}" (M09 §7.2): tick the platform's courses (this term's by
 * default), then the M08 review; committing creates the courses and their links together.
 */
export function CoursePicker({
  programId,
  target,
  onStarted,
}: {
  programId: string
  target: CourseImportTarget
  onStarted: (session: ImportSessionDetail) => void
}) {
  const binding = useQuery(lmsProgramBindingGetOptions({ path: { program_id: programId } }))
  return (
    <AsyncBoundary query={binding}>
      {(data) =>
        data.connection_id ? (
          <CourseList programId={programId} target={target} onStarted={onStarted} />
        ) : (
          <ProgramUnbound />
        )
      }
    </AsyncBoundary>
  )
}

function CourseList({
  programId,
  target,
  onStarted,
}: {
  programId: string
  target: CourseImportTarget
  onStarted: (session: ImportSessionDetail) => void
}) {
  const id = useId()
  const [past, setPast] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const courses = useQuery({
    ...lmsCourseListOptions({ path: { program_id: programId }, query: { include_past: past } }),
    placeholderData: keepPreviousData,
  })
  const provider = useProviderName(courses.data?.provider) ?? m.lms_name()

  const start = () => {
    setStarting(true)
    setStartError(null)
    const body =
      'termId' in target
        ? { external_course_ids: [...picked], term_id: target.termId }
        : {
            external_course_ids: [...picked],
            term_wizard: true,
            start_date: target.startDate ?? null,
            end_date: target.endDate ?? null,
          }
    lmsCourseImport({ path: { program_id: programId }, body, throwOnError: true })
      .then(({ data }) => startedSession(data.session_id))
      .then(onStarted, (error: unknown) => {
        setStartError(errorMessage(error))
        setStarting(false)
      })
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        <Field orientation="horizontal" className="w-fit">
          <Switch id={`${id}-past`} checked={past} onCheckedChange={setPast} />
          <FieldLabel htmlFor={`${id}-past`} className="font-normal">
            {m.lms_show_past()}
          </FieldLabel>
        </Field>
        <AsyncBoundary
          query={courses}
          isEmpty={(data) => data.items.length === 0}
          empty={
            <Empty className="border-0 p-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Link2 aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{m.lms_courses_empty({ provider })}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          }
        >
          {(data) =>
            groupByTerm(data.items).map((group) => (
              <section key={group.term} aria-label={group.term} className="space-y-1">
                <h3 className="text-xs font-medium text-muted-foreground">{group.term}</h3>
                <ul>
                  {group.courses.map((course) => {
                    const box = `${id}-${course.external_id}`
                    const linked = Boolean(course.linked_course_id)
                    return (
                      <li key={course.external_id}>
                        <Field
                          orientation="horizontal"
                          data-disabled={linked || undefined}
                          className="rounded-xl px-2 py-1.5 hover:bg-muted/50"
                        >
                          <Checkbox
                            id={box}
                            disabled={linked}
                            checked={picked.has(course.external_id)}
                            onCheckedChange={(on) =>
                              setPicked((current) => {
                                const next = new Set(current)
                                if (on) next.add(course.external_id)
                                else next.delete(course.external_id)
                                return next
                              })
                            }
                          />
                          <FieldLabel htmlFor={box} className="min-w-0 flex-1 font-normal">
                            <span className="truncate">{externalLabel(course)}</span>
                            {linked ? (
                              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                {m.lms_course_linked_to({
                                  course: course.linked_course_name ?? '',
                                })}
                              </span>
                            ) : null}
                          </FieldLabel>
                        </Field>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))
          }
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
