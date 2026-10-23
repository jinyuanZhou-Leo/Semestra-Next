import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { FakeEventSource } from '@/test-event-source'
import { CLIENT_ID } from './api'
import { COALESCE_MS, connectRealtime, type RealtimeConfig } from './realtime'

function setup(config: RealtimeConfig = { invalidations: { 'files.changed': ['coreJobList'] } }) {
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const close = connectRealtime(queryClient, config, '/stream')
  return { queryClient, invalidate, close, source: FakeEventSource.last() }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

test('refetches the queries mapped to an event type', () => {
  const { queryClient, invalidate, source } = setup()
  expect(source.init).toEqual({ withCredentials: true })
  const jobs = [{ _id: 'coreJobList', baseUrl: 'x' }]
  const other = [{ _id: 'accountProfileGet', baseUrl: 'x' }]
  queryClient.setQueryData(jobs, 1)
  queryClient.setQueryData(other, 2)

  source.emit({ type: 'files.changed', data: {} })
  vi.advanceTimersByTime(COALESCE_MS)
  expect(queryClient.getQueryState(jobs)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false)

  source.emit({ type: 'unknown.event', data: {} })
  vi.advanceTimersByTime(COALESCE_MS)
  expect(invalidate).toHaveBeenCalledTimes(1)
})

test('a burst of events is one refetch that keeps requests already in flight', () => {
  const { invalidate, source } = setup({
    invalidations: { a: ['coreJobList'], b: ['coreJobGet'], c: ['coreJobList'] },
  })
  for (const type of ['a', 'b', 'c']) source.emit({ type, data: {} })
  expect(invalidate).not.toHaveBeenCalled()
  vi.advanceTimersByTime(COALESCE_MS)
  expect(invalidate).toHaveBeenCalledTimes(1)
  expect(invalidate.mock.calls[0]?.[1]).toEqual({ cancelRefetch: false })
})

test('a function target refetches only the queries of the ids in the event', () => {
  const { queryClient, source } = setup({
    invalidations: {
      'grading.changed': [(d) => [{ _id: 'gradebookGet', path: { course_id: d.course_id } }]],
    },
  })
  const mine = [{ _id: 'gradebookGet', baseUrl: 'x', path: { course_id: 'c1' } }]
  const other = [{ _id: 'gradebookGet', baseUrl: 'x', path: { course_id: 'c2' } }]
  queryClient.setQueryData(mine, 1)
  queryClient.setQueryData(other, 2)
  source.emit({ type: 'grading.changed', data: { course_id: 'c1' } })
  vi.advanceTimersByTime(COALESCE_MS)
  expect(queryClient.getQueryState(mine)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false)
})

test('echoes of this tab are skipped only for event types that opt in', () => {
  const { invalidate, source } = setup({
    invalidations: { own: ['coreJobList'], shared: ['coreJobList'] },
    skipOwn: new Set(['own']),
  })
  source.emit({ type: 'own', data: {}, origin: CLIENT_ID })
  vi.advanceTimersByTime(COALESCE_MS)
  expect(invalidate).not.toHaveBeenCalled()
  source.emit({ type: 'own', data: {}, origin: 'another-tab' })
  source.emit({ type: 'shared', data: {}, origin: CLIENT_ID })
  vi.advanceTimersByTime(COALESCE_MS)
  expect(invalidate).toHaveBeenCalledTimes(1)
})

test('a reconnect refetches nothing; a resync refetches everything; closing stops', () => {
  const { invalidate, close, source } = setup()
  source.open()
  source.open()
  vi.advanceTimersByTime(COALESCE_MS)
  expect(invalidate).not.toHaveBeenCalled()
  source.emit({ type: 'core.resync', data: {} })
  vi.advanceTimersByTime(COALESCE_MS)
  expect(invalidate).toHaveBeenLastCalledWith(undefined, { cancelRefetch: false })
  source.emit({ type: 'files.changed', data: {} })
  close()
  vi.advanceTimersByTime(COALESCE_MS)
  expect(invalidate).toHaveBeenCalledTimes(1)
  expect(source.closed).toBe(true)
})

test('the config is read per event, so it can change without reconnecting', () => {
  let config: RealtimeConfig = { invalidations: {} }
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  connectRealtime(queryClient, () => config, '/stream')
  const source = FakeEventSource.last()
  source.emit({ type: 'plugin.thing', data: {} })
  config = { invalidations: { 'plugin.thing': ['coreJobList'] } }
  source.emit({ type: 'plugin.thing', data: {} })
  vi.advanceTimersByTime(COALESCE_MS)
  expect(invalidate).toHaveBeenCalledTimes(1)
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
