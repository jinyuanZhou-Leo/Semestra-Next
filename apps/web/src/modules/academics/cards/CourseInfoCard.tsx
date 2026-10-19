import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
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

/** A course's basic facts (M02 §5.5): code, title, instructors, credits, terms, website. */
export default function CourseInfoCard({ scope }: CardProps) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const course = useCourse(courseId).data
  const terms = useTerms(scope.programId).data?.items ?? []
  const extraRows = useExtensions<CourseInfoRow>(COURSE_INFO_ROWS).toSorted(
    (a, b) => a.order - b.order,
  )
  if (!course) return null
  const termNames = course.term_ids
    .map((id) => terms.find((t) => t.id === id)?.name)
    .filter(Boolean)
    .join(' → ')
  return (
    <div className="h-full overflow-y-auto text-sm">
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
        {course.website_url && /^https?:\/\//i.test(course.website_url) ? (
          <Row label={m.academics_course_website()}>
            <a
              href={course.website_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 text-primary hover:underline"
            >
              <span className="truncate">{course.website_url.replace(/^https?:\/\//, '')}</span>
              <ExternalLink aria-hidden className="size-3 shrink-0" />
            </a>
          </Row>
        ) : null}
        {extraRows.map((row) => (
          <row.component key={row.id} programId={scope.programId} courseId={course.id} Row={Row} />
        ))}
      </dl>
      {course.description ? (
        <p className="mt-2 whitespace-pre-line text-muted-foreground">{course.description}</p>
      ) : null}
    </div>
  )
}
