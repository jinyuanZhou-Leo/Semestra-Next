import { QueryClient } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { FakeEventSource } from '@/test-event-source'
import { connectRealtime } from './realtime'

function setup() {
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const close = connectRealtime(queryClient, { 'core.job.updated': ['coreJobList'] }, '/stream')
  return { queryClient, invalidate, close, source: FakeEventSource.last() }
}

test('refetches the queries mapped to an event type', async () => {
  const { queryClient, invalidate, source } = setup()
  expect(source.init).toEqual({ withCredentials: true })
  const jobs = [{ _id: 'coreJobList', baseUrl: 'x' }]
  const other = [{ _id: 'accountMeGet', baseUrl: 'x' }]
  queryClient.setQueryData(jobs, 1)
  queryClient.setQueryData(other, 2)

  source.emit({ type: 'core.job.updated', data: { id: 'j1' } })
  expect(queryClient.getQueryState(jobs)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false)

  source.emit({ type: 'unknown.event', data: {} })
  expect(invalidate).toHaveBeenCalledTimes(1)
})

test('refetches everything on resync and after a reconnect, then closes', () => {
  const { invalidate, close, source } = setup()
  source.open()
  expect(invalidate).not.toHaveBeenCalled()
  source.open()
  expect(invalidate).toHaveBeenLastCalledWith()
  source.emit({ type: 'core.resync', data: {} })
  expect(invalidate).toHaveBeenCalledTimes(2)
  close()
  expect(source.closed).toBe(true)
})
