import { CalendarClock, ChartLine, GraduationCap, NotebookPen, Percent, Sigma } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import {
  COURSE_COLUMNS,
  PROGRAM_SETUP_FIELDS,
  type ProgramSetupField,
} from '@/modules/academics/types'
import { coursePath } from '@/modules/academics/paths'
import { m } from '@/paraglide/messages'
import { courseColumns } from './extensions/columns'
import { ScalePresetField } from './extensions/SetupField'

/** Queries that show grades; any change to grades or to the courses behind them refetches them. */
const GRADING_QUERIES = [
  'gradingGradebookGet',
  'gradingAssessmentList',
  'gradingScaleGet',
  'gradingSummaryTerm',
  'gradingSummaryProgram',
  'gradingCourseSummaryList',
] as const

const GRADING_EVENTS = [
  'grading.assessment.created',
  'grading.assessment.updated',
  'grading.assessment.deleted',
  'grading.course_result.updated',
  'grading.scale.updated',
  // What a grade is counted against changes with the structure of the Program.
  'academics.program.updated',
  'academics.term.updated',
  'academics.term.deleted',
  'academics.course.created',
  'academics.course.updated',
  'academics.course.deleted',
  'academics.course.terms_changed',
] as const

const settings = () => import('./settings/sections')

const setupField: ProgramSetupField = {
  id: 'grading_scale_preset',
  order: 10,
  component: ScalePresetField,
}

/**
 * M03 成绩与 GPA: the gradebook of every course, term and Program GPA, plan mode. Extension
 * points other modules can use are in `./types.ts`.
 */
export default defineModule({
  id: 'grading',
  kind: 'core',
  name: m.grading_name,
  description: m.grading_description,
  icon: Percent,
  pages: [
    {
      id: 'grades',
      scopes: ['course', 'term'],
      title: m.grading_nav_grades,
      icon: NotebookPen,
      component: preloadable(() => import('./pages/GradesPage')),
      order: 20,
    },
  ],
  cards: [
    {
      id: 'grading.courseSummary',
      scopes: ['course'],
      title: m.grading_card_course_summary,
      icon: GraduationCap,
      sizes: ['s', 'm'],
      defaultSize: 'm',
      component: preloadable(() => import('./cards/CourseSummaryCard')),
      multiple: false,
    },
    {
      id: 'grading.termSummary',
      scopes: ['term'],
      title: m.grading_card_term_summary,
      icon: Sigma,
      sizes: ['s', 'm'],
      defaultSize: 'm',
      component: preloadable(() => import('./cards/TermSummaryCard')),
      multiple: false,
    },
    {
      id: 'grading.programKpis',
      scopes: ['program'],
      title: m.grading_card_program_kpis,
      icon: Sigma,
      sizes: ['xl'],
      defaultSize: 'xl',
      component: preloadable(() => import('./cards/ProgramKpisCard')),
      multiple: false,
    },
    {
      id: 'grading.programCharts',
      scopes: ['program'],
      title: m.grading_card_program_charts,
      icon: ChartLine,
      sizes: ['l', 'xl'],
      defaultSize: 'l',
      component: preloadable(() => import('./cards/ProgramChartsCard')),
      multiple: false,
    },
    {
      id: 'grading.upcoming',
      scopes: ['term', 'course'],
      title: m.grading_card_upcoming,
      icon: CalendarClock,
      sizes: ['m', 'l'],
      defaultSize: 'm',
      component: preloadable(() => import('./cards/UpcomingCard')),
      multiple: false,
    },
  ],
  settingsSections: [
    {
      id: 'program-grading',
      level: 'program',
      group: 'grades',
      title: m.grading_settings_program,
      description: m.grading_settings_program_description,
      icon: Percent,
      order: 30,
      component: preloadable(() => settings().then((s) => ({ default: s.ProgramGradingSection }))),
    },
    {
      id: 'course-grading',
      level: 'course',
      group: 'grades',
      title: m.grading_settings_course,
      icon: Percent,
      order: 30,
      component: preloadable(() => settings().then((s) => ({ default: s.CourseGradingSection }))),
    },
  ],
  calendarSources: [
    {
      source: 'grading.assessments',
      label: m.grading_calendar_source,
      icon: CalendarClock,
      defaultVisible: true,
      onOpen: (o, navigate, { programId }) => {
        if (o.course_id) navigate(coursePath(programId, o.course_id, 'grades'))
      },
    },
  ],
  extensions: {
    [COURSE_COLUMNS]: courseColumns,
    [PROGRAM_SETUP_FIELDS]: [setupField],
  },
  realtimeInvalidations: Object.fromEntries(
    GRADING_EVENTS.map((event) => [event, GRADING_QUERIES]),
  ),
})
