import { QueryClient } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { courseListOptions } from '@/modules/academics/queries'
import { courseFilesOptions, prefetchFilesPage } from './queries'

const TERM = { kind: 'term', programId: 'p1', termId: 't1' } as const

function withCourses() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
  queryClient.setQueryData(courseListOptions('p1', 't1').queryKey, {
    items: [{ id: 'c1', term_ids: ['t1'] }],
  } as never)
  const prefetch = vi.spyOn(queryClient, 'prefetchQuery').mockResolvedValue()
  return { queryClient, prefetch }
}

const filesKey = (call: unknown[]) =>
  JSON.stringify((call[0] as { queryKey: unknown }).queryKey) ===
  JSON.stringify(courseFilesOptions('c1').queryKey)

test("a hovered term files link prefetches the course list, not every course's files", async () => {
  const { queryClient, prefetch } = withCourses()
  prefetchFilesPage(TERM, queryClient, { preload: true })
  await new Promise((done) => setTimeout(done))
  expect(prefetch.mock.calls.some(filesKey)).toBe(false)
})

test("opening the term files page prefetches each course's files", async () => {
  const { queryClient, prefetch } = withCourses()
  prefetchFilesPage(TERM, queryClient, { preload: false })
  await vi.waitFor(() => expect(prefetch.mock.calls.some(filesKey)).toBe(true))
})
