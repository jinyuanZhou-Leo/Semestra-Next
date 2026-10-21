import { lazy } from 'react'
import { expect, test, vi } from 'vitest'
import { pluginsCatalogListOptions } from '@semestra/api-client/react-query'
import { QueryClient } from '@tanstack/react-query'
import { builtInModules, installedModules, preloadPage } from './registry'
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
    ...(module.cards ?? []).flatMap((card) =>
      [card.component, card.settings?.component]
        .filter((part) => part !== undefined && !canPreload(part))
        .map(() => `${module.id}:${card.id}`),
    ),
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

test("preloadPage starts the cards of the page's board but waits only for the page", async () => {
  const card = vi.fn<() => Promise<never>>(() => new Promise<never>(() => {}))
  const away = vi.fn<() => Promise<never>>(() => new Promise<never>(() => {}))
  const modules = [
    {
      id: 'demo',
      kind: 'core',
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

  // Resolves although the term card never finishes loading.
  await preloadPage('term', 'overview', modules)
  expect(card).toHaveBeenCalledTimes(1)
  expect(away).not.toHaveBeenCalled()
})

test('installedModules leaves out plugins the account has not installed', () => {
  const modules = [
    { id: 'core-one', kind: 'core' },
    { id: 'plugin-on', kind: 'plugin' },
    { id: 'plugin-off', kind: 'plugin' },
  ] as unknown as ModuleManifest[]
  const queryClient = new QueryClient()
  const ids = (list: readonly ModuleManifest[]) => list.map((m) => m.id)

  // Catalog not loaded yet: core modules only.
  expect(ids(installedModules(queryClient, modules))).toEqual(['core-one'])

  queryClient.setQueryData(pluginsCatalogListOptions().queryKey, {
    items: [
      { id: 'plugin-on', installed: true },
      { id: 'plugin-off', installed: false },
    ],
  } as never)
  expect(ids(installedModules(queryClient, modules))).toEqual(['core-one', 'plugin-on'])
})

test('preloadPage waits until the page code has loaded', async () => {
  let finish = () => {}
  const load = () =>
    new Promise<{ default: () => null }>((done) => (finish = () => done({ default: () => null })))
  const modules = [
    {
      id: 'demo',
      pages: [
        {
          id: 'files',
          scopes: ['course'],
          title: () => 'files',
          icon: (() => null) as never,
          component: preloadable(load),
          order: 1,
        },
      ],
    },
  ] as unknown as ModuleManifest[]

  let done = false
  const loading = preloadPage('course', 'files', modules).then(() => (done = true))
  await Promise.resolve()
  expect(done).toBe(false)
  finish()
  await loading
  expect(done).toBe(true)
})
