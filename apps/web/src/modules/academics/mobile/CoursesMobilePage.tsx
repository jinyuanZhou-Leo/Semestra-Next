import { Link } from '@tanstack/react-router'
import { BookOpen, ChevronRight } from 'lucide-react'
import type { PageProps } from '@/app/extensions'
import { MobileList, MobilePage, MobileSection } from '@/app/mobile/MobilePage'
import { PluginBoundary } from '@/app/host/PluginBoundary'
import { useExtensions } from '@/app/registry'
import { m } from '@/paraglide/messages'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { NativeSelect, NativeSelectOption } from '@/ui/native-select'
import { Skeleton } from '@/ui/skeleton'
import { courseColor } from '../color'
import { useCurrentTerm } from '../current-term'
import { useColumnData, useCourses, useTerms } from '../queries'
import {
  COURSE_COLUMNS,
  type CourseColumn,
  MOBILE_COURSE_SECTIONS,
  type MobileCourseSection,
} from '../types'

/**
 * The courses tab on a phone (M17 §4.1): the sections other modules put on top (the grade
 * summary, the LMS sync's open questions), then the term's courses, each opening the course. The
 * term is the one the desktop's "Terms & courses" has in effect; the picker on the right changes it.
 */
export default function CoursesMobilePage({ scope }: PageProps) {
  const { programId } = scope
  const terms = useTerms(programId).data?.items
  const { term, setCurrentTerm } = useCurrentTerm(programId)
  const sections = useExtensions<MobileCourseSection>(MOBILE_COURSE_SECTIONS).toSorted(
    (a, b) => a.order - b.order,
  )
  return (
    <MobilePage
      title={m.mobile_courses()}
      subtitle={term?.name}
      action={
        terms && terms.length > 1 && term ? (
          <NativeSelect
            size="sm"
            aria-label={m.academics_terms()}
            value={term.id}
            onChange={(event) => setCurrentTerm(event.target.value)}
          >
            {terms.map((t) => (
              <NativeSelectOption key={t.id} value={t.id}>
                {t.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null
      }
    >
      {sections.map((section) => (
        <PluginBoundary key={section.id}>
          <section.component programId={programId} termId={term?.id} />
        </PluginBoundary>
      ))}
      <TermCourses programId={programId} termId={term?.id} loading={!terms} />
    </MobilePage>
  )
}

function TermCourses({
  programId,
  termId,
  loading,
}: {
  programId: string
  termId: string | undefined
  loading: boolean
}) {
  const courses = useCourses(programId, termId, { enabled: !!termId }).data?.items
  // What other modules show on the right (the grade so far).
  const columns = useExtensions<CourseColumn>(COURSE_COLUMNS).filter((c) => c.showOnPhone)
  const data = useColumnData(columns, programId)
  if (loading || (termId && !courses)) {
    return (
      <MobileSection title={m.mobile_courses_this_term()}>
        <Skeleton className="h-40 rounded-2xl" />
      </MobileSection>
    )
  }
  if (!courses || courses.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpen aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.mobile_courses_empty()}</EmptyTitle>
          <EmptyDescription>{m.mobile_courses_empty_description()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <MobileSection title={m.mobile_courses_this_term()}>
      <MobileList label={m.mobile_courses()}>
        {courses.map((course) => (
          <li key={course.id}>
            <Link
              to="/p/$programId/c/$courseId"
              params={{ programId, courseId: course.id }}
              className="flex min-h-15 items-center gap-3 px-4 py-2.5"
            >
              <span
                aria-hidden
                className="h-9 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: courseColor(course) }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {course.alias || course.code || course.title}
                </div>
                {course.alias || course.code ? (
                  <div className="truncate text-xs text-muted-foreground">{course.title}</div>
                ) : null}
              </div>
              {columns.map((column) => (
                <span key={column.id} className="shrink-0 text-sm">
                  {column.cell(course, data.get(column.id))}
                </span>
              ))}
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </MobileList>
    </MobileSection>
  )
}
