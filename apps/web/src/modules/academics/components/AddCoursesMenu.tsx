import { PencilLine, Repeat } from 'lucide-react'
import type { ReactElement } from 'react'
import { ImportSourceItems } from '@/components/ImportSourceItems'
import { m } from '@/paraglide/messages'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { openAddCourses, useAddCourseOptions } from '../add-courses'

/**
 * Every "Add course" of a term opens this menu: enter courses by hand, continue a year-long
 * course of the previous term, or read them in from existing material. `trigger` is the button
 * it hangs off (a header button, a table's foot row, an empty state's button).
 */
export function AddCoursesMenu({
  programId,
  termId,
  trigger,
  align = 'start',
}: {
  programId: string
  termId: string
  trigger: ReactElement
  align?: 'start' | 'center' | 'end'
}) {
  const { candidates, sources, continueCourse, importFrom } = useAddCourseOptions(programId, termId)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align={align} className="w-72">
        <DropdownMenuItem onClick={() => openAddCourses(programId, termId)}>
          <PencilLine aria-hidden />
          <span className="min-w-0">
            <span className="block">{m.academics_course_add_manual()}</span>
            <span className="block text-xs text-muted-foreground">
              {m.academics_course_add_manual_description()}
            </span>
          </span>
        </DropdownMenuItem>
        {candidates.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{m.academics_course_add_continue()}</DropdownMenuLabel>
              {candidates.map((course) => (
                <DropdownMenuItem key={course.id} onClick={() => void continueCourse(course)}>
                  <Repeat aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate">{course.code || course.title}</span>
                    {course.code ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {course.title}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
        {sources.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <ImportSourceItems
              sources={sources}
              onPick={(source) => void importFrom(source)}
              titleProps={{ programId }}
            />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
