import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import { API, newQueryClient, server } from '@/test-utils'
import { flushUiPrefs, prefetchUiPrefs, refreshUiPrefs, resetUiPrefs, useUiPref } from './ui-pref'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
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

test('the prefetch runs once per signed-in session, and again after a reset', async () => {
  const log = backend({ 'tasks.sort': 'due' })
  await prefetchUiPrefs(queryClient, ['tasks.'])
  await prefetchUiPrefs(queryClient, ['tasks.'])
  expect(log.reads).toHaveLength(1)

  queryClient.clear()
  resetUiPrefs(queryClient)
  await prefetchUiPrefs(queryClient, ['tasks.'])
  expect(log.reads).toHaveLength(2)
})

test('a prefetch answer does not overwrite a value saved while it was out', async () => {
  const stored: Record<string, unknown> = { 'tasks.sort': 'due' }
  let answer!: () => void
  const gate = new Promise<void>((resolve) => (answer = resolve))
  server.use(
    http.post(`${API}/me/ui-state\\:get`, async () => {
      const items = { ...stored }
      await gate
      return HttpResponse.json({ items })
    }),
    http.put(`${API}/me/ui-state/:key`, async ({ params, request }) => {
      const { value } = (await request.json()) as { value: unknown }
      stored[String(params.key)] = value
      return HttpResponse.json({ key: params.key, value })
    }),
  )
  const prefetch = prefetchUiPrefs(queryClient, ['tasks.'])
  const { result } = renderHook(() => useUiPref('tasks.sort', 'created'), { wrapper })
  act(() => result.current[1]('title'))
  await flushUiPrefs(queryClient)
  answer()
  await prefetch
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  expect(result.current[0]).toBe('title')
  expect(queryClient.getQueryData(['ui-pref', 'tasks.sort'])).toEqual({
    found: true,
    value: 'title',
  })
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

test('a mounted component that switches key shows (and writes) that key, not the previous one', async () => {
  const log = backend({ 'course.c2.sort': 'grade' })
  const { result, rerender } = renderHook(({ id }) => useUiPref(`course.${id}.sort`, 'name'), {
    wrapper,
    initialProps: { id: 'c1' },
  })
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  expect(result.current[0]).toBe('name')

  rerender({ id: 'c2' })
  await waitFor(() => expect(result.current[0]).toBe('grade'))

  act(() => result.current[1]('date'))
  await flushUiPrefs(queryClient)
  expect(log.writes).toEqual([['course.c2.sort', 'date']])
})

test('a slow save never overwrites a newer value: saves of one key go out one at a time', async () => {
  const order: string[] = []
  let releaseFirst: () => void = () => {}
  const firstDone = new Promise<void>((resolve) => (releaseFirst = resolve))
  server.use(
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.put(`${API}/me/ui-state/:key`, async ({ request }) => {
      const { value } = (await request.json()) as { value: string }
      order.push(`start ${value}`)
      if (value === 'first') await firstDone
      order.push(`end ${value}`)
      return HttpResponse.json({ key: 'layout.sidebar', value })
    }),
  )
  const { result } = renderHook(() => useUiPref('layout.sidebar', 'open'), { wrapper })
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))

  act(() => result.current[1]('first'))
  const first = flushUiPrefs(queryClient)
  await waitFor(() => expect(order).toEqual(['start first']))
  act(() => result.current[1]('second'))
  const second = flushUiPrefs(queryClient)
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(order).toEqual(['start first']) // the second waits for the first
  releaseFirst()
  await Promise.all([first, second])
  expect(order).toEqual(['start first', 'end first', 'start second', 'end second'])
})

test('a slow refresh does not undo a change made, and already saved, while it was out', async () => {
  let answer!: () => void
  const answered = new Promise<void>((resolve) => (answer = resolve))
  let reads = 0
  server.use(
    http.post(`${API}/me/ui-state\\:get`, async () => {
      reads += 1
      // The first read (the hook's own) is quick; the refresh is slow and answers with old data.
      if (reads > 1) await answered
      return HttpResponse.json({ items: { 'layout.sidebar': 'open' } })
    }),
    http.put(`${API}/me/ui-state/:key`, async ({ request }) => {
      const { value } = (await request.json()) as { value: string }
      return HttpResponse.json({ key: 'layout.sidebar', value })
    }),
  )
  const { result } = renderHook(() => useUiPref('layout.sidebar', 'x'), { wrapper })
  await waitFor(() => expect(result.current[0]).toBe('open'))

  const refreshing = refreshUiPrefs(queryClient, ['layout.sidebar'])
  await waitFor(() => expect(reads).toBe(2))
  act(() => result.current[1]('closed'))
  await flushUiPrefs(queryClient) // saved: no longer pending
  answer()
  await refreshing
  await waitFor(() => expect(result.current[0]).toBe('closed'))
})
