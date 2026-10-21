import { CalendarCheck, ListChecks, ListTodo, Sun } from 'lucide-react'
import { lazy } from 'react'
import { defineModule, preloadable } from '@/app/extensions'
import { coursePath, termPath } from '@/modules/academics/paths'
import { m } from '@/paraglide/messages'
import { listCardSettingsSchema } from './cards/schema'

const TASK_QUERIES = ['tasksItemQuery', 'tasksItemGet', 'tasksListList', 'tasksItemCount'] as const
const CALENDAR_QUERIES = ['calendarOccurrenceList', 'calendarTodayGet'] as const

/**
 * M05 待办: task lists and tasks per Program, smart lists, a tasks page for every term and course,
 * three board cards, the `tasks.due` calendar source and tasks generated from assessments.
 */
export default defineModule({
  id: 'tasks',
  kind: 'core',
  name: m.tasks_name,
  description: m.tasks_description,
  icon: ListChecks,
  pages: [
    {
      id: 'tasks',
      scopes: ['program', 'term', 'course'],
      title: m.tasks_name,
      icon: ListChecks,
      component: preloadable(() => import('./pages/TasksPage')),
      sidebarNav: preloadable(() =>
        import('./components/TasksSidebar').then((mod) => ({ default: mod.TasksSidebarNav })),
      ),
      order: 20,
    },
  ],
  cards: [
    {
      id: 'tasks.today',
      scopes: ['today', 'program', 'term'],
      title: m.tasks_card_today,
      icon: Sun,
      sizes: ['m', 'l'],
      defaultSize: 'l',
      component: lazy(() => import('./cards/TodayCard')),
      multiple: false,
    },
    {
      id: 'tasks.list',
      scopes: ['term', 'course'],
      title: m.tasks_card_list,
      icon: ListTodo,
      sizes: ['m', 'l'],
      defaultSize: 'm',
      component: lazy(() => import('./cards/ListCard')),
      settings: {
        schema: listCardSettingsSchema,
        component: lazy(() => import('./cards/ListCardSettings')),
      },
      multiple: true,
    },
    {
      id: 'tasks.counter',
      scopes: ['term'],
      title: m.tasks_card_counter,
      icon: CalendarCheck,
      sizes: ['s'],
      defaultSize: 's',
      component: lazy(() => import('./cards/CounterCard')),
      multiple: false,
    },
  ],
  defaultBoard: {
    today: [{ card: 'tasks.today', size: 'l' }],
  },
  settingsSections: [
    {
      id: 'tasks',
      level: 'program',
      group: 'features',
      title: m.tasks_name,
      icon: ListChecks,
      order: 50,
      namespace: 'tasks',
    },
  ],
  calendarSources: [
    {
      source: 'tasks.due',
      label: m.tasks_calendar_source,
      icon: ListChecks,
      defaultVisible: true,
      onOpen: (occurrence, navigate, { programId }) => {
        if (occurrence.course_id) navigate(coursePath(programId, occurrence.course_id, 'tasks'))
        else if (occurrence.meta?.term_id)
          navigate(termPath(programId, occurrence.meta?.term_id, 'tasks'))
        else navigate(`/p/${programId}/tasks`)
      },
    },
  ],
  realtimeInvalidations: Object.fromEntries([
    ...[
      'tasks.item.created',
      'tasks.item.updated',
      'tasks.item.completed',
      'tasks.item.deleted',
      'tasks.list.created',
      'tasks.list.updated',
      'tasks.list.deleted',
    ].map((event) => [event, TASK_QUERIES]),
    ['calendar.changed', CALENDAR_QUERIES],
    ['academics.course.updated', ['tasksItemQuery']],
    ['academics.course.deleted', ['tasksItemQuery', 'tasksItemCount']],
    ['academics.term.deleted', [...TASK_QUERIES]],
    ['settings.values.updated', ['tasksItemQuery', 'tasksItemCount']],
  ]),
})
