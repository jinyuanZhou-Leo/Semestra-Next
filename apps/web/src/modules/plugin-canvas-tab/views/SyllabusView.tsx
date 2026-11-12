import { lmsSyllabusImport } from '@semestra/api-client'
import { lmsSyllabusGetOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { useState } from 'react'
import { AiAction } from '@/components/AiAction'
import { AiRequired } from '@/components/AiRequired'
import { errorMessage } from '@/lib/errors'
import { openImport } from '@/modules/imports/launcher'
import { lmsPersister } from '@/modules/lms/persist'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { CanvasHtml, ViewHeader } from './common'

/**
 * "Smart import" of the Canvas syllabus (M09 `lms.syllabus.import`): an AI extraction of the
 * grading scheme and dates, reviewed in the import dialog (M08).
 */
export function SyllabusImportButton() {
  const { programId, courseId } = useCanvasPage()
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const start = () => {
    setState('running')
    lmsSyllabusImport({ path: { course_id: courseId }, throwOnError: true })
      .then(({ data }) => {
        setState('idle')
        return openImport({
          programId,
          mode: 'direct',
          source: 'session',
          sessionId: data.session_id,
          title: m.canvas_tab_syllabus_import,
        })
      })
      .catch((err: unknown) => {
        setError(errorMessage(err))
        setState('error')
      })
  }
  return (
    <AiRequired purpose="extraction">
      <AiAction
        state={state}
        label={m.canvas_tab_syllabus_import()}
        error={error}
        onClick={start}
      />
    </AiRequired>
  )
}

export function SyllabusView() {
  const { courseId, title } = useCanvasPage()
  const syllabus = useQuery({
    ...lmsSyllabusGetOptions({ path: { course_id: courseId } }),
    persister: lmsPersister,
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
