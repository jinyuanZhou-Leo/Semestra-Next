import { academicsProgramListOptions } from '@semestra/api-client/react-query'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { API, newQueryClient, server } from '@/test-utils'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function programs() {
  const log = { reads: 0 }
  server.use(
    http.get(`${API}/programs`, () => {
      log.reads += 1
      return HttpResponse.json({ items: [] })
    }),
  )
  return log
}

test('data a loader prefetched is not fetched again when the page mounts', async () => {
  const log = programs()
  const queryClient = newQueryClient()
  await queryClient.prefetchQuery(academicsProgramListOptions())
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useQuery(academicsProgramListOptions()), { wrapper })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(log.reads).toBe(1)
})

test('an invalidation (an SSE event) still refetches fresh data', async () => {
  const log = programs()
  const queryClient = newQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useQuery(academicsProgramListOptions()), { wrapper })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  await queryClient.invalidateQueries()
  expect(log.reads).toBe(2)
})
