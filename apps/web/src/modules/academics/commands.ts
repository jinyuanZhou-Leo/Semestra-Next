import {
  academicsCourseListOptions,
  academicsTermListOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import { BookPlus, CalendarPlus, CalendarRange, PencilLine, Repeat } from 'lucide-react'
import type {
  CommandChild,
  CommandContribution,
  NavigationSourceContribution,
} from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { courseColor, courseLabel } from './color'
import { openAddCourses, useAddCourseOptions } from './add-courses'
import { coursePath, newTermPath, termPath } from './paths'
import { useSidebarPages } from './shell/sidebar-pages'
import { useViewedTerm } from './viewing-term'

/**
 * The palette's "Navigation" group for the Program on screen: the sidebar's pages (so a term page
 * like Calendar is there from Today too), then the terms and courses.
 */
export const academicsNavigation: NavigationSourceContribution = {
  id: 'academics',
  useItems(ctx) {
    const programId = ctx.programId ?? ''
    const pathname = useLocation({ select: (l) => l.pathname })
    const { term } = useViewedTerm(programId, pathname)
    const pages = useSidebarPages(programId, term?.id).shown
    const terms = useQuery({
      ...academicsTermListOptions({ path: { program_id: programId } }),
      enabled: programId !== '',
    }).data?.items
    const courses = useQuery({
      ...academicsCourseListOptions({ path: { program_id: programId }, query: { limit: 500 } }),
      enabled: programId !== '',
    }).data?.items
    if (!programId) return []
    const items: CommandChild[] = pages.map((entry) => ({
      id: `page:${entry.id}`,
      title: entry.page.title(),
      subtitle: entry.scope.kind === 'term' ? term?.name : undefined,
      icon: entry.page.icon,
      to: entry.href,
    }))
    for (const t of terms ?? []) {
      items.push({
        id: `term:${t.id}`,
        title: t.name,
        subtitle: m.academics_command_term(),
        icon: CalendarRange,
        to: termPath(programId, t.id),
      })
    }
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

/** "New term": the term wizard, from any page of a Program. */
export const newTermCommand: CommandContribution = {
  id: 'academics.new-term',
  title: m.academics_term_new,
  icon: CalendarPlus,
  isAvailable: ({ programId }) => Boolean(programId),
  run: ({ programId, navigate }) => {
    if (programId) navigate(newTermPath(programId))
  },
}

/** "Add course" on a term page: the same choices as the term's "Add course" menu. */
export const addCourseCommand: CommandContribution = {
  id: 'academics.add-course',
  title: m.academics_course_add,
  icon: BookPlus,
  scopes: ['term'],
  isAvailable: ({ scope }) => scope?.kind === 'term',
  useChildren: function useAddCourseChildren({ scope }) {
    const programId = scope?.programId ?? ''
    const termId = scope?.kind === 'term' ? scope.termId : ''
    const { candidates, sources, continueCourse, importFrom } = useAddCourseOptions(
      programId,
      termId,
    )
    return [
      {
        id: 'manual',
        title: m.academics_course_add_manual(),
        subtitle: m.academics_course_add_manual_description(),
        icon: PencilLine,
        run: () => openAddCourses(programId, termId),
      },
      ...candidates.map((course): CommandChild => ({
        id: `continue:${course.id}`,
        title: course.code || course.title,
        subtitle: m.academics_course_add_continue(),
        icon: Repeat,
        run: () => continueCourse(course),
      })),
      ...sources.map((source): CommandChild => ({
        id: `import:${source.id}`,
        title: source.title(),
        subtitle: source.description?.(),
        icon: source.icon,
        run: () => importFrom(source),
      })),
    ]
  },
}
