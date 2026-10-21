import type { ImportItem, ImportSessionDetail } from '@semestra/api-client'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { API, renderWithRouter, server } from '@/test-utils'
import { ImportDialog } from './components/ImportDialog'
import { SessionView } from './components/SessionView'
import { wizardSource } from './entries'
import { errorMessage } from '@/lib/errors'
import { itemDetail } from './labels'
import { finishImport, openImport } from './launcher'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function item(
  overrides: Partial<ImportItem> & Pick<ImportItem, 'id' | 'type' | 'data'>,
): ImportItem {
  return {
    session_id: 's1',
    evidence: {},
    confidence: {},
    decision: 'accept',
    issues: [],
    depends_on: [],
    result: null,
    position: 0,
    ...overrides,
  }
}

function session(overrides: Partial<ImportSessionDetail> = {}): ImportSessionDetail {
  return {
    id: 's1',
    program_id: 'p1',
    source_kind: 'syllabus',
    target: { kind: 'course', course_id: 'c1' },
    status: 'ready',
    job_id: null,
    source_refs: [{ upload_id: 'u1', filename: 'mat137.pdf', status: 'done' }],
    source_meta: {},
    summary: { counts: { assessment: 2 }, accepted: { assessment: 2 }, issues: {} },
    error_code: null,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    committed_at: null,
    items: [
      item({
        id: 'a1',
        type: 'assessment',
        data: { course_ref: 'course:c1', title: 'Midterm', weight: 30, due_text: 'Week 7' },
        issues: [{ code: 'import.date_unresolved', params: { text: 'Week 7' } }],
        evidence: { title: { upload_id: 'u1', page: 2, quote: 'Midterm 30%' } },
        confidence: { weight: 'low' },
      }),
      item({
        id: 'a2',
        type: 'assessment',
        position: 1,
        data: { course_ref: 'course:c1', title: 'Final exam', weight: 70, due_date: '2026-12-15' },
      }),
    ],
    ...overrides,
  }
}

function courses() {
  return http.get(`${API}/programs/p1/courses`, () =>
    HttpResponse.json({ items: [{ id: 'c1', code: 'MAT137Y1', title: 'Calculus' }] }),
  )
}

test('the review groups items by course, marks problems and filters to them', async () => {
  server.use(courses())
  renderWithRouter(
    <SessionView
      session={session({ summary: { issues: { 'import.date_unresolved': 1 } } })}
      mode="direct"
      onDone={() => {}}
    />,
  )
  expect(await screen.findByText('1 dates to check')).toBeInTheDocument()
  expect(await screen.findByRole('region', { name: 'MAT137Y1 · Calculus' })).toBeInTheDocument()
  // The first item is selected: its issue and the evidence of its title are shown.
  // Once on the row (its tooltip text) and once in the editor.
  expect(screen.getAllByText('Couldn\'t work out the date "Week 7"')).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Where Title came from' })).toBeInTheDocument()

  await userEvent.click(screen.getByRole('switch', { name: 'Only items with problems' }))
  expect(screen.queryByText('Final exam')).toBeNull()
  expect(screen.getAllByText('Midterm').length).toBeGreaterThan(0)
})

test('saving commits the accepted items and reports what was written', async () => {
  server.use(courses())
  const commit = vi.fn<(body: unknown) => void>()
  server.use(
    http.post(`${API}/imports/s1:commit`, async ({ request }) => {
      commit(await request.json())
      const done = session({
        status: 'committed',
        summary: { created: 2, updated: 0 },
        items: session().items.map((i) => ({ ...i, result: { created_id: `x-${i.id}` } })),
      })
      return HttpResponse.json({ session: done, created: 2, updated: 0, failed: 0 })
    }),
  )
  const onDone = vi.fn<(session: ImportSessionDetail | null) => void>()
  renderWithRouter(<SessionView session={session()} mode="direct" onDone={onDone} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Save 2 items' }))
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(commit).toHaveBeenCalledWith({})
  expect(onDone.mock.calls[0]?.[0]).toMatchObject({ status: 'committed' })
})

test('turning an item off rejects it', async () => {
  server.use(courses())
  const update = vi.fn<(body: unknown) => void>()
  server.use(
    http.patch(`${API}/imports/s1/items/a2`, async ({ request }) => {
      update(await request.json())
      return HttpResponse.json(session())
    }),
  )
  renderWithRouter(<SessionView session={session()} mode="direct" onDone={() => {}} />)
  const group = await screen.findByRole('region', { name: 'MAT137Y1 · Calculus' })
  await userEvent.click(within(group).getByRole('switch', { name: 'Import Final exam' }))
  await waitFor(() => expect(update).toHaveBeenCalledWith({ decision: 'reject' }))
})

test('discarding asks first', async () => {
  server.use(courses())
  const discard = vi.fn<() => void>()
  server.use(
    http.post(`${API}/imports/s1:discard`, () => {
      discard()
      return HttpResponse.json({ ...session(), status: 'discarded' })
    }),
  )
  const onDone = vi.fn<(session: ImportSessionDetail | null) => void>()
  renderWithRouter(<SessionView session={session()} mode="direct" onDone={onDone} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))
  expect(discard).not.toHaveBeenCalled()
  const dialog = await screen.findByRole('alertdialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }))
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(null))
  expect(discard).toHaveBeenCalled()
})

test('the wizard source turns accepted courses into drafts and commits them once created', async () => {
  const wizardSession = session({
    target: { kind: 'term_wizard' },
    items: [
      item({
        id: 'k1',
        type: 'course',
        data: { code: 'MAT137Y1', title: 'Calculus', planned_terms: 2 },
      }),
      item({ id: 'k2', type: 'course', decision: 'reject', data: { title: 'Duplicate' } }),
    ],
  })
  const source = wizardSource('syllabus')
  const drafts = source.launch({ programId: 'p1', startDate: '2026-09-01', endDate: '2026-12-20' })
  finishImport({ session: wizardSession })
  const result = await drafts
  expect(result).toEqual([
    expect.objectContaining({
      code: 'MAT137Y1',
      title: 'Calculus',
      plannedTerms: 2,
      extras: { importSessionId: 's1', importItemId: 'k1' },
    }),
  ])

  const commit = vi.fn<(body: unknown) => void>()
  server.use(
    http.post(`${API}/imports/s1:commit`, async ({ request }) => {
      commit(await request.json())
      return HttpResponse.json({ session: wizardSession, created: 1, updated: 0, failed: 0 })
    }),
  )
  await source.onCoursesCreated?.([{ draft: result[0]!, courseId: 'new-course' }])
  expect(commit).toHaveBeenCalledWith({
    wizard_courses: [{ item_id: 'k1', course_id: 'new-course' }],
  })
})

test('opening a second import cancels the first', async () => {
  const first = openImport({
    programId: 'p1',
    source: 'ics',
    target: { kind: 'term_wizard' },
    mode: 'wizard',
  })
  const second = openImport({
    programId: 'p1',
    source: 'text',
    target: { kind: 'term_wizard' },
    mode: 'wizard',
  })
  expect(await first).toBeNull()
  finishImport(null)
  expect(await second).toBeNull()
})

test('an edit is saved on blur and the commit waits for it', async () => {
  server.use(courses())
  const calls: string[] = []
  server.use(
    http.patch(`${API}/imports/s1/items/a1`, async ({ request }) => {
      calls.push(`patch ${JSON.stringify(await request.json())}`)
      return HttpResponse.json(session())
    }),
    http.post(`${API}/imports/s1:commit`, () => {
      calls.push('commit')
      return HttpResponse.json({
        session: session({ status: 'committed' }),
        created: 2,
        updated: 0,
        failed: 0,
      })
    }),
  )
  renderWithRouter(<SessionView session={session()} mode="direct" onDone={() => {}} />)
  const weight = await screen.findByLabelText('Weight (%)')
  await userEvent.clear(weight)
  await userEvent.type(weight, '35')
  await userEvent.click(screen.getByRole('button', { name: 'Save 2 items' }))
  await waitFor(() => expect(calls).toEqual(['patch {"data":{"weight":35}}', 'commit']))
})

test('a meeting shows how many of its dates are cancelled', () => {
  const meeting = item({
    id: 'm1',
    type: 'meeting',
    data: {
      course_ref: 'item:c1',
      weekday: 1,
      start_time: '10:00:00',
      end_time: '11:00:00',
      location: 'BA 1180',
      exceptions: ['2026-10-12', '2026-10-26'],
    },
  })
  expect(itemDetail(meeting)).toBe('10:00–11:00 · BA 1180 · 2 cancelled dates')
})

// The upload goes through XMLHttpRequest, which jsdom treats as cross-origin to the API.
const CORS = {
  'Access-Control-Allow-Origin': window.location.origin,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Headers': '*',
}

function upload(delayMs = 0) {
  return [
    http.options(
      `${API}/imports/uploads`,
      () => new HttpResponse(null, { status: 204, headers: CORS }),
    ),
    http.post(`${API}/imports/uploads`, async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      return HttpResponse.json(
        { id: 'u1', filename: 'plan.ics', mime_type: 'text/calendar', size_bytes: 4 },
        { headers: CORS },
      )
    }),
  ]
}

function icsRequest(source: 'ics' | 'syllabus' = 'ics') {
  return {
    programId: 'p1',
    source,
    target: { kind: 'course', course_id: 'c1' },
    mode: 'direct',
  } as const
}

async function pickFile(name = 'plan.ics') {
  await userEvent.upload(
    document.querySelector<HTMLInputElement>('input[type=file]')!,
    new File(['x'], name),
  )
}

test('the Read button shows the upload and the extraction, then opens the review', async () => {
  const extracting = session({ status: 'extracting', job_id: 'j1', items: [] })
  const states = [extracting, session()]
  server.use(
    courses(),
    ...upload(),
    http.post(`${API}/programs/p1/imports`, () => HttpResponse.json(extracting)),
    http.get(`${API}/imports/s1`, () =>
      HttpResponse.json(states.length > 1 ? states.shift() : states[0]),
    ),
    http.get(`${API}/jobs/j1`, () =>
      HttpResponse.json({
        id: 'j1',
        kind: 'imports.extract',
        status: 'running',
        progress: 50,
        step: null,
        step_current: null,
        step_total: null,
        attempts: 1,
        cancel_requested: false,
      }),
    ),
  )
  const closed = vi.fn<(outcome: unknown) => void>()
  renderWithRouter(
    <ImportDialog
      request={{
        programId: 'p1',
        source: 'ics',
        target: { kind: 'course', course_id: 'c1' },
        mode: 'direct',
      }}
      onClose={closed}
    />,
  )
  const read = await screen.findByRole('button', { name: 'Read' })
  expect(read).toBeDisabled()
  await userEvent.upload(
    document.querySelector<HTMLInputElement>('input[type=file]')!,
    new File(['x'], 'plan.ics'),
  )
  await userEvent.click(read)
  // The files stay listed with their state while the button carries the progress.
  expect(await screen.findByText('mat137.pdf')).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: /Working…, 60%/ })).toBeDisabled()
  expect(await screen.findAllByText('Midterm', {}, { timeout: 8000 })).not.toHaveLength(0)
}, 15_000)

test('stopping during the upload shows no error and never creates the session', async () => {
  const create = vi.fn<() => void>()
  server.use(
    ...upload(5_000),
    http.post(`${API}/programs/p1/imports`, () => {
      create()
      return HttpResponse.json(session({ status: 'extracting', job_id: 'j1', items: [] }))
    }),
  )
  renderWithRouter(<ImportDialog request={icsRequest()} onClose={() => {}} />)
  await screen.findByRole('button', { name: 'Read' })
  await pickFile()
  await userEvent.click(screen.getByRole('button', { name: 'Read' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Stop' }))
  // The drop zone is back and no reason is shown.
  expect(await screen.findByText('Choose another file, or drop it here')).toBeInTheDocument()
  expect(screen.queryByText(/went wrong|failed/i)).toBeNull()
  expect(create).not.toHaveBeenCalled()
})

test('stopping while reading discards the session and returns to the start', async () => {
  const discarded = vi.fn<() => void>()
  let status: 'extracting' | 'discarded' = 'extracting'
  server.use(
    ...upload(),
    http.post(`${API}/programs/p1/imports`, () =>
      HttpResponse.json(session({ status: 'extracting', job_id: 'j1', items: [] })),
    ),
    http.get(`${API}/imports/s1`, () =>
      HttpResponse.json(
        session({ status, job_id: status === 'extracting' ? 'j1' : null, items: [] }),
      ),
    ),
    http.get(`${API}/jobs/j1`, () =>
      HttpResponse.json({
        id: 'j1',
        kind: 'imports.extract',
        status: 'running',
        progress: 10,
        step: null,
        step_current: null,
        step_total: null,
        attempts: 1,
        cancel_requested: false,
      }),
    ),
    http.post(`${API}/imports/s1\\:discard`, () => {
      discarded()
      status = 'discarded'
      return HttpResponse.json(session({ status: 'discarded', items: [] }))
    }),
  )
  renderWithRouter(<ImportDialog request={icsRequest()} onClose={() => {}} />)
  await screen.findByRole('button', { name: 'Read' })
  await pickFile()
  await userEvent.click(screen.getByRole('button', { name: 'Read' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Stop' }))
  await waitFor(() => expect(discarded).toHaveBeenCalledOnce())
  expect(await screen.findByRole('button', { name: 'Read' })).toBeEnabled()
})

test("a retry that fails shows its own reason, not the failed session's", async () => {
  let attempts = 0
  server.use(
    ...upload(),
    http.post(`${API}/programs/p1/imports`, () => {
      attempts += 1
      if (attempts === 1) {
        return HttpResponse.json(
          session({ status: 'failed', error_code: 'import.no_content', items: [] }),
        )
      }
      return HttpResponse.json(
        { error: { code: 'import.file_too_complex', params: {}, request_id: 'r' } },
        { status: 422 },
      )
    }),
    http.get(`${API}/imports/s1`, () =>
      HttpResponse.json(session({ status: 'failed', error_code: 'import.no_content', items: [] })),
    ),
  )
  renderWithRouter(<ImportDialog request={icsRequest()} onClose={() => {}} />)
  await screen.findByRole('button', { name: 'Read' })
  await pickFile()
  await userEvent.click(screen.getByRole('button', { name: 'Read' }))
  const retry = await screen.findByRole('button', { name: 'Retry' })
  expect(
    screen.getByText(errorMessage({ error: { code: 'import.no_content', params: {} } })),
  ).toBeInTheDocument()
  await userEvent.click(retry)
  expect(
    await screen.findByText(
      errorMessage({ error: { code: 'import.file_too_complex', params: {} } }),
    ),
  ).toBeInTheDocument()
  expect(
    screen.queryByText(errorMessage({ error: { code: 'import.no_content', params: {} } })),
  ).toBeNull()
})

test('a single-file source offers to replace the file, a multi-file one to add more', async () => {
  server.use(
    http.get(`${API}/ai/status`, () =>
      HttpResponse.json({ items: [{ purpose: 'extraction', available: true }] }),
    ),
  )
  const { unmount } = renderWithRouter(
    <ImportDialog request={icsRequest('syllabus')} onClose={() => {}} />,
  )
  await screen.findByText('Choose files or drop them here')
  await pickFile('a.pdf')
  expect(await screen.findByText('Add more files, or drop them here')).toBeInTheDocument()
  unmount()
  renderWithRouter(<ImportDialog request={icsRequest('ics')} onClose={() => {}} />)
  await screen.findByText('Choose a file or drop it here')
  await pickFile()
  expect(await screen.findByText('Choose another file, or drop it here')).toBeInTheDocument()
})
