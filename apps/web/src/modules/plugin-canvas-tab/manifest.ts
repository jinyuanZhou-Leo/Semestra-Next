import type { CourseLinkState } from '@semestra/api-client'
import { lmsCourseLinkGetOptions } from '@semestra/api-client/react-query'
import { ExternalLink, School } from 'lucide-react'
import { defineModule, type Scope, preloadable } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { openLinkedCourse } from './open-in-canvas'

/** The course's LMS link: shared with the course info card and the gradebook banner (M09). */
function linkQuery(scope: Scope) {
  if (scope.kind !== 'course') return null
  return { ...lmsCourseLinkGetOptions({ path: { course_id: scope.courseId } }), staleTime: 60_000 }
}

/**
 * M16 Canvas Tab: browse a linked Canvas course without leaving the app. Frontend only: every
 * read, import and file save goes through the M09 `lms.*` capabilities, so uninstalling it leaves
 * connections, links, imports and the calendar as they are.
 */
export default defineModule({
  id: 'canvas-tab',
  kind: 'plugin',
  name: m.canvas_tab_name,
  description: m.canvas_tab_description,
  requirements: m.canvas_tab_requirements,
  icon: School,
  pages: [
    {
      id: 'canvas',
      scopes: ['course'],
      title: m.canvas_tab_page_title,
      icon: School,
      order: 1000,
      availabilityQuery: linkQuery,
      isAvailable: (_scope, data) =>
        (data as CourseLinkState | undefined)?.link?.provider === 'canvas',
      component: preloadable(() => import('./CanvasCoursePage')),
    },
  ],
  commands: [
    {
      id: 'canvas-tab.open-in-canvas',
      title: m.canvas_tab_open_in_canvas,
      icon: ExternalLink,
      scopes: ['course'],
      run: ({ scope }) => (scope?.kind === 'course' ? openLinkedCourse(scope.courseId) : undefined),
    },
  ],
})
