import type { CourseGrade, TermGrades } from '@semestra/api-client'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import type { Scope } from '@/app/extensions'
import { API, renderWithRouter, server } from '@/test-utils'
import UpcomingCard from './cards/UpcomingCard'
import TermGradesPage from './pages/TermGradesPage'
import { assessment, gradebook } from './test-data'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const scope: Scope = { kind: 'term', programId: 'p1', termId: 't1' }

function courseGrade(overrides: Partial<CourseGrade> & { course_id: string }): CourseGrade {
  return {
    code: overrides.course_id.toUpperCase(),
    title: `Course ${overrides.course_id}`,
    alias: null,
    credits: 0.5,
    include_in_gpa: true,
    basis: 'percentage',
    status: 'in_progress',
    percentage: null,
    current_percentage: 80,
    points: null,
    letter: null,
    counts_in_gpa: false,
    year_long: false,
    attributed_credits: 0.5,
    ...overrides,
  }
}

function termGrades(courses: CourseGrade[], hide: boolean): TermGrades {
  return {
    term_id: 't1',
    max_points: 4,
    hide_gpa: hide,
    gpa: 3.5,
    average_percentage: 80,
    credits_counted: 0,
    credits_total: 1,
    credits_earned: 0,
    excluded_count: 0,
    courses,
  }
}

let target: number | null = null

beforeEach(() => {
  target = null
  server.use(
    http.post(`${API}/me/ui-state\\:get`, async ({ request }) => {
      const { keys } = (await request.json()) as { keys: string[] }
      const items = Object.fromEntries(
        keys
          .filter((key) => key.startsWith('grading.term.whatif') && target !== null)
          .map((key) => [key, { scores: {}, targetGpa: target }]),
      )
      return HttpResponse.json({ items })
    }),
    http.put(`${API}/me/ui-state/:key`, () => HttpResponse.json({ ok: true })),
  )
})

test('only courses that can move the term plan take an assumed percentage', async () => {
  server.use(
    http.get(`${API}/terms/t1/grade-summary`, () =>
      HttpResponse.json(
        termGrades(
          [
            courseGrade({ course_id: 'c1' }),
            courseGrade({ course_id: 'c2', basis: 'pass_fail', current_percentage: null }),
            // a year-long course whose credits land in its last term
            courseGrade({ course_id: 'c3', year_long: true, attributed_credits: 0 }),
            // counted nowhere in the term GPA, so an assumed score would change nothing
            courseGrade({ course_id: 'c4', include_in_gpa: false }),
          ],
          false,
        ),
      ),
    ),
  )
  renderWithRouter(<TermGradesPage scope={scope} />)
  expect(
    await screen.findByRole('textbox', { name: /Assumed score: Course c1/ }),
  ).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: /Assumed score: Course c2/ })).toBeNull()
  expect(screen.queryByRole('textbox', { name: /Assumed score: Course c3/ })).toBeNull()
  expect(screen.queryByRole('textbox', { name: /Assumed score: Course c4/ })).toBeNull()
})

test('a hidden planned GPA cannot be worked out from the target gap', async () => {
  target = 4
  server.use(
    http.get(`${API}/terms/t1/grade-summary`, () =>
      HttpResponse.json(termGrades([courseGrade({ course_id: 'c1' })], true)),
    ),
    http.post(`${API}/terms/t1/grade-summary\\:simulate`, () =>
      HttpResponse.json({
        term_id: 't1',
        gpa: 3.5,
        average_percentage: 80,
        credits_counted: 0.5,
        target_gpa: 4,
        gap: 0.5,
        max_possible_gpa: 4,
        reachable: true,
        required_percentage: 95,
      }),
    ),
  )
  renderWithRouter(<TermGradesPage scope={scope} />)
  const result = await screen.findByTestId('term-plan-result')
  expect(result).toHaveTextContent('••• short')
  expect(result).not.toHaveTextContent('0.50')
})

test('the Upcoming card reads the whole gradebook, so a late list position still counts', async () => {
  const many = Array.from({ length: 250 }, (_, i) =>
    assessment({ id: `a${i}`, title: `Task ${i}`, position: i }),
  )
  many.push(
    assessment({
      id: 'soon',
      title: 'Due first',
      position: 250,
      status: 'pending',
      due_at: '2026-10-19T03:59:59Z',
      due_date: '2026-10-18',
      due_time: null,
    }),
  )
  server.use(
    http.get(`${API}/courses/c1/gradebook`, () =>
      HttpResponse.json(gradebook({ assessments: many })),
    ),
    http.get(`${API}/courses/c1`, () =>
      HttpResponse.json({ id: 'c1', program_id: 'p1', title: 'Course c1', code: 'C1' }),
    ),
  )
  renderWithRouter(
    <UpcomingCard
      scope={{ kind: 'course', programId: 'p1', courseId: 'c1' }}
      size="m"
      instanceId="i1"
      settings={{}}
    />,
  )
  expect(await screen.findByText('Due first')).toBeInTheDocument()
})
