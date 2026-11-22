import type { ImportSessionDetail } from '@semestra/api-client'
import { lmsCourseLinkGetOptions, lmsSyllabusGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Link2, ScrollText } from 'lucide-react'
import { useState } from 'react'
import { useSettingsDialog } from '@/app/settings/use-settings-dialog'
import { AiGate, useAiGate } from '@/components/AiRequired'
import { AiAction } from '@/components/AiAction'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { errorMessage } from '@/lib/errors'
import { FooterError } from '@/modules/imports/components/FooterError'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { DialogFooter } from '@/ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { ProgramUnbound, startedSession } from './CoursePicker'
import { useProviderName } from '../providers'
import { startSyllabusImport } from './syllabus'

/**
 * The gradebook's "{provider} syllabus" (M09 §7.2): the syllabus of the course on its platform
 * is read for the grading scheme and dates, which the import review lists before anything is
 * written. Shown in the import dialog, so a course that isn't linked, or an app without a model
 * for reading, says what to do first.
 */
export function SyllabusPicker({
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
          <Linked courseId={courseId} kind={data.link.provider} onStarted={onStarted} />
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
              <Button size="sm" onClick={() => settings.open({ level: 'course', group: 'lms' })}>
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

/**
 * A linked course: its syllabus as the Canvas tab shows it (the same read, usually cached). With
 * nothing on the platform there is nothing to read, so no start, as in the Canvas tab.
 */
function Linked({
  courseId,
  kind,
  onStarted,
}: {
  courseId: string
  kind: string
  onStarted: (session: ImportSessionDetail) => void
}) {
  const provider = useProviderName(kind) ?? kind
  const syllabus = useQuery(lmsSyllabusGetOptions({ path: { course_id: courseId } }))
  return (
    <AsyncBoundary query={syllabus}>
      {(data) =>
        data.html ? (
          <Start courseId={courseId} kind={kind} onStarted={onStarted} />
        ) : (
          <Empty className="min-h-0 flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ScrollText aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.lms_syllabus_empty({ provider })}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )
      }
    </AsyncBoundary>
  )
}

function Start({
  courseId,
  kind,
  onStarted,
}: {
  courseId: string
  kind: string
  onStarted: (session: ImportSessionDetail) => void
}) {
  const provider = useProviderName(kind) ?? kind
  // Without a model that can read it, the gate says what to set up, and nothing starts.
  const blocked = useAiGate('extraction')?.blocking ?? false
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const start = () => {
    setStarting(true)
    setStartError(null)
    startSyllabusImport(courseId)
      .then(startedSession)
      .then(onStarted, (error: unknown) => {
        setStartError(errorMessage(error))
        setStarting(false)
      })
  }
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <AiGate purpose="extraction">
          <Empty className="min-h-0 flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ScrollText aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.lms_import_syllabus_from({ provider })}</EmptyTitle>
              <EmptyDescription>{m.lms_import_syllabus_start_hint({ provider })}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </AiGate>
      </div>
      <DialogFooter className="items-center">
        {startError ? <FooterError text={startError} /> : null}
        <AiAction
          state={starting ? 'running' : startError ? 'error' : 'idle'}
          label={m.lms_syllabus_read()}
          icon={ArrowRight}
          disabled={blocked}
          className="w-60"
          onClick={start}
        />
      </DialogFooter>
    </>
  )
}
