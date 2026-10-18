import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import { API, newQueryClient, server } from '@/test-utils'
import { flushUiPrefs, prefetchUiPrefs, useUiPref } from './ui-pref'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

let queryClient: QueryClient
beforeEach(() => {
  queryClient = newQueryClient()
})
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

function backend(stored: Record<string, unknown> = {}) {
  const log = { reads: [] as { keys?: string[]; prefixes?: string[] }[], writes: [] as unknown[] }
  server.use(
    http.post(`${API}/me/ui-state\\:get`, async ({ request }) => {
      const body = (await request.json()) as { keys?: string[]; prefixes?: string[] }
      log.reads.push(body)
      const items = Object.fromEntries(
        Object.entries(stored).filter(
          ([key]) =>
            body.keys?.includes(key) || body.prefixes?.some((prefix) => key.startsWith(prefix)),
        ),
      )
      return HttpResponse.json({ items })
    }),
    http.put(`${API}/me/ui-state/:key`, async ({ params, request }) => {
      const { value } = (await request.json()) as { value: unknown }
      stored[String(params.key)] = value
      log.writes.push([params.key, value])
      return HttpResponse.json({ key: params.key, value })
    }),
  )
  return log
}

test('uses the default until a stored value arrives, and reads keys of one tick together', async () => {
  const log = backend({ 'tasks.sort': 'due', 'tasks.filter': 'open' })
  const sort = renderHook(() => useUiPref('tasks.sort', 'created'), { wrapper })
  const filter = renderHook(() => useUiPref('tasks.filter', 'all'), { wrapper })
  expect(sort.result.current[0]).toBe('created')

  await waitFor(() => expect(sort.result.current[0]).toBe('due'))
  expect(filter.result.current[0]).toBe('open')
  expect(log.reads).toHaveLength(1)
  expect([...log.reads[0]!.keys!].sort()).toEqual(['tasks.filter', 'tasks.sort'])
})

test('a key that was never saved keeps its default', async () => {
  backend()
  const { result } = renderHook(() => useUiPref('layout.sidebar', 'open'), { wrapper })
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  expect(result.current[0]).toBe('open')
})

test('a change shows at once and is saved once, after a short quiet period', async () => {
  const log = backend()
  const { result } = renderHook(() => useUiPref('layout.sidebar', 'open'), { wrapper })
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))

  act(() => result.current[1]('closed'))
  act(() => result.current[1]('compact'))
  await waitFor(() => expect(result.current[0]).toBe('compact'))
  expect(log.writes).toEqual([])

  await waitFor(() => expect(log.writes).toEqual([['layout.sidebar', 'compact']]))
})

test('flushUiPrefs saves pending changes immediately', async () => {
  const log = backend()
  const { result } = renderHook(() => useUiPref('layout.sidebar', 'open'), { wrapper })
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))

  act(() => result.current[1]('closed'))
  await flushUiPrefs(queryClient)
  expect(log.writes).toEqual([['layout.sidebar', 'closed']])
})

test('per-scope keys are separate entries', async () => {
  const log = backend({ 'tasks.sort.t1': 'due' })
  const a = renderHook(() => useUiPref('tasks.sort', 'created', { scope: 't1' }), { wrapper })
  const b = renderHook(() => useUiPref('tasks.sort', 'created', { scope: 't2' }), { wrapper })
  await waitFor(() => expect(a.result.current[0]).toBe('due'))
  expect(b.result.current[0]).toBe('created')
  expect([...log.reads[0]!.keys!].sort()).toEqual(['tasks.sort.t1', 'tasks.sort.t2'])
})

test('after a prefetch, keys under the prefix need no request of their own', async () => {
  const log = backend({ 'tasks.sort': 'due' })
  await prefetchUiPrefs(queryClient, ['tasks.'])
  expect(log.reads).toEqual([{ prefixes: ['tasks.'] }])

  const stored = renderHook(() => useUiPref('tasks.sort', 'created'), { wrapper })
  const missing = renderHook(() => useUiPref('tasks.filter', 'all'), { wrapper })
  await waitFor(() => expect(stored.result.current[0]).toBe('due'))
  expect(missing.result.current[0]).toBe('all')
  expect(log.reads).toHaveLength(1)
})

test('a failed save does not break the page and keeps the value in this tab', async () => {
  server.use(
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.put(`${API}/me/ui-state/:key`, () => HttpResponse.error()),
  )
  const { result } = renderHook(() => useUiPref('layout.sidebar', 'open'), { wrapper })
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  act(() => result.current[1]('closed'))
  await flushUiPrefs(queryClient)
  await waitFor(() => expect(result.current[0]).toBe('closed'))
})
