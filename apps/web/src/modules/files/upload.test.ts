import { afterEach, expect, test, vi } from 'vitest'
import { sha256Hex } from './upload'

const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

afterEach(() => vi.unstubAllGlobals())

test('hashes with Web Crypto and, without it (http on a LAN address), with the fallback', async () => {
  expect(await sha256Hex(new Blob(['abc']))).toBe(ABC)
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
  expect(await sha256Hex(new Blob(['abc']))).toBe(ABC)
})
