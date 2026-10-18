import { expect, test } from 'vitest'
import { inOrder } from './in-order'

test('saves of one key run one after another and only the newest is latest', async () => {
  const log: string[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const first = inOrder('k', async () => {
    await gate
    log.push('first')
    throw new Error('failed')
  })
  const second = inOrder('k', async () => {
    log.push('second')
    return 2
  })
  await Promise.resolve()
  expect(log).toEqual([])
  release()
  await expect(first.result).rejects.toThrow('failed')
  expect(await second.result).toBe(2)
  expect(log).toEqual(['first', 'second'])
  expect(first.isLatest()).toBe(false)
  expect(second.isLatest()).toBe(true)
})
