import { academicsTermGetWeeksOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import type { Scope } from '@/app/extensions'
import { PluginBoundary } from '@/app/host/PluginBoundary'
import { ScopePage } from '@/app/host/ScopePage'
import { usePages } from '@/app/registry'
import { SearchX } from 'lucide-react'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { formatDate } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { courseTermId, useCourse, useCourses, useProgram, useTerms } from '../queries'
import { useCourseSwitchHotkey } from './hotkeys'
import { ScopeHeader } from './ScopeHeader'

const OVERVIEW = 'overview'

/** A term or course that does not exist (any more) or is not in this Program. */
export function NotFound() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{m.academics_not_found()}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  )
}

export function ProgramView({
  programId,
  pageId = OVERVIEW,
}: {
  programId: string
  pageId?: string
}) {
  const program = useProgram(programId)
  const terms = useTerms(programId)
  const scope: Scope = { kind: 'program', programId }
  const page = usePages(scope).find((candidate) => candidate.id === pageId)
  const Subtitle = page?.headerSubtitle
  return (
    <AsyncBoundary query={program}>
      {(p) => (
        <>
          <ScopeHeader
            scope={scope}
            activePageId={pageId}
            program={p}
            terms={terms.data?.items ?? []}
            title={page?.title()}
            subtitle={
              Subtitle ? (
                <PluginBoundary key={`${pageId}:${programId}`} silent>
                  <Subtitle scope={scope} />
                </PluginBoundary>
              ) : (
                [
                  p.institution,
                  m.academics_term_count({ count: p.term_count }),
                  m.academics_course_count({ count: p.course_count }),
                ]
                  .filter(Boolean)
                  .join(' · ')
              )
            }
          />
          <div className="p-6">
            <ScopePage scope={scope} pageId={pageId} />
          </div>
        </>
      )}
    </AsyncBoundary>
  )
}

export function TermWeekLine({ termId }: { termId: string }) {
  const info = useQuery(academicsTermGetWeeksOptions({ path: { term_id: termId } })).data
  if (!info) return null
  // `today_week` is already limited to the term's own dates (its first and last weeks reach past them).
  const week = info.today_week == null ? undefined : info.weeks[info.today_week]
  if (week?.break_info && week.number == null) return <> · {week.break_info.name}</>
  if (week?.number == null) return null
  return <> · {m.academics_week_number({ number: week.number })}</>
}

export function TermView({
  programId,
  termId,
  pageId = OVERVIEW,
}: {
  programId: string
  termId: string
  pageId?: string
}) {
  const program = useProgram(programId)
  const terms = useTerms(programId)
  const scope: Scope = { kind: 'term', programId, termId }
  return (
    <AsyncBoundary query={program}>
      {(p) => (
        <AsyncBoundary query={terms}>
          {(list) => {
            const term = list.items.find((t) => t.id === termId)
            if (!term) return <NotFound />
            return (
              <>
                <ScopeHeader
                  scope={scope}
                  activePageId={pageId}
                  program={p}
                  terms={list.items}
                  term={term}
                  subtitle={
                    <>
                      {formatDate(`${term.start_date}T00:00`)} –{' '}
                      {formatDate(`${term.end_date}T00:00`)}
                      {term.is_current ? <TermWeekLine termId={term.id} /> : null}
                    </>
                  }
                />
                <div className="p-6">
                  <ScopePage scope={scope} pageId={pageId} />
                </div>
              </>
            )
          }}
        </AsyncBoundary>
      )}
    </AsyncBoundary>
  )
}

export function CourseView({
  programId,
  courseId,
  pageId = OVERVIEW,
  fromTerm,
}: {
  programId: string
  courseId: string
  pageId?: string
  fromTerm?: string
}) {
  const program = useProgram(programId)
  const terms = useTerms(programId)
  const course = useCourse(courseId)
  const termId = course.data ? courseTermId(course.data, terms.data?.items, fromTerm) : undefined
  const termCourses = useCourses(programId, termId).data?.items ?? []
  useCourseSwitchHotkey({
    programId,
    courseId,
    termId,
    pageId,
    courses: termId ? termCourses : [],
  })
  const scope: Scope = { kind: 'course', programId, courseId }
  return (
    <AsyncBoundary query={program}>
      {(p) => (
        <AsyncBoundary query={course}>
          {(c) => {
            if (c.program_id !== programId) return <NotFound />
            const list = terms.data?.items ?? []
            return (
              <>
                <ScopeHeader
                  scope={scope}
                  activePageId={pageId}
                  program={p}
                  terms={list}
                  term={list.find((t) => t.id === termId)}
                  course={c}
                  termCourses={termCourses}
                  subtitle={c.code && c.title !== c.code ? c.title : undefined}
                />
                <div className="p-6">
                  <ScopePage scope={scope} pageId={pageId} />
                </div>
              </>
            )
          }}
        </AsyncBoundary>
      )}
    </AsyncBoundary>
  )
}
