import { lazy } from 'react'
import { expect, test, vi } from 'vitest'
import { builtInModules, preloadPage } from './registry'
import { preloadable } from './extensions'
import type { ModuleManifest } from './extensions'

const canPreload = (part: unknown) => typeof part !== 'object' || part === null || 'preload' in part

test('every lazy page, page navigation, card and settings section of a built-in module can preload', () => {
  const plain = builtInModules.flatMap((module) => [
    ...(module.pages ?? []).flatMap((page) =>
      [page.component, page.sidebarNav]
        .filter((part) => part !== undefined && !canPreload(part))
        .map(() => `${module.id}:${page.id}`),
    ),
    ...(module.cards ?? [])
      .filter((card) => !canPreload(card.component))
      .map((card) => `${module.id}:${card.id}`),
    ...(module.settingsSections ?? [])
      .filter((section) => section.component !== undefined && !canPreload(section.component))
      .map((section) => `${module.id}:${section.id}`),
  ])
  expect(plain).toEqual([])
})

test('preloadPage loads the code of the page with that id in that scope only', () => {
  type Load = () => Promise<never>
  const pending = () => new Promise<never>(() => {})
  const load = vi.fn<Load>(pending)
  const other = vi.fn<Load>(pending)
  const nav = vi.fn<Load>(pending)
  const page = (id: string, scopes: ('program' | 'course')[], loader: Load) => ({
    id,
    scopes,
    title: () => id,
    icon: (() => null) as never,
    component: preloadable(loader),
    order: 1,
  })
  const modules = [
    {
      id: 'demo',
      pages: [
        { ...page('files', ['course'], load), sidebarNav: preloadable(nav) },
        page('grades', ['course'], other),
        { ...page('plain', ['course'], other), component: lazy(other) },
      ],
    },
  ] as unknown as ModuleManifest[]

  preloadPage('program', 'files', modules)
  expect(load).not.toHaveBeenCalled()
  preloadPage('course', 'files', modules)
  expect(load).toHaveBeenCalledTimes(1)
  expect(nav).toHaveBeenCalledTimes(1)
  expect(other).not.toHaveBeenCalled()
  preloadPage('course', 'plain', modules)
  expect(other).not.toHaveBeenCalled()
})

test('preloadPage also loads the cards of the board the page shows, and waits for them', async () => {
  let resolve = () => {}
  const card = vi.fn<() => Promise<never>>(
    () => new Promise<never>((done) => (resolve = done as () => void)),
  )
  const away = vi.fn<() => Promise<never>>(() => new Promise<never>(() => {}))
  const modules = [
    {
      id: 'demo',
      pages: [
        {
          id: 'overview',
          scopes: ['term'],
          title: () => 'overview',
          icon: (() => null) as never,
          component: preloadable(() => Promise.resolve({ default: () => null })),
          board: 'scope',
          order: 1,
        },
      ],
      cards: [
        { id: 'term-card', scopes: ['term'], component: preloadable(card) },
        { id: 'today-card', scopes: ['today'], component: preloadable(away) },
      ],
    },
  ] as unknown as ModuleManifest[]

  let done = false
  const loading = preloadPage('term', 'overview', modules).then(() => (done = true))
  expect(card).toHaveBeenCalledTimes(1)
  expect(away).not.toHaveBeenCalled()
  await Promise.resolve()
  expect(done).toBe(false)
  resolve()
  await loading
  expect(done).toBe(true)
})
