import {
  academicsCourseListOptions,
  academicsTermListOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { CalendarRange } from 'lucide-react'
import type { CommandChild, NavigationSourceContribution } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { courseColor, courseLabel } from './color'
import { coursePath, termPath } from './paths'

const STALE = 30_000

/** The terms and courses of the Program on screen, for the palette's "Navigation" group. */
export const academicsNavigation: NavigationSourceContribution = {
  id: 'academics',
  useItems(ctx) {
    const programId = ctx.programId ?? ''
    const terms = useQuery({
      ...academicsTermListOptions({ path: { program_id: programId } }),
      enabled: programId !== '',
      staleTime: STALE,
    }).data?.items
    const courses = useQuery({
      ...academicsCourseListOptions({ path: { program_id: programId }, query: { limit: 500 } }),
      enabled: programId !== '',
      staleTime: STALE,
    }).data?.items
    if (!programId) return []
    const items: CommandChild[] = (terms ?? []).map((term) => ({
      id: `term:${term.id}`,
      title: term.name,
      subtitle: m.academics_command_term(),
      icon: CalendarRange,
      to: termPath(programId, term.id),
    }))
    for (const course of courses ?? []) {
      const label = courseLabel(course)
      items.push({
        id: `course:${course.id}`,
        title: label,
        subtitle: label === course.title ? (course.code ?? undefined) : course.title,
        keywords: [course.code, course.title, course.alias].filter((k): k is string => !!k),
        dot: courseColor(course),
        to: coursePath(programId, course.id),
      })
    }
    return items
  },
}
