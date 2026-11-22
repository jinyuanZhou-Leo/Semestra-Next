import { lmsSyllabusGetOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { LmsHtml, ViewHeader } from '@/modules/lms/content/LmsContent'
import { SyllabusImportButton } from '@/modules/lms/import/syllabus'

export function SyllabusView() {
  const { programId, courseId, title } = useCanvasPage()
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
            primary={
              data.html ? <SyllabusImportButton programId={programId} courseId={courseId} /> : null
            }
          />
          {data.html ? (
            <LmsHtml html={data.html} />
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
