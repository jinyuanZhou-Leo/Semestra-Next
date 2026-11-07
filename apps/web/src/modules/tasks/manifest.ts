import { ListChecks, ListTodo, Sun } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import { coursePath, termPath } from '@/modules/academics/paths'
import { ASSESSMENT_COLUMNS, type AssessmentColumn } from '@/modules/grading/types'
import { m } from '@/paraglide/messages'
import NewTaskButton from './cards/NewTaskButton'
import { listCardSettingsSchema } from './cards/schema'
import { completeFromCalendar, rescheduleFromCalendar } from './calendar'
import AssessmentTaskCell from './components/AssessmentTaskCell'
import { prefetchTodayTasks } from './queries'

const TASK_QUERIES = ['tasksItemQuery', 'tasksItemGet', 'tasksListList', 'tasksItemCount'] as const
const CALENDAR_QUERIES = ['calendarOccurrenceList', 'calendarTodayGet'] as const

/**
 * M05 待办: task lists and tasks per Program, smart lists, a tasks page for every term and course,
 * three board cards, the `tasks.due` calendar source (check off, drag and create from the calendar)
 * and the task of every dated assessment.
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
      mobile: {
        component: preloadable(() => import('./mobile/TasksMobilePage')),
        tab: { order: 10 },
      },
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
      component: preloadable(() => import('./cards/TodayCard')),
      prefetch: prefetchTodayTasks,
      multiple: false,
      headerActions: NewTaskButton,
    },
    {
      id: 'tasks.list',
      scopes: ['term', 'course'],
      title: m.tasks_card_list,
      icon: ListTodo,
      sizes: ['m', 'l'],
      defaultSize: 'm',
      component: preloadable(() => import('./cards/ListCard')),
      settings: {
        schema: listCardSettingsSchema,
        component: preloadable(() => import('./cards/ListCardSettings')),
      },
      multiple: true,
      headerActions: NewTaskButton,
    },
    {
      id: 'tasks.counter',
      scopes: ['term'],
      title: m.tasks_card_counter,
      icon: ListTodo,
      sizes: ['s'],
      defaultSize: 's',
      component: preloadable(() => import('./cards/CounterCard')),
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
        // An assessment's task opens its row in the course's gradebook.
        const assessment = occurrence.meta?.assessment_id
        if (occurrence.course_id && assessment)
          navigate(
            `${coursePath(programId, occurrence.course_id, 'grades')}?assessment=${encodeURIComponent(assessment)}`,
          )
        else if (occurrence.course_id)
          navigate(coursePath(programId, occurrence.course_id, 'tasks'))
        else if (occurrence.meta?.term_id)
          navigate(termPath(programId, occurrence.meta?.term_id, 'tasks'))
        else navigate(`/p/${programId}/tasks`)
      },
      complete: completeFromCalendar,
      reschedule: rescheduleFromCalendar,
      create: {
        label: m.tasks_calendar_create,
        form: preloadable(() => import('./components/CalendarTaskForm')),
      },
    },
  ],
  extensions: {
    [ASSESSMENT_COLUMNS]: [
      { id: 'tasks.todo', header: m.tasks_assessment_column, Cell: AssessmentTaskCell },
    ] satisfies AssessmentColumn[],
  },
  uiPrefPrefixes: ['tasks.'],
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
