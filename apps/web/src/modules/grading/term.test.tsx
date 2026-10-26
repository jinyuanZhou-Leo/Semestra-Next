import type { CourseGrade, TermGrades } from '@semestra/api-client'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import type { Scope } from '@/app/extensions'
import { API, renderWithRouter, server } from '@/test-utils'
import { Toaster } from '@/ui/sonner'
import UpcomingCard from './cards/UpcomingCard'
import TermGradesPage from './pages/TermGradesPage'
import { assessment } from './test-data'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
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
    in_progress_count: 0,
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
          .map((key) => [key, { plan: true, scores: {}, targetGpa: target }]),
      )
      return HttpResponse.json({ items })
    }),
    http.put(`${API}/me/ui-state/:key`, () => HttpResponse.json({ ok: true })),
    // Course colors for the table and the ring.
    http.get(`${API}/programs/p1/courses`, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
    http.post(`${API}/terms/t1/grade-summary\\:simulate`, async ({ request }) => {
      simulations.push(await request.json())
      return HttpResponse.json(simulation)
    }),
  )
})

let simulations: unknown[] = []
const simulation = {
  term_id: 't1',
  gpa: 3.7,
  average_percentage: 85,
  credits_counted: 0.5,
  target_gpa: null,
  gap: null,
  max_possible_gpa: 4,
  reachable: null,
  required_percentage: null,
}
beforeEach(() => {
  simulations = []
})

const withGrades = (courses: CourseGrade[]) =>
  server.use(
    http.get(`${API}/terms/t1/grade-summary`, () => HttpResponse.json(termGrades(courses, false))),
  )

const mount = () =>
  renderWithRouter(
    <>
      <TermGradesPage scope={scope} />
      <Toaster />
    </>,
  )

/** The Undo button of the newest toast saying `text` (sonner lists the newest first). */
const undoOf = async (text: string) => {
  const toasts = await screen.findAllByText(text)
  const item = toasts[0]?.closest('[data-sonner-toast]')
  if (!(item instanceof HTMLElement)) throw new Error(`no toast "${text}"`)
  return within(item).getByRole('button', { name: 'Undo' })
}

test('plan mode needs an unfinished course', async () => {
  withGrades([courseGrade({ course_id: 'c1', status: 'completed', percentage: 90 })])
  mount()
  expect(await screen.findByRole('button', { name: 'Plan' })).toBeDisabled()
})

test('the Count unfinished switch asks for the summary with unfinished courses', async () => {
  const asked: (string | null)[] = []
  server.use(
    http.get(`${API}/terms/t1/grade-summary`, ({ request }) => {
      asked.push(new URL(request.url).searchParams.get('include_in_progress'))
      return HttpResponse.json(termGrades([courseGrade({ course_id: 'c1' })], false))
    }),
  )
  mount()
  const toggle = await screen.findByRole('switch', { name: 'Count unfinished' })
  expect(toggle).not.toBeChecked()
  await userEvent.click(toggle)
  expect(toggle).toBeChecked()
  await waitFor(() => expect(asked.at(-1)).toBe('true'))
})

test('plan mode simulates the assumptions and keeps them after leaving it', async () => {
  withGrades([courseGrade({ course_id: 'c1' })])
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Plan' }))
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Assumed score: Course c1' }),
    '85',
  )
  await userEvent.tab()
  await waitFor(() => expect(simulations.at(-1)).toMatchObject({ scores: { c1: 85 } }))
  expect(await screen.findByText('3.70')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Exit plan mode' }))
  expect(screen.queryByRole('textbox', { name: /Assumed score/ })).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole('button', { name: 'Plan' }))
  expect(await screen.findByRole('textbox', { name: 'Assumed score: Course c1' })).toHaveValue('85')
})

test('undoing a clear brings back only the assumptions, not plan mode', async () => {
  withGrades([courseGrade({ course_id: 'c1' })])
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Plan' }))
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Assumed score: Course c1' }),
    '85',
  )
  await userEvent.tab()
  await userEvent.click(screen.getByRole('button', { name: 'Clear assumptions' }))
  expect(screen.getByRole('textbox', { name: 'Assumed score: Course c1' })).toHaveValue('')
  await userEvent.click(screen.getByRole('button', { name: 'Exit plan mode' }))
  // Sonner captures the pointer on press, which jsdom lacks; a plain click is enough here.
  fireEvent.click(await undoOf('Assumptions cleared'))
  // Still out of plan mode; the assumption is back once it is entered again.
  expect(await screen.findByRole('button', { name: 'Plan' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Plan' }))
  expect(await screen.findByRole('textbox', { name: 'Assumed score: Course c1' })).toHaveValue('85')
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
  // Outside plan mode no course takes an assumption.
  await screen.findByText('C1')
  expect(screen.queryByRole('textbox', { name: /Assumed score/ })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Plan' }))
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
  expect(await within(result).findByText('••• short')).toBeInTheDocument()
  expect(result).not.toHaveTextContent('0.50')
})

test('the Upcoming card asks the server for the scope in one request', async () => {
  const seen: URLSearchParams[] = []
  server.use(
    http.get(`${API}/programs/p1/upcoming-assessments`, ({ request }) => {
      seen.push(new URL(request.url).searchParams)
      return HttpResponse.json({
        items: [
          assessment({
            id: 'soon',
            title: 'Due first',
            status: 'pending',
            due_at: '2026-10-19T03:59:59Z',
            due_date: '2026-10-18',
            due_time: null,
          }),
        ],
      })
    }),
    http.get(`${API}/courses/c1`, () =>
      HttpResponse.json({ id: 'c1', program_id: 'p1', title: 'Course c1', code: 'C1' }),
    ),
    http.get(`${API}/programs/p1/courses`, () =>
      HttpResponse.json({
        items: [{ id: 'c1', program_id: 'p1', title: 'Course c1', code: 'C1' }],
        next_cursor: null,
      }),
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
  expect(seen).toHaveLength(1)
  expect(seen[0]?.get('course_id')).toBe('c1')
  expect(seen[0]?.get('limit')).toBe('4')
})

test('the planned figures stay on screen while the next simulation runs', async () => {
  withGrades([courseGrade({ course_id: 'c1' })])
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Plan' }))
  expect(await screen.findByText('3.70')).toBeInTheDocument()
  let answer: () => void = () => {}
  server.use(
    http.post(`${API}/terms/t1/grade-summary\\:simulate`, async () => {
      await new Promise<void>((resolve) => {
        answer = resolve
      })
      return HttpResponse.json({ ...simulation, gpa: 3.9 })
    }),
  )
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Assumed score: Course c1' }),
    '95',
  )
  await userEvent.tab()
  // The request is out (after the debounce) and the previous answer is still shown.
  await new Promise((resolve) => setTimeout(resolve, 400))
  expect(screen.getByText('3.70')).toBeInTheDocument()
  answer()
  expect(await screen.findByText('3.90')).toBeInTheDocument()
})
