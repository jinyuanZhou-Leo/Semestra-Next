import type { AssignmentDetail } from '@semestra/api-client'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { academicsHandlers, defaultWorld } from '@/modules/academics/test-data'
import { API, renderWithRouter, server } from '@/test-utils'
import AssignmentDialog from './AssignmentDialog'
import { assignmentHost } from './AssignmentHost'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const Host = assignmentHost(AssignmentDialog)

const LAB: AssignmentDetail = {
  provider: 'canvas',
  assignment: {
    external_id: 'a1',
    name: 'Lab 1',
    web_url: 'https://lms.example/a/a1',
    html:
      '<p>Implement a linked list. See ' +
      '<a href="https://lms.example/a/a2" data-lms-kind="assignment" data-lms-ref="a2">Lab 2</a>.</p>',
    points: 10,
    group_name: 'Labs',
    submission_types: ['online_upload'],
    rubric: [
      {
        id: 'r',
        description: 'Correctness',
        points: 10,
        ratings: [{ id: 'r1', description: 'Most tests pass', points: 8 }],
      },
    ],
  },
  submission: {
    external_id: 's1',
    assignment_id: 'a1',
    state: 'graded',
    score: 9,
    grade: '9',
    attempt: 2,
    submitted_at: '2026-02-05T20:00:00Z',
    files: [{ external_id: 'f1', name: 'lab1.c', mime_type: 'text/plain', size_bytes: 5 }],
    comments: [{ author: 'TA', comment: 'Check the edge cases.' }],
    rubric_scores: [{ criterion_id: 'r', points: 8, rating_id: 'r1' }],
  },
  assessment: { id: 'as1', weight: 5 },
  task: { id: 't1', completed: false },
  targets: [],
}

function mount(detail: AssignmentDetail, at = '/?assignment=c1:a1') {
  server.use(
    http.get(`${API}/lms/providers`, () =>
      HttpResponse.json({
        items: [
          {
            kind: 'canvas',
            display_name: 'Canvas',
            features: [],
            config_schema: {},
            credentials_schema: {},
            sign_in: false,
          },
        ],
      }),
    ),
    http.get(`${API}/programs/p1/lms-binding`, () =>
      HttpResponse.json({ program_id: 'p1', connection: null }),
    ),
    http.get(`${API}/programs/p1/grading-scale`, () => HttpResponse.json({ hide_grades: false })),
    ...academicsHandlers(defaultWorld()),
    http.get(`${API}/courses/c1/lms/assignments/:id`, ({ params }) =>
      HttpResponse.json({
        ...detail,
        assignment: { ...detail.assignment, external_id: String(params.id) },
      }),
    ),
  )
  return renderWithRouter(<Host />, undefined, { path: '/', at })
}

test('an assignment opens with its description, where the user is with it and its places in Semestra', async () => {
  const { router } = mount(LAB)
  const dialog = await screen.findByRole('dialog', { name: 'Lab 1' })
  expect(within(dialog).getByText(/Implement a linked list/)).toBeInTheDocument()
  expect(within(dialog).getByText(/Graded · 90%/)).toBeInTheDocument()
  expect(await within(dialog).findByRole('button', { name: 'Open in Canvas' })).toHaveAttribute(
    'href',
    'https://lms.example/a/a1',
  )

  // What was handed in and what the teacher said are the other tab.
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Submission and feedback' }))
  expect(within(dialog).getByText('Attempt 2')).toBeInTheDocument()
  expect(within(dialog).getByText('lab1.c')).toBeInTheDocument()
  expect(within(dialog).getByText('Check the edge cases.')).toBeInTheDocument()
  expect(within(dialog).getByRole('row', { name: /Correctness/ })).toHaveTextContent('8 / 10')

  // A link to another assignment opens that one here.
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Description' }))
  await userEvent.click(within(dialog).getByRole('link', { name: 'Lab 2' }))
  expect(router.state.location.search).toEqual({ assignment: 'c1:a2' })

  // Its gradebook row is one step away.
  await userEvent.click(within(dialog).getByRole('button', { name: /Gradebook/ }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/p/p1/c/c1/grades'))
  expect(router.state.location.search).toEqual({ assessment: 'as1' })
})

test('opened on the feedback, it says when what it shows was kept and closes into the page', async () => {
  const { router } = mount(
    { ...LAB, kept: true, kept_at: '2026-02-06T12:00:00Z', problem: 'lms.unreachable' },
    '/?assignment=c1:a1&view=feedback',
  )
  const dialog = await screen.findByRole('dialog', { name: 'Lab 1' })
  expect(await within(dialog).findByText('Check the edge cases.')).toBeInTheDocument()
  expect(within(dialog).getByText(/Can't reach Canvas/)).toBeInTheDocument()
  // Nothing to import from while the platform can't be asked.
  expect(within(dialog).queryByRole('button', { name: /Add to/ })).toBeNull()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
  expect(router.state.location.search).toEqual({})
})
