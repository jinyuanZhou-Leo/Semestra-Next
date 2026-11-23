import type { AssignmentDetail } from '@semestra/api-client'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { academicsHandlers, defaultWorld } from '@/modules/academics/test-data'
import { API, renderWithRouter, server } from '@/test-utils'
import AssignmentDialog from './AssignmentDialog'
import { assignmentHost } from './AssignmentHost'
import AssignmentSheet from '../mobile/AssignmentSheet'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const Host = assignmentHost(AssignmentDialog)
const PhoneHost = assignmentHost(AssignmentSheet)

const LAB: AssignmentDetail = {
  provider: 'canvas',
  source: 'live',
  as_of: null,
  due_state: 'none',
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
    online: true,
    is_quiz: false,
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
    status: 'graded',
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
  state: 'graded',
}

function mount(
  detail: AssignmentDetail,
  at = '/?assignment=c1:a1',
  View = Host,
  first: Parameters<typeof server.use> = [],
) {
  server.use(
    ...first,
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
  return renderWithRouter(<View />, undefined, { path: '/', at })
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

test('a missing assignment says it is missing, not when it was due', async () => {
  mount({
    ...LAB,
    state: 'missing',
    due_state: 'overdue',
    assignment: { ...LAB.assignment, due_at: '2026-02-01T20:00:00Z' },
    submission: { external_id: 's1', assignment_id: 'a1', status: 'unsubmitted', missing: true },
  })
  const dialog = await screen.findByRole('dialog', { name: 'Lab 1' })
  expect(await within(dialog).findByText('Missing')).toBeInTheDocument()
  expect(within(dialog).queryByText('Overdue')).toBeNull()
})

test('what was kept for an assessment says so, offers no import and closes into the page', async () => {
  let asked: string | null = null
  const held = { ...LAB, source: 'mirror', as_of: '2026-02-06T12:00:00Z', held: true } as const
  const { router } = mount(held, '/?assignment=c1:a1&view=feedback&held=assessment:as1', Host, [
    http.get(`${API}/courses/c1/lms/assignments/:id`, ({ request }) => {
      asked = new URL(request.url).searchParams.get('held_for')
      return HttpResponse.json(held)
    }),
  ])
  const dialog = await screen.findByRole('dialog', { name: 'Lab 1' })
  expect(await within(dialog).findByText('Check the edge cases.')).toBeInTheDocument()
  expect(asked).toBe('assessment:as1')
  expect(within(dialog).getByText(/no longer follows Canvas/)).toBeInTheDocument()
  // Nothing to import or ask again: it no longer follows the platform.
  expect(within(dialog).queryByRole('button', { name: /Add to/ })).toBeNull()
  expect(within(dialog).queryByRole('button', { name: 'Refresh' })).toBeNull()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
  expect(router.state.location.search).toEqual({})
})

test('kept by the sync, refresh syncs the course; read now, refresh reads it again', async () => {
  const synced: unknown[] = []
  const refreshed: string[] = []
  const kept = { ...LAB, source: 'mirror', as_of: '2026-02-06T12:00:00Z', sync_failed: true } as const
  mount(kept, undefined, Host, [
    http.post(`${API}/programs/p1/lms/sync`, async ({ request }) => {
      synced.push(await request.json())
      return HttpResponse.json({ queued: 1 })
    }),
    http.get(`${API}/courses/c1/lms/assignments/:id`, ({ params, request }) => {
      if (params.id === 'a1') return HttpResponse.json(kept)
      refreshed.push(new URL(request.url).searchParams.get('refresh') ?? '')
      return HttpResponse.json({ ...LAB, assignment: { ...LAB.assignment, external_id: 'a2' } })
    }),
  ])
  const dialog = await screen.findByRole('dialog', { name: 'Lab 1' })
  expect(await within(dialog).findByText(/last sync of assignments from Canvas/)).toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Refresh' }))
  await waitFor(() => expect(synced).toEqual([{ course_id: 'c1', stages: ['assignments'] }]))

  await userEvent.click(within(dialog).getByRole('link', { name: 'Lab 2' }))
  expect(await within(dialog).findByText(/Implement a linked list/)).toBeInTheDocument()
  expect(within(dialog).queryByText(/last sync/)).toBeNull() // read now: nothing to explain
  await userEvent.click(within(dialog).getByRole('button', { name: 'Refresh' }))
  await waitFor(() => expect(refreshed).toContain('true'))
})

test('an assignment no longer on the platform says so, with nothing to retry', async () => {
  mount(LAB, undefined, Host, [
    // The platform is named by the Program's connection: the read gave nothing.
    http.get(`${API}/programs/p1/lms-binding`, () =>
      HttpResponse.json({ program_id: 'p1', connection: { provider: 'canvas' } }),
    ),
    http.get(`${API}/courses/c1/lms/assignments/:id`, () =>
      HttpResponse.json(
        { error: { code: 'lms.not_found', params: {}, request_id: 'r' } },
        { status: 404 },
      ),
    ),
  ])
  expect(await screen.findByText('This assignment is no longer on Canvas')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
})

test('on a phone, a link to a course file opens the file itself: the phone has no files page', async () => {
  const { router } = mount(
    {
      ...LAB,
      assignment: {
        ...LAB.assignment,
        html: '<p><a href="https://lms.example/files/77" data-lms-kind="file" data-lms-ref="77">starter code</a></p>',
      },
      targets: [
        {
          kind: 'file',
          ref: '77',
          target: { kind: 'file', id: 'f1', course_id: 'c1', folder_id: 'd1' },
        },
      ],
    },
    '/?assignment=c1:a1',
    PhoneHost,
  )
  const opened = vi.spyOn(window, 'open').mockReturnValue(null)
  await userEvent.click(await screen.findByRole('link', { name: 'starter code' }))
  expect(opened).toHaveBeenCalledWith(
    `${API}/courses/c1/lms/files/77/content`,
    '_blank',
    'noopener,noreferrer',
  )
  opened.mockRestore()
  // The details stay open.
  expect(router.state.location.search).toEqual({ assignment: 'c1:a1' })
})
