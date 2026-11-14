import { lmsSyllabusImport } from '@semestra/api-client'
import { lmsSyllabusGetOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, ScrollText } from 'lucide-react'
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
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Spinner } from '@/ui/spinner'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { CanvasHtml, ViewHeader } from './common'

/**
 * "Smart import" of the Canvas syllabus (M09 `lms.syllabus.import`): the grading scheme and dates
 * read from it, reviewed in the import dialog (M08). The button follows the course's unfinished
 * syllabus import on the server: while it is read it shows how far, once read "To review", and
 * either opens the dialog where it stands. Nothing opens by itself when the reading ends.
 */
export function SyllabusImportButton() {
  const { programId, courseId } = useCanvasPage()
  const queryClient = useQueryClient()
  const waiting = useUnfinishedImport(programId, {
    source: 'text',
    target: { kind: 'course', course_id: courseId },
    lms: 'syllabus',
  })
  const state = useImportState(waiting)
  const [starting, setStarting] = useState(false)
  const open = (sessionId: string) =>
    openImport({
      programId,
      mode: 'direct',
      source: 'session',
      sessionId,
      title: m.canvas_tab_syllabus_import,
    })
  const start = () => {
    setStarting(true)
    lmsSyllabusImport({ path: { course_id: courseId }, throwOnError: true })
      .then(({ data }) => {
        void invalidateOperations(queryClient, ['importsSessionList'])
        // The user asked for it just now: the dialog shows it being read.
        void open(data.session_id)
      })
      .catch(toastError)
      .finally(() => setStarting(false))
  }
  if (waiting && state) {
    const review = () =>
      void openImport({ ...sessionRequest(waiting), title: m.canvas_tab_syllabus_import })
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
        label={m.canvas_tab_syllabus_import()}
        onClick={start}
      />
    </AiRequired>
  )
}

export function SyllabusView() {
  const { courseId, title } = useCanvasPage()
  const syllabus = useQuery({
    ...lmsSyllabusGetOptions({ path: { course_id: courseId } }),
    placeholderData: keepPreviousData,
  })
  return (
    <CanvasBoundary query={syllabus}>
      {(data) => (
        <article className="flex flex-1 flex-col gap-4">
          <ViewHeader
            title={title}
            withDisplay={Boolean(data.html)}
            webUrl={data.web_url}
            primary={data.html ? <SyllabusImportButton /> : null}
          />
          {data.html ? (
            <CanvasHtml html={data.html} />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ScrollText aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{m.canvas_tab_syllabus_empty()}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </article>
      )}
    </CanvasBoundary>
  )
}
