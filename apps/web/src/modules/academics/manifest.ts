import {
  CalendarRange,
  GraduationCap,
  Info,
  LayoutDashboard,
  ListChecks,
  Palette,
  Pin,
} from 'lucide-react'
import { lazy } from 'react'
import { defineModule } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { academicsNavigation } from './commands'

/** Every query this module shows; any academics change refetches them (they are small). */
const ACADEMICS_QUERIES = [
  'academicsProgramList',
  'academicsProgramGet',
  'academicsTermList',
  'academicsTermGet',
  'academicsTermCalendarInfo',
  'academicsTermDeletePreview',
  'academicsCourseList',
  'academicsCourseGet',
] as const

const EVENTS = [
  'academics.program.created',
  'academics.program.updated',
  'academics.program.deleted',
  'academics.term.created',
  'academics.term.updated',
  'academics.term.deleted',
  'academics.course.created',
  'academics.course.updated',
  'academics.course.deleted',
  'academics.course.terms_changed',
] as const

const settings = () => import('./settings/sections')

/**
 * M02 学业结构与导航: Programs, terms and courses, the navigation shell around them, the term
 * wizard and onboarding. Extension points for other modules are in `./types.ts`.
 */
export default defineModule({
  id: 'academics',
  kind: 'core',
  name: m.academics_name,
  description: m.academics_description,
  icon: GraduationCap,
  pages: [
    {
      id: 'overview',
      scopes: ['program', 'term', 'course'],
      title: m.academics_nav_overview,
      icon: LayoutDashboard,
      component: lazy(() => import('./pages/OverviewPage')),
      order: 0,
    },
  ],
  navigationSources: [academicsNavigation],
  cards: [
    {
      id: 'academics.pinned',
      scopes: ['program'],
      title: m.academics_pinned,
      icon: Pin,
      sizes: ['m', 'xl'],
      defaultSize: 'm',
      component: lazy(() => import('./cards/PinnedCard')),
      multiple: false,
    },
    {
      id: 'academics.terms',
      scopes: ['program'],
      title: m.academics_terms,
      icon: CalendarRange,
      sizes: ['m', 'l', 'xl'],
      defaultSize: 'l',
      component: lazy(() => import('./cards/TermsCard')),
      multiple: false,
    },
    {
      id: 'academics.termCourses',
      scopes: ['term'],
      title: m.academics_term_courses,
      icon: ListChecks,
      sizes: ['l', 'xl'],
      defaultSize: 'xl',
      component: lazy(() => import('./cards/TermCoursesCard')),
      multiple: false,
    },
    {
      id: 'academics.courseInfo',
      scopes: ['course'],
      title: m.academics_course_info,
      icon: Info,
      sizes: ['m', 'l'],
      defaultSize: 'l',
      component: lazy(() => import('./cards/CourseInfoCard')),
      multiple: false,
    },
  ],
  defaultBoard: {
    program: [
      { card: 'academics.pinned', size: 'm' },
      { card: 'academics.terms', size: 'l' },
    ],
    term: [{ card: 'academics.termCourses', size: 'xl' }],
    course: [{ card: 'academics.courseInfo', size: 'l' }],
  },
  settingsSections: [
    {
      id: 'program-basics',
      level: 'program',
      group: 'general',
      title: m.academics_settings_basics,
      icon: Info,
      order: 10,
      component: lazy(() => settings().then((s) => ({ default: s.ProgramBasicsSection }))),
    },
    {
      id: 'subject-colors',
      level: 'program',
      group: 'general',
      title: m.academics_settings_subject_colors,
      description: m.academics_settings_subject_colors_description,
      icon: Palette,
      order: 20,
      component: lazy(() => settings().then((s) => ({ default: s.SubjectColorsSection }))),
    },
    {
      id: 'term-basics',
      level: 'term',
      group: 'general',
      title: m.academics_settings_basics,
      icon: Info,
      order: 10,
      component: lazy(() => settings().then((s) => ({ default: s.TermBasicsSection }))),
    },
    {
      id: 'course-basics',
      level: 'course',
      group: 'general',
      title: m.academics_settings_basics,
      icon: Info,
      order: 10,
      component: lazy(() => settings().then((s) => ({ default: s.CourseBasicsSection }))),
    },
  ],
  realtimeInvalidations: Object.fromEntries(EVENTS.map((event) => [event, ACADEMICS_QUERIES])),
})
