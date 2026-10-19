import { lmsImportSyllabus } from '@semestra/api-client'
import { lmsSyllabusGetOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { useState } from 'react'
import { AiAction } from '@/components/AiAction'
import { AiRequired } from '@/components/AiRequired'
import { SafeHtml } from '@/components/SafeHtml'
import { errorMessage } from '@/lib/errors'
import { openImport } from '@/modules/imports/launcher'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { OpenInCanvas, useInternalLinks } from './common'

/**
 * "Smart import" of the Canvas syllabus (M09 `lms.import.syllabus`): an AI extraction of the
 * grading scheme and dates, reviewed in the import dialog (M08).
 */
export function SyllabusImportButton() {
  const { programId, courseId } = useCanvasPage()
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const start = () => {
    setState('running')
    lmsImportSyllabus({ path: { course_id: courseId }, throwOnError: true })
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
  const { courseId, query } = useCanvasPage()
  const onLink = useInternalLinks()
  const syllabus = useQuery({
    ...lmsSyllabusGetOptions({ path: { course_id: courseId }, query }),
    placeholderData: keepPreviousData,
  })
  return (
    <CanvasBoundary query={syllabus}>
      {(data) => (
        <article className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-lg font-semibold">{m.canvas_tab_syllabus()}</h2>
            <div className="flex items-center gap-2">
              {data.html ? <SyllabusImportButton /> : null}
              {data.web_url ? <OpenInCanvas href={data.web_url} /> : null}
            </div>
          </div>
          {data.html ? (
            <SafeHtml html={data.html} onInternalLink={onLink} />
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
