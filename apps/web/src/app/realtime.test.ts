import { QueryClient } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { FakeEventSource } from '@/test-event-source'
import { connectRealtime } from './realtime'

function setup() {
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const close = connectRealtime(queryClient, { 'files.changed': ['coreJobList'] }, '/stream')
  return { queryClient, invalidate, close, source: FakeEventSource.last() }
}

test('refetches the queries mapped to an event type', async () => {
  const { queryClient, invalidate, source } = setup()
  expect(source.init).toEqual({ withCredentials: true })
  const jobs = [{ _id: 'coreJobList', baseUrl: 'x' }]
  const other = [{ _id: 'accountProfileGet', baseUrl: 'x' }]
  queryClient.setQueryData(jobs, 1)
  queryClient.setQueryData(other, 2)

  source.emit({ type: 'files.changed', data: {} })
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

test('job progress patches cached jobs and refetches only on status changes', () => {
  const { queryClient, source } = setup()
  const job = {
    id: 'j1',
    status: 'running',
    progress: 10,
    step: 'a',
    step_current: null,
    step_total: null,
  }
  const list = [{ _id: 'coreJobList', baseUrl: 'x' }]
  const get = [{ _id: 'coreJobGet', baseUrl: 'x', path: { job_id: 'j1' } }]
  const other = [{ _id: 'coreJobGet', baseUrl: 'x', path: { job_id: 'j2' } }]
  queryClient.setQueryData(list, { items: [job], next_cursor: null })
  queryClient.setQueryData(get, job)
  queryClient.setQueryData(other, { ...job, id: 'j2' })
  const event = {
    job_id: 'j1',
    kind: 'k',
    status: 'running',
    progress: 55,
    step: 'b',
    step_current: 2,
    step_total: 9,
  }

  source.emit({ type: 'core.job.progress', data: event })
  expect(queryClient.getQueryData(get)).toMatchObject({ progress: 55, step: 'b', step_current: 2 })
  expect(queryClient.getQueryData(list)).toMatchObject({ items: [{ progress: 55 }] })
  expect(queryClient.getQueryData(other)).toMatchObject({ progress: 10 })
  expect(queryClient.getQueryState(list)?.isInvalidated).toBe(false)

  source.emit({ type: 'core.job.progress', data: { ...event, status: 'succeeded' } })
  expect(queryClient.getQueryState(list)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(get)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false)
})
