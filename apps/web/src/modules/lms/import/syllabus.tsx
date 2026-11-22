import { lmsSyllabusImport } from '@semestra/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import { useState } from 'react'
import { invalidateOperations } from '@/app/api'
import { AiAction } from '@/components/AiAction'
import { AiRequired } from '@/components/AiRequired'
import { toastError } from '@/lib/errors'
import { openImport } from '@/modules/imports/launcher'
import { useImportState } from '@/modules/imports/state'
import { sessionRequest, useUnfinishedImport } from '@/modules/imports/unfinished'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Spinner } from '@/ui/spinner'
import { syllabusImportKey } from './keys'

/** Reads the course's syllabus on the platform into a new import: its session id. */
export async function startSyllabusImport(courseId: string): Promise<string> {
  const { data } = await lmsSyllabusImport({ path: { course_id: courseId }, throwOnError: true })
  return data.session_id
}

/**
 * "Smart import" next to a syllabus shown from the platform (the Canvas tab): the grading scheme
 * and dates read from it, reviewed in the import dialog (M08). The button follows the course's
 * unfinished syllabus import on the server, the one the gradebook's "Add" menu starts too: while
 * it is read it shows how far, once read "To review", and either opens the dialog where it
 * stands. Nothing opens by itself when the reading ends.
 */
export function SyllabusImportButton({
  programId,
  courseId,
}: {
  programId: string
  courseId: string
}) {
  const queryClient = useQueryClient()
  const waiting = useUnfinishedImport(programId, syllabusImportKey(courseId))
  const state = useImportState(waiting)
  const [starting, setStarting] = useState(false)
  const start = () => {
    setStarting(true)
    startSyllabusImport(courseId)
      .then((sessionId) => {
        void invalidateOperations(queryClient, ['importsSessionList'])
        // The user asked for it just now: the dialog shows it being read.
        void openImport({
          programId,
          mode: 'direct',
          source: 'session',
          sessionId,
          title: m.lms_syllabus_import,
        })
      })
      .catch(toastError)
      .finally(() => setStarting(false))
  }
  if (waiting && state) {
    const review = () =>
      void openImport({ ...sessionRequest(waiting), title: m.lms_syllabus_import })
    return state.reading || state.failed ? (
      <Button variant="outline" onClick={review}>
        {state.failed ? (
          <CircleAlert aria-hidden className="text-destructive" />
        ) : (
          <Spinner aria-hidden />
        )}
        {state.text}
      </Button>
    ) : (
      <Button onClick={review}>{state.text}</Button>
    )
  }
  return (
    <AiRequired purpose="extraction">
      <AiAction
        state={starting ? 'running' : 'idle'}
        label={m.lms_syllabus_import()}
        onClick={start}
      />
    </AiRequired>
  )
}
