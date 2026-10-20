import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import type { Scope } from '@/app/extensions'
import { API, renderWithRouter, server } from '@/test-utils'
import CourseGradesPage from './pages/CourseGradesPage'
import { assessment, gradebook, summary } from './test-data'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const scope: Scope = { kind: 'course', programId: 'p1', courseId: 'c1' }

let book = gradebook()
let patches: { id: string; body: unknown }[] = []
let simulations: unknown[] = []

beforeEach(() => {
  book = gradebook()
  patches = []
  simulations = []
  server.use(
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.put(`${API}/me/ui-state/:key`, () => HttpResponse.json({ ok: true })),
    http.get(`${API}/courses/c1/gradebook`, () => HttpResponse.json(book)),
    // No LMS: the gradebook does not offer an import from it.
    http.get(`${API}/courses/c1/lms-link`, () =>
      HttpResponse.json({ course_id: 'c1', link: null, program_connection_id: null }),
    ),
    http.get(`${API}/programs/p1/lms-binding`, () =>
      HttpResponse.json({ program_id: 'p1', connection_id: null, connection: null, link_count: 0 }),
    ),
    http.patch(`${API}/assessments/:id`, async ({ request, params }) => {
      patches.push({ id: String(params.id), body: await request.json() })
      return HttpResponse.json(book.assessments[0])
    }),
    http.post(`${API}/courses/c1/gradebook\\:simulate`, async ({ request }) => {
      simulations.push(await request.json())
      return HttpResponse.json(
        summary({ status: 'completed', final_percentage: 88, final_letter: 'A', final_points: 4 }),
      )
    }),
  )
})

const mount = () => renderWithRouter(<CourseGradesPage scope={scope} />)

test('the summary shows the current grade and what the rest has to average', async () => {
  mount()
  expect(await screen.findByText('Current')).toBeInTheDocument()
  expect(screen.getByText('80%')).toBeInTheDocument()
  expect(screen.getByText('88.3%')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Score: Quiz 1' })).toHaveValue('80')
})

test('weights that do not add up to 100 warn and hold back the figures', async () => {
  book = gradebook({
    summary: summary({
      weights_ok: false,
      weight_total: 80,
      weight_gap: 20,
      current_percentage: null,
    }),
  })
  mount()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('The weights add up to 80%')
  expect(screen.getByRole('switch', { name: /Plan mode/ })).toHaveAttribute('aria-disabled', 'true')
})

test('typing 18/20 in a score cell saves points, not a percentage', async () => {
  mount()
  const cell = await screen.findByRole('textbox', { name: 'Score: Final exam' })
  await userEvent.type(cell, '18/20')
  await userEvent.tab()
  await waitFor(() => expect(patches).toHaveLength(1))
  expect(patches[0]).toEqual({
    id: 'a2',
    body: { points_earned: 18, points_possible: 20 },
  })
})

test('an unreadable score is flagged and not sent', async () => {
  mount()
  const cell = await screen.findByRole('textbox', { name: 'Score: Final exam' })
  await userEvent.type(cell, 'ninety')
  await userEvent.tab()
  expect(cell).toBeInvalid()
  expect(patches).toHaveLength(0)
})

test('plan mode simulates the assumed scores and shows the result without saving them', async () => {
  mount()
  await userEvent.click(await screen.findByRole('switch', { name: /Plan mode/ }))
  const assumed = await screen.findByRole('textbox', { name: 'Assumed score: Final exam' })
  await userEvent.type(assumed, '90')
  await userEvent.tab()
  const result = await screen.findByTestId('plan-result')
  await waitFor(() => expect(within(result).getByText('88%')).toBeInTheDocument())
  expect(simulations.at(-1)).toMatchObject({ scores: { a2: 90 } })
  expect(patches).toHaveLength(0)
  // A graded item has no assumption to make.
  expect(screen.queryByRole('textbox', { name: 'Assumed score: Quiz 1' })).not.toBeInTheDocument()
})

test('hide_gpa shows a mask until it is clicked', async () => {
  book = gradebook({ scale: { max_points: 4, hide_gpa: true } })
  mount()
  const mask = await screen.findByRole('button', { name: 'Show GPA' })
  expect(mask).toHaveTextContent('•••')
  expect(screen.queryByText('3.70')).not.toBeInTheDocument()
  await userEvent.click(mask)
  expect(await screen.findByText('3.70')).toBeInTheDocument()
})

test('dropped items stay in the table but are crossed out', async () => {
  book = gradebook({
    assessments: [assessment({ id: 'a1', title: 'Quiz 1', dropped: true, weight: 10 })],
  })
  mount()
  const row = (await screen.findByRole('textbox', { name: 'Weight (%): Quiz 1' })).closest('tr')
  expect(row).toHaveClass('line-through')
})

test('a Pass/Fail result can be set back to pending', async () => {
  const results: unknown[] = []
  server.use(
    http.patch(`${API}/courses/c1/grade`, async ({ request }) => {
      results.push(await request.json())
      return HttpResponse.json(book.result)
    }),
  )
  book = gradebook({
    result: { ...gradebook().result, basis: 'pass_fail', pass_fail_result: 'pass' },
  })
  mount()
  const pending = await screen.findByRole('button', { name: 'Pending' })
  await userEvent.click(pending)
  await waitFor(() => expect(results).toEqual([{ pass_fail_result: null }]))
})

test('deadlines show the Program-local date, not the browser-zone conversion', async () => {
  book = gradebook({
    assessments: [
      assessment({
        id: 'a1',
        title: 'Quiz 1',
        // End of 2026-10-18 in Toronto is already the 19th in Tokyo.
        due_at: '2026-10-19T03:59:59Z',
        due_date: '2026-10-18',
        due_time: null,
        due_has_time: false,
      }),
    ],
  })
  mount()
  expect(await screen.findByText('Oct 18, 2026')).toBeInTheDocument()
})
