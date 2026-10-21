import {
  CalendarRange,
  GraduationCap,
  Info,
  LayoutDashboard,
  ListChecks,
  Palette,
  Trash2,
} from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import CourseInfoActions from './cards/CourseInfoActions'
import { m } from '@/paraglide/messages'
import { academicsNavigation } from './commands'

/** Every query this module shows; any academics change refetches them (they are small). */
const ACADEMICS_QUERIES = [
  'academicsProgramList',
  'academicsProgramGet',
  'academicsTermList',
  'academicsTermGet',
  'academicsTermGetWeeks',
  'academicsTermPreviewDelete',
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
      component: preloadable(() => import('./pages/OverviewPage')),
      board: 'scope',
      order: 0,
    },
  ],
  navigationSources: [academicsNavigation],
  cards: [
    {
      id: 'academics.terms',
      scopes: ['program'],
      title: m.academics_terms,
      icon: CalendarRange,
      sizes: ['m', 'l', 'xl'],
      defaultSize: 'l',
      component: preloadable(() => import('./cards/TermsCard')),
      multiple: false,
    },
    {
      id: 'academics.termCourses',
      scopes: ['term'],
      title: m.academics_term_courses,
      icon: ListChecks,
      sizes: ['l', 'xl'],
      defaultSize: 'xl',
      component: preloadable(() => import('./cards/TermCoursesCard')),
      multiple: false,
    },
    {
      id: 'academics.courseInfo',
      scopes: ['course'],
      title: m.academics_course_info,
      icon: Info,
      sizes: ['m', 'l'],
      defaultSize: 'l',
      component: preloadable(() => import('./cards/CourseInfoCard')),
      headerActions: CourseInfoActions,
      multiple: false,
    },
  ],
  defaultBoard: {
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
      component: preloadable(() => settings().then((s) => ({ default: s.ProgramBasicsSection }))),
    },
    {
      id: 'subject-colors',
      level: 'program',
      group: 'general',
      title: m.academics_settings_subject_colors,
      description: m.academics_settings_subject_colors_description,
      icon: Palette,
      order: 20,
      component: preloadable(() => settings().then((s) => ({ default: s.SubjectColorsSection }))),
    },
    {
      id: 'term-basics',
      level: 'term',
      group: 'general',
      title: m.academics_settings_basics,
      icon: Info,
      order: 10,
      component: preloadable(() => settings().then((s) => ({ default: s.TermBasicsSection }))),
    },
    {
      id: 'course-basics',
      level: 'course',
      group: 'general',
      title: m.academics_settings_basics,
      icon: Info,
      order: 10,
      component: preloadable(() => settings().then((s) => ({ default: s.CourseBasicsSection }))),
    },
    {
      id: 'program-danger',
      level: 'program',
      group: 'general',
      title: m.settings_danger_zone,
      danger: true,
      icon: Trash2,
      order: 900,
      component: preloadable(() => settings().then((s) => ({ default: s.ProgramDangerSection }))),
    },
    {
      id: 'term-danger',
      level: 'term',
      group: 'general',
      title: m.settings_danger_zone,
      danger: true,
      icon: Trash2,
      order: 900,
      component: preloadable(() => settings().then((s) => ({ default: s.TermDangerSection }))),
    },
    {
      id: 'course-danger',
      level: 'course',
      group: 'general',
      title: m.settings_danger_zone,
      danger: true,
      icon: Trash2,
      order: 900,
      component: preloadable(() => settings().then((s) => ({ default: s.CourseDangerSection }))),
    },
  ],
  realtimeInvalidations: Object.fromEntries(EVENTS.map((event) => [event, ACADEMICS_QUERIES])),
})
