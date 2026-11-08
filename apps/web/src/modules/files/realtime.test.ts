import { filesItemGetQueryKey, filesItemListQueryKey } from '@semestra/api-client/react-query'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { COALESCE_MS, connectRealtime } from '@/app/realtime'
import { mergeInvalidations } from '@/app/registry'
import { FakeEventSource } from '@/test-event-source'
import files from './manifest'

afterEach(() => {
  vi.useRealTimers()
})

test("a file processed in one course refetches that course's list and that file only", () => {
  vi.useFakeTimers()
  const queryClient = new QueryClient()
  connectRealtime(queryClient, { invalidations: mergeInvalidations([files]) }, '/stream')
  const list = (course_id: string) =>
    filesItemListQueryKey({ path: { course_id }, query: { recursive: true } })
  const item = (item_id: string) => filesItemGetQueryKey({ path: { item_id } })
  for (const key of [list('a'), list('b'), item('f1'), item('f2')])
    queryClient.setQueryData(key, {})

  FakeEventSource.last().emit({
    type: 'files.document.ready',
    data: { item_id: 'f1', course_id: 'a', page_count: 3 },
  })
  vi.advanceTimersByTime(COALESCE_MS)

  const stale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated
  expect([list('a'), list('b'), item('f1'), item('f2')].map(stale)).toEqual([
    true,
    false,
    true,
    false,
  ])
})
