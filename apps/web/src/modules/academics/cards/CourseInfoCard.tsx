import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { useExtensions } from '@/app/registry'
import { formatCredits } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { useCourse, useTerms } from '../queries'
import { COURSE_INFO_ROWS, type CourseInfoRow } from '../types'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

/** At m: label above value, in columns, so the facts fit one row of the board without scrolling. */
function CompactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  )
}

/**
 * A course's basic facts (M02 §5.5): code, title, instructors, credits, terms, website. At m the
 * page header already names the course, so the card leaves out code, title and description.
 */
export default function CourseInfoCard({ scope, size }: CardProps) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const course = useCourse(courseId).data
  const terms = useTerms(scope.programId).data?.items ?? []
  const extraRows = useExtensions<CourseInfoRow>(COURSE_INFO_ROWS).toSorted(
    (a, b) => a.order - b.order,
  )
  if (!course) return <CardSkeleton />
  const termNames = course.term_ids
    .map((id) => terms.find((t) => t.id === id)?.name)
    .filter(Boolean)
    .join(' → ')
  const website =
    course.website_url && /^https?:\/\//i.test(course.website_url) ? (
      <a
        href={course.website_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-full items-center gap-1 text-primary hover:underline"
      >
        <span className="truncate">{course.website_url.replace(/^https?:\/\//, '')}</span>
        <ExternalLink aria-hidden className="size-3 shrink-0" />
      </a>
    ) : null
  const extras = (row: typeof Row) =>
    extraRows.map((extra) => (
      <extra.component key={extra.id} programId={scope.programId} courseId={course.id} Row={row} />
    ))

  if (size === 'm') {
    const [first, ...others] = course.instructors
    return (
      <div className="@container h-full scroll-fade overflow-y-auto text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 @md:grid-cols-3">
          {first ? (
            <CompactRow label={m.academics_course_instructors()}>
              {first.name}
              {others.length > 0 ? (
                <span className="text-muted-foreground"> +{others.length}</span>
              ) : null}
            </CompactRow>
          ) : null}
          <CompactRow label={m.academics_course_credits()}>
            {formatCredits(course.credits)}
          </CompactRow>
          <CompactRow label={m.academics_course_terms()}>{termNames}</CompactRow>
          {website ? <CompactRow label={m.academics_course_website()}>{website}</CompactRow> : null}
          {extras(CompactRow)}
        </dl>
      </div>
    )
  }

  return (
    <div className="h-full scroll-fade overflow-y-auto text-sm">
      <dl>
        {course.code ? <Row label={m.academics_course_code()}>{course.code}</Row> : null}
        <Row label={m.academics_course_title()}>{course.title}</Row>
        {course.instructors.length > 0 ? (
          <Row label={m.academics_course_instructors()}>
            <ul>
              {course.instructors.map((person) => (
                <li key={`${person.name}:${person.email ?? ''}`}>
                  {person.email ? (
                    <a href={`mailto:${person.email}`} className="hover:underline">
                      {person.name}
                    </a>
                  ) : (
                    person.name
                  )}
                  {person.role ? (
                    <span className="text-muted-foreground"> · {person.role}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Row>
        ) : null}
        <Row label={m.academics_course_credits()}>{formatCredits(course.credits)}</Row>
        <Row label={m.academics_course_terms()}>{termNames}</Row>
        {website ? <Row label={m.academics_course_website()}>{website}</Row> : null}
        {extras(Row)}
      </dl>
      {course.description ? (
        <p className="mt-2 whitespace-pre-line text-muted-foreground">{course.description}</p>
      ) : null}
    </div>
  )
}
