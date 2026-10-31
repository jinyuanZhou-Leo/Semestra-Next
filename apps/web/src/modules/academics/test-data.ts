import type { Course, Program, Term } from '@semestra/api-client'
import { http, HttpResponse } from 'msw'
import { API } from '@/test-utils'

/** Fixtures and an in-memory API for the academics tests. */

const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

export function program(overrides: Partial<Program> = {}): Program {
  return {
    id: 'p1',
    name: 'Computer Engineering',
    institution: 'University of Toronto',
    timezone: 'America/Toronto',
    default_course_credits: 0.5,
    credit_requirement: null,
    subject_colors: {},
    sort_order: 0,
    term_count: 2,
    course_count: 3,
    ...stamp,
    ...overrides,
  }
}

export function term(overrides: Partial<Term> & { id: string }): Term {
  return {
    program_id: 'p1',
    name: overrides.id,
    start_date: '2026-01-06',
    end_date: '2026-04-30',
    breaks: [],
    count_break_weeks: false,
    is_current: false,
    course_count: 0,
    ...stamp,
    ...overrides,
  }
}

export function course(overrides: Partial<Course> & { id: string; term_ids: string[] }): Course {
  return {
    program_id: 'p1',
    code: null,
    title: overrides.id,
    alias: null,
    subject_code: '',
    color: null,
    resolved_color: 'subject-1',
    subject_color: 'subject-1',
    credits: 0.5,
    include_in_gpa: true,
    instructors: [],
    description: null,
    website_url: null,
    planned_terms: 1,
    sort_order: 0,
    end_term_id: overrides.term_ids.at(-1) ?? '',
    ...stamp,
    ...overrides,
  }
}

export type World = {
  programs: Program[]
  terms: Term[]
  courses: Course[]
  activeProgramId: string | null
  /** M11 `start_page`. */
  startPage: string
  /** Bodies of `POST /programs/{id}/terms`. */
  termCreates: unknown[]
  /** Saved UI state by full key (`academics.pinned.p1` …); written values stay in the page's cache. */
  uiState: Record<string, unknown>
}

export function defaultWorld(): World {
  return {
    programs: [program()],
    terms: [
      term({ id: 't1', name: 'Fall 2025', start_date: '2025-09-04', end_date: '2025-12-20' }),
      term({ id: 't2', name: 'Winter 2026', is_current: true, course_count: 3 }),
    ],
    courses: [
      course({ id: 'c1', code: 'APS105H1', title: 'Computer Fundamentals', term_ids: ['t2'] }),
      course({ id: 'c2', code: 'MAT188H1', title: 'Linear Algebra', term_ids: ['t2'] }),
      course({ id: 'c3', code: 'ESC180Y1', title: 'Year-long design', term_ids: ['t1', 't2'] }),
    ],
    activeProgramId: null,
    startPage: 'today',
    termCreates: [],
    uiState: {},
  }
}

const preferences = (world: World) => ({
  locale: null,
  theme: 'system',
  accent: 'blue',
  time_format: 'auto',
  week_start: 0,
  reduce_motion: 'system',
  active_program_id: world.activeProgramId,
  start_page: world.startPage,
  updated_at: null,
})

const notFound = () =>
  HttpResponse.json(
    { error: { code: 'common.not_found', params: {}, request_id: 'r' } },
    { status: 404 },
  )

/** Every endpoint the signed-in shell touches, backed by `world`. */
export function academicsHandlers(world: World) {
  return [
    http.get(`${API}/me/preferences`, () => HttpResponse.json(preferences(world))),
    http.patch(`${API}/me/preferences`, async ({ request }) => {
      const patch = (await request.json()) as { active_program_id?: string | null }
      if (patch.active_program_id !== undefined) world.activeProgramId = patch.active_program_id
      return HttpResponse.json(preferences(world))
    }),
    http.post(`${API}/me/ui-state\\:get`, async ({ request }) => {
      const body = (await request.json()) as { keys?: string[]; prefixes?: string[] }
      const wanted = ([key]: [string, unknown]) =>
        body.keys?.includes(key) || body.prefixes?.some((prefix) => key.startsWith(prefix))
      return HttpResponse.json({
        items: Object.fromEntries(Object.entries(world.uiState).filter(wanted)),
      })
    }),
    http.put(`${API}/me/ui-state/:key`, () => HttpResponse.json({ ok: true })),
    http.get(`${API}/jobs`, () => HttpResponse.json({ items: [], next_cursor: null })),
    http.get(`${API}/me/settings-schemas`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/programs`, () => HttpResponse.json({ items: world.programs })),
    http.get(`${API}/programs/:id`, ({ params }) => {
      const found = world.programs.find((p) => p.id === params.id)
      return found ? HttpResponse.json(found) : notFound()
    }),
    http.get(`${API}/programs/:id/terms`, ({ params }) =>
      HttpResponse.json({ items: world.terms.filter((t) => t.program_id === params.id) }),
    ),
    http.get(`${API}/programs/:id/courses`, ({ params, request }) => {
      const termId = new URL(request.url).searchParams.get('term_id')
      const items = world.courses.filter(
        (c) => c.program_id === params.id && (!termId || c.term_ids.includes(termId)),
      )
      return HttpResponse.json({ items, next_cursor: null })
    }),
    http.get(`${API}/courses/:id`, ({ params }) => {
      const found = world.courses.find((c) => c.id === params.id)
      return found ? HttpResponse.json(found) : notFound()
    }),
    http.get(`${API}/terms/:id`, ({ params }) => {
      const found = world.terms.find((t) => t.id === params.id)
      return found ? HttpResponse.json(found) : notFound()
    }),
    http.get(`${API}/terms/:id/calendar-info`, ({ params }) =>
      HttpResponse.json({
        term_id: params.id,
        timezone: 'America/Toronto',
        week_start: 7,
        weeks: [],
        today: '2026-01-15',
        today_week: 2,
      }),
    ),
    http.post(`${API}/programs/:id/terms`, async ({ request, params }) => {
      const body = (await request.json()) as { name: string; start_date: string; end_date: string }
      world.termCreates.push(body)
      const created = term({
        id: `t${world.terms.length + 1}`,
        program_id: String(params.id),
        ...body,
      })
      world.terms.push(created)
      return HttpResponse.json({ term: created, course_ids: [], continued_course_ids: [] })
    }),
  ]
}
