import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import type { Scope } from '@/app/extensions'
import { API, renderWithRouter, server } from '@/test-utils'
import { Toaster } from '@/ui/sonner'
import CourseGradesMobile from './mobile/CourseGradesMobile'
import CourseGradesPage from './pages/CourseGradesPage'
import { assessment, gradebook, gradingScale, summary } from './test-data'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const scope: Scope = { kind: 'course', programId: 'p1', courseId: 'c1' }

let book = gradebook()
let patches: { id: string; body: unknown }[] = []
let simulations: unknown[] = []
/** The course's to-dos, for the gradebook's to-do column (M05). */
let todos: Record<string, unknown>[] = []
let completes: { id: string; body: unknown }[] = []

beforeEach(() => {
  book = gradebook()
  patches = []
  simulations = []
  todos = []
  completes = []
  server.use(
    http.get(`${API}/programs/p1/tasks`, () =>
      HttpResponse.json({ items: todos, next_cursor: null, total: todos.length }),
    ),
    http.post(`${API}/tasks/:id\\:complete`, async ({ params, request }) => {
      completes.push({ id: String(params.id), body: await request.json() })
      todos = todos.map((t) =>
        t.id === params.id ? { ...t, completed_at: '2026-01-01T00:00:00Z' } : t,
      )
      return HttpResponse.json(todos.find((t) => t.id === params.id))
    }),
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.put(`${API}/me/ui-state/:key`, () => HttpResponse.json({ ok: true })),
    http.get(`${API}/courses/c1/gradebook`, () => HttpResponse.json(book)),
    http.get(`${API}/programs/p1/grading-scale`, () => HttpResponse.json(gradingScale())),
    // No LMS: the gradebook does not offer an import from it.
    http.get(`${API}/courses/c1/lms-link`, () =>
      HttpResponse.json({ course_id: 'c1', link: null, program_connection_id: null }),
    ),
    http.get(`${API}/programs/p1/lms/assignment-targets`, () => HttpResponse.json({ items: [] })),
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

/** The Undo button of the newest toast saying `text` (sonner lists the newest first and keeps toasts of earlier tests). */
const undoOf = async (text: string) => {
  const toasts = await screen.findAllByText(text)
  const item = toasts[0]?.closest('[data-sonner-toast]')
  if (!(item instanceof HTMLElement)) throw new Error(`no toast "${text}"`)
  return within(item).getByRole('button', { name: 'Undo' })
}

const mount = () =>
  renderWithRouter(
    <>
      <CourseGradesPage scope={scope} />
      <Toaster />
    </>,
  )

test('the summary shows the current grade and what the rest has to average', async () => {
  mount()
  const breakdown = await screen.findByRole('region', { name: 'Grade breakdown' })
  expect(within(breakdown).getByText('Current')).toBeInTheDocument()
  expect(within(breakdown).getAllByText('80%')).not.toHaveLength(0)
  expect(screen.getByRole('region', { name: 'Target GPA' })).toHaveTextContent('88.3%')
  expect(screen.getByRole('textbox', { name: 'Score: Quiz 1' })).toHaveValue('80')
})

test('the breakdown lists each category with its graded weight and average', async () => {
  book = gradebook({
    assessments: [
      assessment({
        id: 'a1',
        title: 'Midterm',
        weight: 40,
        score_percentage: 75,
        category_id: 'k1',
      }),
      assessment({ id: 'a2', title: 'Final exam', weight: 60, category_id: 'k1' }),
    ],
  })
  mount()
  const breakdown = await screen.findByRole('region', { name: 'Grade breakdown' })
  const row = within(breakdown).getByRole('row', { name: /Exam/ })
  expect(row).toHaveTextContent('40/100%')
  expect(row).toHaveTextContent('75%')
})

test('a breakdown row is reachable by keyboard and describes its category', async () => {
  book = gradebook({
    assessments: [
      assessment({
        id: 'a1',
        title: 'Midterm',
        weight: 40,
        score_percentage: 75,
        category_id: 'k1',
      }),
      assessment({ id: 'a2', title: 'Final exam', weight: 60, category_id: 'k1' }),
    ],
  })
  mount()
  const breakdown = await screen.findByRole('region', { name: 'Grade breakdown' })
  const row = within(breakdown).getByRole('row', { name: /Exam/ })
  expect(row).toHaveAttribute('tabindex', '0')
  expect(row).toHaveAccessibleDescription(/Adds to grade: 30%/)
})

test('weights that do not add up to 100 hold back planning without a warning', async () => {
  book = gradebook({
    summary: summary({
      weights_ok: false,
      weight_total: 80,
      weight_gap: 20,
      current_percentage: null,
    }),
  })
  mount()
  expect(await screen.findByRole('button', { name: 'Plan' })).toBeDisabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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
  await userEvent.click(await screen.findByRole('button', { name: 'Plan' }))
  const assumed = await screen.findByRole('textbox', { name: 'Assumed score: Final exam' })
  await userEvent.type(assumed, '90')
  await userEvent.tab()
  const result = await screen.findByRole('region', { name: 'Planned grade' })
  await waitFor(() => expect(within(result).getByText('88%')).toBeInTheDocument())
  // Entering plan mode simulates at once; the typed assumption follows after the debounce.
  await waitFor(() => expect(simulations.at(-1)).toMatchObject({ scores: { a2: 90 } }))
  expect(patches).toHaveLength(0)
  // A graded item has no assumption to make.
  expect(screen.queryByRole('textbox', { name: 'Assumed score: Quiz 1' })).not.toBeInTheDocument()
})

test('plan mode replaces the toolbar; clearing the assumptions can be undone', async () => {
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Plan' }))
  expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
  const assumed = await screen.findByRole('textbox', { name: 'Assumed score: Final exam' })
  await userEvent.type(assumed, '90')
  await userEvent.tab()
  await userEvent.click(screen.getByRole('button', { name: 'Clear assumptions' }))
  expect(screen.getByRole('textbox', { name: 'Assumed score: Final exam' })).toHaveValue('')
  // Sonner captures the pointer on press, which jsdom lacks; a plain click is enough here.
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Assumed score: Final exam' })).toHaveValue('90'),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Exit plan mode' }))
  expect(await screen.findByRole('button', { name: 'Add' })).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: /Assumed score/ })).not.toBeInTheDocument()
})

test('undoing a clear brings back only the assumptions, not plan mode', async () => {
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Plan' }))
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Assumed score: Final exam' }),
    '90',
  )
  await userEvent.tab()
  await userEvent.click(screen.getByRole('button', { name: 'Clear assumptions' }))
  await userEvent.click(screen.getByRole('button', { name: 'Exit plan mode' }))
  fireEvent.click(await undoOf('Assumptions cleared'))
  await userEvent.click(await screen.findByRole('button', { name: 'Plan' }))
  expect(await screen.findByRole('textbox', { name: 'Assumed score: Final exam' })).toHaveValue(
    '90',
  )
})

test('the official grade is entered from the more menu', async () => {
  const results: unknown[] = []
  server.use(
    http.patch(`${API}/courses/c1/grade`, async ({ request }) => {
      results.push(await request.json())
      return HttpResponse.json(book.result)
    }),
  )
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Enter official grade…' }))
  const dialog = await screen.findByRole('dialog')
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Percentage' }), '86.5')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(results).toEqual([{ final_override_percentage: 86.5 }]))
})

test('clearing the official grade can be undone', async () => {
  const results: unknown[] = []
  book = gradebook()
  book.result.final_override_percentage = 91
  server.use(
    http.patch(`${API}/courses/c1/grade`, async ({ request }) => {
      results.push(await request.json())
      return HttpResponse.json(book.result)
    }),
  )
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Clear official grade' }))
  fireEvent.click(await undoOf('Official grade cleared'))
  await waitFor(() =>
    expect(results).toEqual([
      { final_override_percentage: null },
      { final_override_percentage: 91 },
    ]),
  )
})

test('grouped view heads each category with its weight and average', async () => {
  book = gradebook({
    assessments: [
      assessment({
        id: 'a1',
        title: 'Midterm',
        weight: 40,
        score_percentage: 75,
        category_id: 'k1',
      }),
      assessment({ id: 'a2', title: 'Final exam', weight: 60, category_id: 'k1' }),
    ],
  })
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }))
  await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Group by category' }))
  const heading = await screen.findByRole('button', { name: /2 items · 40% graded/ })
  const row = heading.closest('tr')
  expect(row).toHaveTextContent('100')
  expect(row).toHaveTextContent('Average: 75%')
})

test('hide_grades shows a mask until it is hovered', async () => {
  book = gradebook({ scale: { max_points: 4, hide_grades: true, round_before_lookup: true } })
  mount()
  const masks = await screen.findAllByLabelText('Show grade')
  for (const mask of masks) expect(mask).toHaveTextContent('•••')
  // Percentages are masked with the GPA.
  expect(screen.queryByText('91%')).not.toBeInTheDocument()
  expect(screen.queryByText('3.70')).not.toBeInTheDocument()
  // The letter would give the GPA away, so it is masked with it.
  expect(screen.queryByText('A-')).not.toBeInTheDocument()
  // Its choices are only thresholds then, so the target is a grade, not a GPA.
  expect(screen.getByRole('combobox', { name: 'Target grade' })).toBeInTheDocument()
  for (const mask of masks) await userEvent.hover(mask)
  expect(await screen.findByText('3.70')).toBeInTheDocument()
  expect(screen.getByText('A-')).toBeInTheDocument()
})

test('plan mode shows no planned grade while some items have no assumption', async () => {
  server.use(
    http.post(`${API}/courses/c1/gradebook\\:simulate`, () =>
      HttpResponse.json(summary({ current_percentage: 80, remaining_count: 1 })),
    ),
  )
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Plan' }))
  const result = await screen.findByRole('region', { name: 'Planned grade' })
  // The average of the graded part (80%) is not a planned grade.
  await waitFor(() => expect(result.querySelector('.text-2xl')).toHaveTextContent('—'))
})

test('a link to an assessment marks its row', async () => {
  const { router } = mount()
  await screen.findByRole('textbox', { name: 'Weight (%): Final exam' })
  await router.navigate({ to: '/', search: { assessment: 'a2' } })
  const row = screen.getByRole('textbox', { name: 'Weight (%): Final exam' }).closest('tr')
  await waitFor(() => expect(row).toHaveAttribute('data-highlighted'))
})

test('a link to an assessment in a collapsed group shows its row', async () => {
  const { router } = mount()
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }))
  await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Group by category' }))
  await userEvent.click(await screen.findByRole('button', { name: /Exam/ }))
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: 'Weight (%): Final exam' })).toBeNull(),
  )
  await router.navigate({ to: '/', search: { assessment: 'a2' } })
  const field = await screen.findByRole('textbox', { name: 'Weight (%): Final exam' })
  expect(field.closest('tr')).toHaveAttribute('data-highlighted')
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
  expect(await screen.findByText(/^Oct 18/)).toBeInTheDocument()
})

test('the status filter and the search narrow the table, and clearing them brings rows back', async () => {
  mount()
  await screen.findByRole('textbox', { name: 'Score: Final exam' })
  await userEvent.click(screen.getByRole('button', { name: 'Graded' }))
  expect(screen.queryByRole('textbox', { name: 'Score: Final exam' })).toBeNull()
  expect(screen.getByRole('textbox', { name: 'Score: Quiz 1' })).toBeInTheDocument()
  await userEvent.type(screen.getByRole('textbox', { name: 'Search assessments' }), 'final')
  expect(await screen.findByText('No matching assessments')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(await screen.findByRole('textbox', { name: 'Score: Final exam' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Search assessments' })).toHaveValue('')
})

test('picking a target from the scale saves it as the course target', async () => {
  const results: unknown[] = []
  server.use(
    http.patch(`${API}/courses/c1/grade`, async ({ request }) => {
      results.push(await request.json())
      return HttpResponse.json(book.result)
    }),
  )
  mount()
  await userEvent.click(await screen.findByRole('combobox', { name: 'Target GPA' }))
  await userEvent.click(await screen.findByRole('option', { name: /3\.7 · A-/ }))
  await waitFor(() => expect(results).toEqual([{ target_points: 3.7 }]))
})

test("an assessment's to-do is checked off from its row", async () => {
  todos = [
    {
      id: 't2',
      program_id: 'p1',
      term_id: null,
      course_id: 'c1',
      list_id: null,
      title: 'APS105H1 · Final exam',
      notes: '',
      due_date: '2026-04-20',
      due_time: null,
      priority: 'medium',
      flagged: false,
      completed_at: null,
      position: 1,
      source_kind: 'manual',
      source_ref: null,
      assessment_id: 'a2',
      overdue: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ]
  mount()
  const check = await screen.findByRole('checkbox', { name: 'Complete APS105H1 · Final exam' })
  // Quiz 1 has no to-do (no due date): a dash.
  const quiz = screen.getByText('Quiz 1').closest('tr')!
  expect(within(quiz).queryByRole('checkbox', { name: /^Complete/ })).toBeNull()
  await userEvent.click(check)
  await waitFor(() => expect(completes).toEqual([{ id: 't2', body: { completed: true } }]))
  await waitFor(() => expect(check.getAttribute('aria-checked')).toBe('true'))
})

test("an assessment from the LMS opens the assignment's details, or the teacher's feedback", async () => {
  book = gradebook({
    assessments: [
      assessment({ id: 'a1', title: 'Lab 1', weight: 20, source_kind: 'lms', source_ref: '91' }),
      assessment({ id: 'a3', title: 'Lab 2', weight: 20, source_kind: 'lms', source_ref: '92' }),
      assessment({ id: 'a2', title: 'Final exam', weight: 60 }),
    ],
  })
  const target = { course_id: 'c1', task_id: null, state: null, marks: [] }
  server.use(
    // Read from Semestra (kept by the sync), never from the platform.
    http.get(`${API}/programs/p1/lms/assignment-targets`, () =>
      HttpResponse.json({
        items: [
          { ...target, assignment_id: '91', assessment_id: 'a1', feedback: true },
          { ...target, assignment_id: '92', assessment_id: 'a3', feedback: false },
        ],
      }),
    ),
  )
  const { router } = mount()
  await userEvent.click(await screen.findByRole('button', { name: 'View assignment: Lab 2' }))
  expect(router.state.location.search).toEqual({ assignment: 'c1:92' })
  // Where the teacher left feedback, the button opens the details on it (M09 §7.3).
  await userEvent.click(screen.getByRole('button', { name: 'View feedback: Lab 1' }))
  expect(router.state.location.search).toEqual({ assignment: 'c1:91', view: 'feedback' })
  // An assessment of Semestra's own has neither.
  const exam = screen.getByText('Final exam').closest('tr')!
  expect(within(exam).queryByRole('button', { name: /^View / })).toBeNull()
})

test('a gradebook without assignments of the LMS has no submission column', async () => {
  mount()
  await screen.findByRole('textbox', { name: 'Score: Final exam' })
  expect(screen.queryByRole('columnheader', { name: 'Submission' })).toBeNull()
})

test('checked assessments are changed and deleted together, only the ones on screen', async () => {
  const updates: unknown[] = []
  const deletes: unknown[] = []
  server.use(
    http.post(`${API}/courses/c1/assessments\\:update`, async ({ request }) => {
      updates.push(await request.json())
      return HttpResponse.json({ updated: [] })
    }),
    http.post(`${API}/courses/c1/assessments\\:delete`, async ({ request }) => {
      deletes.push(await request.json())
      return HttpResponse.json({ ok: true })
    }),
  )
  mount()
  await screen.findByRole('textbox', { name: 'Score: Final exam' })
  const toolbar = screen.getByRole('toolbar', { hidden: true })
  expect(toolbar).toHaveAttribute('inert')

  // Hidden by the filter: "Select all" leaves the final exam out.
  await userEvent.click(screen.getByRole('button', { name: 'Graded' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
  await waitFor(() => expect(toolbar).not.toHaveAttribute('inert'))
  expect(within(toolbar).getByText('1 selected')).toBeInTheDocument()
  await userEvent.click(within(toolbar).getByRole('button', { name: 'Category' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Exam' }))
  await waitFor(() => expect(updates).toEqual([{ assessment_ids: ['a1'], category_id: 'k1' }]))

  await userEvent.click(screen.getByRole('button', { name: 'All' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select: Final exam' }))
  expect(within(toolbar).getByText('2 selected')).toBeInTheDocument()
  // Esc closes the menu on top, and leaves the selection alone.
  await userEvent.click(within(toolbar).getByRole('button', { name: 'Category' }))
  await screen.findByRole('menu')
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  expect(within(toolbar).getByText('2 selected')).toBeInTheDocument()
  await userEvent.click(within(toolbar).getByRole('button', { name: 'Weight' }))
  const dialog = await screen.findByRole('dialog', { name: 'Set weight' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Split a total' }))
  await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Total weight' }))
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Total weight' }), '50')
  expect(within(dialog).getByText('About 25% each')).toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(updates[1]).toEqual({ assessment_ids: ['a1', 'a2'], total_weight: 50 }),
  )

  await userEvent.click(within(toolbar).getByRole('button', { name: 'Delete' }))
  const confirm = await screen.findByRole('alertdialog')
  await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(deletes).toEqual([{ assessment_ids: ['a1', 'a2'] }]))
  await waitFor(() => expect(toolbar).toHaveAttribute('inert'))
})

test('the submission column and the filters follow the platform, else the due date', async () => {
  const day = 86_400_000
  const lms = (id: string, title: string, ref: string) =>
    assessment({ id, title, weight: 10, source_kind: 'lms', source_ref: ref })
  book = gradebook({
    assessments: [
      lms('a1', 'Lab 1', '91'),
      lms('a2', 'Lab 2', '92'),
      lms('a3', 'Lab 3', '93'),
      // Graded on the platform, but the score isn't in the gradebook yet.
      lms('a7', 'Lab 4', '94'),
      // The sync hasn't read the submission yet: its due date decides.
      assessment({
        id: 'a8',
        title: 'Lab 5',
        weight: 10,
        source_kind: 'lms',
        source_ref: '95',
        due_at: new Date(Date.now() + 3 * day).toISOString(),
      }),
      assessment({
        id: 'a4',
        title: 'Essay',
        weight: 10,
        due_at: new Date(Date.now() + 3 * day).toISOString(),
      }),
      assessment({
        id: 'a5',
        title: 'Midterm',
        weight: 30,
        due_at: new Date(Date.now() - 3 * day).toISOString(),
      }),
      assessment({
        id: 'a6',
        title: 'Final exam',
        weight: 30,
        status: 'graded',
        score_percentage: 80,
      }),
    ],
  })
  const target = { course_id: 'c1', task_id: null, feedback: false, due_state: 'none' }
  server.use(
    http.get(`${API}/programs/p1/lms/assignment-targets`, () =>
      HttpResponse.json({
        items: [
          {
            ...target,
            assignment_id: '91',
            assessment_id: 'a1',
            state: 'submitted',
            marks: ['late'],
          },
          { ...target, assignment_id: '92', assessment_id: 'a2', state: 'missing', marks: [] },
          { ...target, assignment_id: '93', assessment_id: 'a3', state: 'excused', marks: [] },
          { ...target, assignment_id: '94', assessment_id: 'a7', state: 'graded', marks: [] },
          { ...target, assignment_id: '95', assessment_id: 'a8', state: null, marks: [] },
        ],
      }),
    ),
  )
  mount()
  const lab1 = (await screen.findByText('Lab 1')).closest('tr')!
  expect(await screen.findByRole('columnheader', { name: 'Submission' })).toBeInTheDocument()
  expect(await within(lab1).findByText('Submitted')).toBeInTheDocument()
  expect(within(lab1).getByText('Late')).toBeInTheDocument()
  expect(within(screen.getByText('Lab 2').closest('tr')!).getByText('Missing')).toBeInTheDocument()

  const shown = () =>
    ['Lab 1', 'Lab 2', 'Lab 3', 'Lab 4', 'Lab 5', 'Essay', 'Midterm', 'Final exam'].filter((t) =>
      screen.queryByText(t),
    )
  await userEvent.click(screen.getByRole('button', { name: 'To do' }))
  expect(shown()).toEqual(['Lab 2', 'Lab 5', 'Essay'])
  await userEvent.click(screen.getByRole('button', { name: 'Awaiting grade' }))
  expect(shown()).toEqual(['Lab 1', 'Lab 4', 'Midterm'])
  await userEvent.click(screen.getByRole('button', { name: 'Graded' }))
  expect(shown()).toEqual(['Final exam'])
  // Excused is in no filter but All.
  await userEvent.click(screen.getByRole('button', { name: 'All' }))
  expect(shown()).toHaveLength(8)
})

// Like the other number columns, highest first.
test('the score column sorts by score', async () => {
  book = gradebook({
    assessments: [
      assessment({ id: 'a1', title: 'Lab 1', status: 'graded', score_percentage: 80 }),
      assessment({ id: 'a2', title: 'Lab 2', status: 'graded', score_percentage: 60 }),
      assessment({ id: 'a3', title: 'Lab 3', status: 'graded', score_percentage: 95 }),
    ],
  })
  mount()
  await screen.findByText('Lab 1')
  const order = () =>
    screen
      .getAllByRole('row')
      .map((row) => within(row).queryByText(/^Lab \d$/)?.textContent)
      .filter(Boolean)
  await userEvent.click(screen.getByRole('button', { name: 'Score' }))
  expect(order()).toEqual(['Lab 3', 'Lab 1', 'Lab 2'])
  await userEvent.click(screen.getByRole('button', { name: 'Score' }))
  expect(order()).toEqual(['Lab 2', 'Lab 1', 'Lab 3'])
})

test('an assessment from the LMS opens its assignment on the platform from the row menu', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  book = gradebook({
    assessments: [
      assessment({ id: 'a1', title: 'Lab 1', source_kind: 'lms', source_ref: '91' }),
      assessment({ id: 'a2', title: 'Final exam' }),
    ],
  })
  server.use(
    http.get(`${API}/programs/p1/lms/assignment-targets`, () =>
      HttpResponse.json({
        items: [
          {
            course_id: 'c1',
            task_id: null,
            assignment_id: '91',
            assessment_id: 'a1',
            feedback: false,
            state: 'unsubmitted',
            marks: [],
            web_url: 'https://canvas.example.edu/courses/1/assignments/91',
          },
        ],
      }),
    ),
  )
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Actions: Lab 1' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Open in LMS' }))
  expect(open).toHaveBeenCalledWith(
    'https://canvas.example.edu/courses/1/assignments/91',
    '_blank',
    'noopener,noreferrer',
  )
  await userEvent.keyboard('{Escape}')
  await userEvent.click(screen.getByRole('button', { name: 'Actions: Final exam' }))
  await screen.findAllByRole('menuitem')
  expect(screen.queryByRole('menuitem', { name: 'Open in LMS' })).toBeNull()
  open.mockRestore()
})

test('on a phone a Pass/Fail course and one graded by hand show that grade, as on a computer', async () => {
  book = gradebook({
    result: { ...gradebook().result, basis: 'pass_fail', pass_fail_result: 'pass' },
    assessments: [assessment({ id: 'a1', title: 'Quiz 1' })],
  })
  const { unmount } = renderWithRouter(<CourseGradesMobile scope={scope} />)
  expect(await screen.findByText('Pass')).toBeInTheDocument()
  // The gradebook does not count, so it is not listed.
  expect(screen.queryByText('Quiz 1')).not.toBeInTheDocument()
  unmount()

  book = gradebook({
    result: { ...gradebook().result, gradebook_enabled: false, manual_percentage: 91 },
    summary: summary({ final_percentage: 91, final_letter: 'A+', final_points: 4 }),
  })
  renderWithRouter(<CourseGradesMobile scope={scope} />)
  expect(await screen.findByText('Final grade')).toBeInTheDocument()
  expect(screen.getByText('91%')).toBeInTheDocument()
  expect(screen.queryByText('No assessments yet')).not.toBeInTheDocument()
})
