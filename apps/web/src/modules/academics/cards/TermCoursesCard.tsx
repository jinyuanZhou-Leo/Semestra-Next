import { Plus, Repeat } from 'lucide-react'
import { useState } from 'react'
import type { CardProps } from '@/app/extensions'
import { useExtensions } from '@/app/registry'
import { HistoryLink } from '@/components/HistoryLink'
import { formatCredits } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { courseColor } from '../color'
import { AddCourseDialog } from '../components/AddCourseDialog'
import { coursePath } from '../paths'
import { useColumnData, useCourses } from '../queries'
import { COURSE_COLUMNS, type CourseColumn } from '../types'

/** The term's courses with their credits and any extra columns marked `showInTermCard` (M02 §5.4). */
export default function TermCoursesCard({ scope }: CardProps) {
  const termId = scope.kind === 'term' ? scope.termId : undefined
  const programId = scope.programId
  const courses = useCourses(programId, termId).data?.items
  const extra = useExtensions<CourseColumn>(COURSE_COLUMNS).filter((c) => c.showInTermCard)
  const columnData = useColumnData(extra, programId)
  const [adding, setAdding] = useState(false)
  if (!termId) return null
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {courses && courses.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {m.academics_term_no_courses()}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sr-only">
              <tr>
                <th>{m.academics_course_code()}</th>
                <th>{m.academics_course_title()}</th>
                {extra.map((column) => (
                  <th key={column.id}>{column.header()}</th>
                ))}
                <th>{m.academics_course_credits()}</th>
              </tr>
            </thead>
            <tbody>
              {(courses ?? []).map((course) => (
                <tr
                  key={course.id}
                  className="border-b border-border last:border-0 hover:bg-muted/50"
                >
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <HistoryLink
                      href={coursePath(programId, course.id, undefined, termId)}
                      className="flex items-center gap-2 font-medium hover:underline"
                    >
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: courseColor(course) }}
                      />
                      {course.code || course.alias || course.title}
                      {course.term_ids.length > 1 ? (
                        <Repeat
                          aria-label={m.academics_course_year_long()}
                          className="size-3 text-muted-foreground"
                        />
                      ) : null}
                    </HistoryLink>
                  </td>
                  <td className="w-full max-w-0 truncate py-2 pr-3 text-muted-foreground">
                    {course.code ? course.title : null}
                  </td>
                  {extra.map((column) => (
                    <td key={column.id} className="py-2 pr-3 whitespace-nowrap">
                      {column.cell(course, columnData.get(column.id))}
                    </td>
                  ))}
                  <td className="py-2 text-right whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatCredits(course.credits)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div>
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          {m.academics_course_add()}
        </Button>
      </div>
      <AddCourseDialog
        programId={programId}
        termId={termId}
        open={adding}
        onOpenChange={setAdding}
      />
    </div>
  )
}
