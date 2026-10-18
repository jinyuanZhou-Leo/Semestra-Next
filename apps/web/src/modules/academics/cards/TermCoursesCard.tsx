import { Plus, Repeat } from 'lucide-react'
import { useState } from 'react'
import type { CardProps } from '@/app/extensions'
import { useExtensions } from '@/app/registry'
import { HistoryLink } from '@/components/HistoryLink'
import { formatCredits } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
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
          <Table>
            <TableHeader className="sr-only">
              <TableRow>
                <TableHead>{m.academics_course_code()}</TableHead>
                <TableHead>{m.academics_course_title()}</TableHead>
                {extra.map((column) => (
                  <TableHead key={column.id}>{column.header()}</TableHead>
                ))}
                <TableHead>{m.academics_course_credits()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(courses ?? []).map((course) => (
                <TableRow key={course.id}>
                  <TableCell className="py-2 pr-3 pl-0">
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
                  </TableCell>
                  <TableCell className="w-full max-w-0 truncate py-2 pr-3 pl-0 text-muted-foreground">
                    {course.code ? course.title : null}
                  </TableCell>
                  {extra.map((column) => (
                    <TableCell key={column.id} className="py-2 pr-3 pl-0 whitespace-nowrap">
                      {column.cell(course, columnData.get(column.id))}
                    </TableCell>
                  ))}
                  <TableCell className="px-0 py-2 text-right text-muted-foreground tabular-nums">
                    {formatCredits(course.credits)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
