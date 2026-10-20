import { lazy } from 'react'
import { expect, test, vi } from 'vitest'
import { builtInModules, preloadPage } from './registry'
import { preloadable } from './extensions'
import type { ModuleManifest } from './extensions'

const LAZY = Symbol.for('react.lazy')
const isLazy = (part: unknown) => (part as { $$typeof?: symbol } | undefined)?.$$typeof === LAZY

test('every lazy page and page navigation of a built-in module can preload', () => {
  const plain = builtInModules.flatMap((module) =>
    (module.pages ?? []).flatMap((page) =>
      [page.component, page.sidebarNav]
        .filter((part) => isLazy(part) && !('preload' in (part as object)))
        .map(() => `${module.id}:${page.id}`),
    ),
  )
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
