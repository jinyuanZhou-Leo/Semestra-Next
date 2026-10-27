import type { CourseLinkState } from '@semestra/api-client'
import { ExternalLink, School } from 'lucide-react'
import { defineModule, type Scope, preloadable } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { courseLinkOptions, openLinkedCourse } from './open-in-canvas'

function linkQuery(scope: Scope) {
  return scope.kind === 'course' ? courseLinkOptions(scope.courseId) : null
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
      run: ({ scope, queryClient }) =>
        scope?.kind === 'course' ? openLinkedCourse(queryClient, scope.courseId) : undefined,
    },
  ],
  uiPrefPrefixes: ['canvas-tab.'],
})
