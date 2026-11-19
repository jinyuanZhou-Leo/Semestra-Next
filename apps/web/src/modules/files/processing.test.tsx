import type { JobOut, ProcessingFile, ProcessingList } from '@semestra/api-client'
import { renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { API, newQueryClient, renderWithRouter, server } from '@/test-utils'
import { Popover, PopoverContent } from '@/ui/popover'
import ProcessingPanel from './components/ProcessingPanel'
import { useProcessingLine } from './processing-line'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const SINCE = '2026-11-18T10:00:00Z'

function file(
  id: string,
  name: string,
  status: JobOut['status'],
  extra: Partial<JobOut> & { synced?: boolean } = {},
): ProcessingFile {
  const { synced = false, ...job } = extra
  return {
    job: {
      id: `j-${id}`,
      kind: synced ? 'files.process_synced' : 'files.process',
      status,
      progress: 0,
      step: null,
      step_current: null,
      step_total: null,
      result: null,
      error_code: null,
      error_params: null,
      attempts: 1,
      max_attempts: 1,
      cancel_requested: false,
      created_at: '2026-11-18T10:05:00Z',
      started_at: null,
      finished_at: status === 'pending' || status === 'running' ? null : '2026-11-18T10:06:00Z',
      waiting: null,
      label_kind: synced ? 'files.process' : null,
      ...job,
    },
    item_id: id,
    name,
    mime_type: 'application/pdf',
    course_id: 'c1',
    folder_id: null,
    program_id: 'p1',
    course_code: 'ECE244',
    course_color: '#3b82f6',
    synced,
  }
}

const uiState = [
  http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
  http.put(`${API}/me/ui-state/:key`, () => HttpResponse.json({ ok: true })),
]

function serve(list: ProcessingList) {
  server.use(
    http.get(`${API}/me/files/processing`, () => HttpResponse.json(list)),
    ...uiState,
  )
}

function lineOf(list: ProcessingList) {
  serve(list)
  const queryClient = newQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return renderHook(() => useProcessingLine(), { wrapper }).result
}

test('the line counts the round; its bar shows only while a file the user added is read', async () => {
  const own = lineOf({
    active: 2,
    done: 1,
    since: SINCE,
    files: [file('a', 'Lecture 12.pdf', 'running'), file('b', 'Lab 5.pdf', 'pending')],
  })
  await waitFor(() => expect(own.current?.meta).toBe('1/3'))
  expect(own.current?.progress).toBeCloseTo(100 / 3)

  const synced = lineOf({
    active: 1,
    done: 0,
    since: SINCE,
    files: [file('c', 'Week 9.pdf', 'running', { synced: true })],
  })
  await waitFor(() => expect(synced.current?.meta).toBe('0/1'))
  expect(synced.current?.progress).toBeUndefined()

  const failed = lineOf({
    active: 0,
    done: 0,
    since: null,
    files: [file('d', 'Scan.pdf', 'failed', { error_code: 'files.too_many_pages' })],
  })
  await waitFor(() => expect(failed.current?.tone).toBe('error'))
  expect(failed.current?.meta).toBe('1 failed')
})

test('the panel names each file; one can be stopped, a failed one read again, and all stopped', async () => {
  const cancelled = vi.fn<() => void>()
  const reprocessed = vi.fn<() => void>()
  const stoppedAll = vi.fn<() => void>()
  serve({
    active: 2,
    done: 0,
    since: SINCE,
    files: [
      file('a', 'Lecture 12.pdf', 'running', { progress: 42, step: 'ocr' }),
      file('b', 'Lab 5.pdf', 'pending'),
      file('c', 'Scan.pdf', 'failed', { error_code: 'files.encrypted_pdf' }),
    ],
  })
  server.use(
    http.post(`${API}/jobs/j-b/cancel`, () => {
      cancelled()
      return HttpResponse.json(file('b', 'Lab 5.pdf', 'cancelled').job)
    }),
    http.post(`${API}/files/c\\:reprocess`, () => {
      reprocessed()
      return HttpResponse.json({})
    }),
    http.post(`${API}/me/files/processing\\:cancel`, () => {
      stoppedAll()
      return HttpResponse.json({ cancelled: 2 })
    }),
  )
  renderWithRouter(
    <Popover open>
      <PopoverContent>
        <ProcessingPanel onClose={() => undefined} />
      </PopoverContent>
    </Popover>,
  )

  const running = (await screen.findByText('Lecture 12.pdf')).closest('[data-slot=item]')!
  expect(within(running as HTMLElement).getByText('42%')).toBeInTheDocument()
  expect(screen.getByText('Password-protected PDF')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Stop processing Lab 5.pdf' }))
  await waitFor(() => expect(cancelled).toHaveBeenCalled())

  const scan = screen.getByText('Scan.pdf').closest('[data-slot=item]') as HTMLElement
  await userEvent.click(within(scan).getByRole('button', { name: 'Process again' }))
  await waitFor(() => expect(reprocessed).toHaveBeenCalled())

  await userEvent.click(screen.getByRole('button', { name: 'Stop all' }))
  const dialog = await screen.findByRole('alertdialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Stop all' }))
  await waitFor(() => expect(stoppedAll).toHaveBeenCalled())
})

test('files stopped together stay on the line and can be processed again together', async () => {
  const retried = vi.fn<(ids: unknown) => void>()
  const stopped = {
    active: 0,
    done: 2,
    since: SINCE,
    files: [file('a', 'Lecture 12.pdf', 'cancelled'), file('b', 'Lab 5.pdf', 'cancelled')],
  }
  const line = lineOf(stopped)
  await waitFor(() => expect(line.current?.meta).toBe('2 stopped'))

  server.use(
    http.post(`${API}/me/files/processing\\:retry`, async ({ request }) => {
      retried(((await request.json()) as { item_ids: string[] }).item_ids)
      return HttpResponse.json({ retried: 2 })
    }),
  )
  renderWithRouter(
    <Popover open>
      <PopoverContent>
        <ProcessingPanel onClose={() => undefined} />
      </PopoverContent>
    </Popover>,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Process all again' }))
  await waitFor(() => expect(retried).toHaveBeenCalledWith(['a', 'b']))
})
