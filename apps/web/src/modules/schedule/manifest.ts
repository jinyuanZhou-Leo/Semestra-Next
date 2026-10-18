import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarCheck,
  Clock,
  ListTodo,
  Settings2,
  Sun,
  Tags,
} from 'lucide-react'
import { lazy } from 'react'
import { defineModule } from '@/app/extensions'
import { coursePath } from '@/modules/academics/paths'
import { m } from '@/paraglide/messages'

const CALENDAR_QUERIES = ['calendarOccurrences', 'calendarToday'] as const
const SCHEDULE_QUERIES = [
  'scheduleMeetingList',
  'scheduleEventList',
  'scheduleEventTypeList',
  'scheduleConflicts',
  'scheduleFeedList',
] as const

const SCHEDULE_EVENTS = [
  'schedule.meeting.created',
  'schedule.meeting.updated',
  'schedule.meeting.deleted',
  'schedule.exception.upserted',
  'schedule.exception.deleted',
  'schedule.event.created',
  'schedule.event.updated',
  'schedule.event.deleted',
  'schedule.event_type.created',
  'schedule.event_type.updated',
  'schedule.event_type.deleted',
] as const

/** Academics changes that move or remove calendar items (course colors, terms, deletions). */
const ACADEMICS_EVENTS = [
  'academics.program.updated',
  'academics.term.updated',
  'academics.term.deleted',
  'academics.course.updated',
  'academics.course.deleted',
  'academics.course.terms_changed',
] as const

/**
 * M04 课表与日历: event types, meetings and their exceptions, one-off events, the term calendar
 * that merges every calendar source, the Program's "today" page, export and ICS feeds.
 * Extension point for other modules: `schedule.meetingImportSources` (see `./types.ts`).
 */
export default defineModule({
  id: 'schedule',
  kind: 'core',
  name: m.schedule_name,
  description: m.schedule_description,
  icon: CalendarDays,
  pages: [
    {
      id: 'today',
      scopes: ['program'],
      title: m.schedule_today,
      icon: Sun,
      component: lazy(() => import('./pages/TodayPage')),
      order: 5,
    },
    {
      id: 'calendar',
      scopes: ['term'],
      title: m.schedule_nav_calendar,
      icon: CalendarDays,
      component: lazy(() => import('./pages/CalendarPage')),
      order: 10,
    },
    {
      id: 'schedule',
      scopes: ['course'],
      title: m.schedule_nav_schedule,
      icon: CalendarClock,
      component: lazy(() => import('./pages/CourseSchedulePage')),
      order: 10,
    },
  ],
  cards: [
    {
      id: 'schedule.today',
      scopes: ['today', 'program', 'term'],
      title: m.schedule_card_today,
      icon: CalendarCheck,
      sizes: ['m', 'l', 'xl'],
      defaultSize: 'l',
      component: lazy(() => import('./cards/TodayCard')),
      multiple: false,
    },
    {
      id: 'schedule.upcoming',
      scopes: ['today', 'program'],
      title: m.schedule_card_upcoming,
      icon: ListTodo,
      sizes: ['m', 'l'],
      defaultSize: 'l',
      component: lazy(() => import('./cards/UpcomingCard')),
      multiple: false,
    },
    {
      id: 'schedule.week',
      scopes: ['term', 'course'],
      title: m.schedule_card_week,
      icon: CalendarRange,
      sizes: ['l', 'xl'],
      defaultSize: 'l',
      component: lazy(() => import('./cards/WeekCard')),
      multiple: false,
    },
    {
      id: 'schedule.next',
      scopes: ['course'],
      title: m.schedule_card_next,
      icon: Clock,
      sizes: ['s'],
      defaultSize: 's',
      component: lazy(() => import('./cards/NextCard')),
      multiple: false,
    },
  ],
  defaultBoard: {
    today: [
      { card: 'schedule.today', size: 'xl' },
      { card: 'schedule.upcoming', size: 'l' },
    ],
  },
  settingsSections: [
    {
      id: 'event-types',
      level: 'program',
      group: 'general',
      title: m.schedule_settings_event_types,
      description: m.schedule_settings_event_types_description,
      icon: Tags,
      order: 30,
      component: lazy(() =>
        import('./settings/EventTypesSection').then((s) => ({ default: s.EventTypesSection })),
      ),
    },
    ...(['program', 'term'] as const).map((level) => ({
      id: 'calendar',
      level,
      group: 'general' as const,
      title: m.schedule_settings_calendar,
      icon: Settings2,
      order: 40,
      namespace: 'calendar',
    })),
    {
      id: 'calendar',
      level: 'account',
      group: 'features',
      title: m.schedule_settings_calendar,
      icon: Settings2,
      order: 30,
      namespace: 'calendar',
      fields: {
        order: [
          'default_view',
          'day_start',
          'day_end',
          'show_weekends',
          'min_column_width',
          'cancelled_display',
        ],
      },
    },
  ],
  calendarSources: [
    {
      source: 'schedule.meetings',
      label: m.schedule_source_meetings,
      icon: CalendarDays,
      defaultVisible: true,
      onOpen: (o, navigate, { programId }) => {
        if (o.course_id) navigate(coursePath(programId, o.course_id, 'schedule'))
      },
    },
    {
      source: 'schedule.events',
      label: m.schedule_source_events,
      icon: CalendarClock,
      defaultVisible: true,
      onOpen: (o, navigate, { programId }) => {
        if (o.course_id) navigate(coursePath(programId, o.course_id, 'schedule'))
      },
    },
  ],
  realtimeInvalidations: Object.fromEntries([
    ['calendar.changed', CALENDAR_QUERIES],
    ...SCHEDULE_EVENTS.map((event) => [event, [...SCHEDULE_QUERIES, ...CALENDAR_QUERIES]]),
    ...ACADEMICS_EVENTS.map((event) => [event, [...CALENDAR_QUERIES, 'scheduleMeetingList']]),
  ]),
})
