import type { CourseLinkList } from '@semestra/api-client'
import { ExternalLink, School } from 'lucide-react'
import { defineModule, type Scope, preloadable } from '@/app/extensions'
import { coursePath } from '@/modules/academics/paths'
import { LMS_LINK_OPENERS, type LmsLinkOpener } from '@/modules/lms/types'
import { m } from '@/paraglide/messages'
import { openLinkedCourse, programLinksOptions } from './open-in-canvas'
import { prefetchCanvasPage } from './prefetch'

// The Program's links, not each course's: the sidebar asks for every course of the term at once.
function linkQuery(scope: Scope) {
  return scope.kind === 'course' ? programLinksOptions(scope.programId) : null
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
      isAvailable: (scope, data) =>
        scope.kind === 'course' &&
        ((data as CourseLinkList | undefined)?.items.some(
          (link) => link.course_id === scope.courseId && link.provider === 'canvas',
        ) ??
          false),
      component: preloadable(() => import('./CanvasCoursePage')),
      prefetch: prefetchCanvasPage,
    },
  ],
  cards: [
    {
      id: 'canvas-tab.shortcuts',
      scopes: ['course', 'term'],
      title: m.canvas_tab_card_title,
      description: m.canvas_tab_card_description,
      icon: School,
      sizes: ['m', 'l'],
      defaultSize: 'm',
      component: preloadable(() => import('./cards/ShortcutsCard')),
      multiple: false,
    },
    {
      id: 'canvas-tab.shortcut',
      scopes: ['course'],
      title: m.canvas_tab_shortcut_title,
      description: m.canvas_tab_shortcut_description,
      icon: School,
      sizes: ['s'],
      defaultSize: 's',
      component: preloadable(() => import('./cards/ShortcutCard')),
      settings: () => import('./cards/shortcut'),
      multiple: true,
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
  extensions: {
    // Links to pages and modules in an assignment's description open here.
    [LMS_LINK_OPENERS]: [
      {
        id: 'canvas-tab',
        path: (link, { programId, courseId }) => {
          const tab = link.kind === 'page' ? 'pages' : link.kind === 'module' ? 'modules' : null
          return tab
            ? `${coursePath(programId, courseId, 'canvas')}?tab=${tab}&ref=${encodeURIComponent(link.ref)}`
            : null
        },
      },
    ] satisfies LmsLinkOpener[],
  },
  uiPrefPrefixes: ['canvas-tab.'],
})
