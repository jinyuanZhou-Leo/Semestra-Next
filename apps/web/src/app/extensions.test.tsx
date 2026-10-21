import { act, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { expect, test, vi } from 'vitest'
import { PluginBoundary } from './host/PluginBoundary'
import { preload, preloadable } from './extensions'

const Hello = ({ name }: { name: string }) => <p>Hello {name}</p>

test('a preloaded component renders at once, without its Suspense fallback', async () => {
  const Lazy = preloadable(() => Promise.resolve({ default: Hello }))
  await preload(Lazy)
  render(
    <Suspense fallback={<p>loading</p>}>
      <Lazy name="Ada" />
    </Suspense>,
  )
  // Synchronously, before any promise settles.
  expect(screen.getByText('Hello Ada')).toBeInTheDocument()
  expect(screen.queryByText('loading')).not.toBeInTheDocument()
})

test('a failed load is forgotten: the next preload tries again and then renders at once', async () => {
  const load = vi
    .fn<() => Promise<{ default: typeof Hello }>>()
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ default: Hello })
  const Lazy = preloadable(load)

  // A failure does not reject: the router must not fail a navigation over it.
  await expect(preload(Lazy)).resolves.toBeUndefined()
  await preload(Lazy)
  expect(load).toHaveBeenCalledTimes(2)
  render(
    <Suspense fallback={<p>loading</p>}>
      <Lazy name="Ada" />
    </Suspense>,
  )
  expect(screen.getByText('Hello Ada')).toBeInTheDocument()
})

test('after a failed preload the page shows its error, not an endless skeleton', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const Lazy = preloadable<{ name: string }>(() => Promise.reject(new Error('gone')))
  await preload(Lazy)
  await act(async () => {
    render(
      <PluginBoundary>
        <Lazy name="Ada" />
      </PluginBoundary>,
    )
  })
  expect(await screen.findByText('Something went wrong here')).toBeInTheDocument()
  vi.restoreAllMocks()
})
