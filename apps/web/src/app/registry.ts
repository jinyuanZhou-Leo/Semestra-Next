import type { PluginCatalog } from '@semestra/api-client'
import { pluginsCatalogListOptions } from '@semestra/api-client/react-query'
import { type QueryClient, skipToken, useQueries, useQuery } from '@tanstack/react-query'
import {
  type ComponentType,
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useMemo,
} from 'react'
import academics from '@/modules/academics/manifest'
import ai from '@/modules/ai/manifest'
import assistant from '@/modules/assistant/manifest'
import auth from '@/modules/auth/manifest'
import files from '@/modules/files/manifest'
import grading from '@/modules/grading/manifest'
import imports from '@/modules/imports/manifest'
import lms from '@/modules/lms/manifest'
import canvasTab from '@/modules/plugin-canvas-tab/manifest'
import counter from '@/modules/plugin-counter/manifest'
import habitStreak from '@/modules/plugin-habit-streak/manifest'
import pomodoro from '@/modules/plugin-pomodoro/manifest'
import stickyNote from '@/modules/plugin-sticky-note/manifest'
import worldClock from '@/modules/plugin-world-clock/manifest'
import plugins from '@/modules/plugins/manifest'
import portability from '@/modules/portability/manifest'
import schedule from '@/modules/schedule/manifest'
import settings from '@/modules/settings/manifest'
import tasks from '@/modules/tasks/manifest'
import type {
  BoardKind,
  CalendarSourceContribution,
  CardContribution,
  InvalidationTarget,
  ModuleManifest,
  PageContribution,
  Scope,
  SettingsLevel,
  SettingsSectionContribution,
  StatusItemContribution,
} from './extensions'
import { preload } from './extensions'
import { boardOptions, boardRef } from './board/queries'

/**
 * Every frontend module's manifest (M00 §4.4). Add new modules here, in no particular order.
 * `modules/_template` is a starting point to copy and is deliberately not listed.
 */
export const builtInModules: readonly ModuleManifest[] = [
  auth,
  settings,
  academics,
  grading,
  ai,
  assistant,
  plugins,
  schedule,
  files,
  imports,
  tasks,
  lms,
  portability,
  habitStreak,
  pomodoro,
  stickyNote,
  counter,
  worldClock,
  canvasTab,
]

/**
 * Loads a page's code and its sidebar navigation before it renders, from a route loader (which
 * also runs when a link to the page is hovered); see `preloadable`. The router waits for it, so
 * the previous page stays on screen instead of a blank one. Meanwhile the page's data starts
 * (`PageContribution.prefetch`), and so does its board: the saved layout, then the code of the
 * cards in it, without holding up the switch (a card still loading shows its own skeleton).
 * Only installed modules count, so cards of plugins the account has not installed stay out.
 */
export function preloadPage(
  scope: Scope,
  pageId: string,
  queryClient: QueryClient,
  {
    preload: hovered = false,
    modules = installedModules(queryClient),
  }: {
    /** From the loader's context: a hovered link rather than a navigation. */
    preload?: boolean
    modules?: readonly ModuleManifest[]
  } = {},
): Promise<void> {
  const parts: unknown[] = []
  for (const module of modules) {
    for (const page of module.pages ?? []) {
      if (page.id !== pageId || !page.scopes.includes(scope.kind)) continue
      parts.push(page.component, page.sidebarNav)
      page.prefetch?.(scope, queryClient, { preload: hovered })
      if (page.board) preloadBoardCards(scope, page.board, queryClient, modules)
    }
  }
  return Promise.all(parts.map(preload)).then(() => undefined)
}

function preloadBoardCards(
  scope: Scope,
  board: 'scope' | 'today',
  queryClient: QueryClient,
  modules: readonly ModuleManifest[],
) {
  const ref = boardRef(scope, board === 'today' ? 'today' : undefined)
  queryClient
    .ensureQueryData(boardOptions(ref))
    .then((layout) => {
      const shown = new Set(layout.cards.map((card) => card.card_id))
      for (const module of modules) {
        for (const card of module.cards ?? []) {
          if (shown.has(card.id) && card.scopes.includes(ref.scope_type))
            void preload(card.component)
        }
      }
    })
    // The board shows the error itself once it renders.
    .catch(() => undefined)
}

/**
 * Core modules and the plugins this account installed, from the cached plugin catalog (which
 * the signed-in layout prefetches). Until it has loaded, only core modules.
 */
export function installedModules(
  queryClient: QueryClient,
  modules: readonly ModuleManifest[] = builtInModules,
): readonly ModuleManifest[] {
  const catalog = queryClient.getQueryData(pluginsCatalogListOptions().queryKey)
  const installed = catalog ? installedIds(catalog) : NONE
  return modules.filter((m) => m.kind === 'core' || installed.has(m.id))
}

/** Tests provide their own list: `<ModuleRegistry value={[manifest]}>`. */
export const ModuleRegistry = createContext<readonly ModuleManifest[]>(builtInModules)

/** Every module the app ships, installed or not (the plugin catalog). */
export function useAllModules(): readonly ModuleManifest[] {
  return useContext(ModuleRegistry)
}

function installedIds(catalog: PluginCatalog): ReadonlySet<string> {
  return new Set(catalog.items.filter((p) => p.installed).map((p) => p.id))
}

const NONE: ReadonlySet<string> = new Set()

/** Ids of the installed plugins; null means "do not filter" (tests, or the catalog failed). */
const InstalledPlugins = createContext<ReadonlySet<string> | null>(null)
/** False while the catalog is loading, when installed plugins are not known yet. */
const InstalledPluginsReady = createContext(true)

/**
 * Loads which plugins this account installed (M10 §1), for everything below it. Plugins stay
 * hidden until the catalog has loaded; if it cannot load they all show, since the backend still
 * refuses a plugin's capabilities while it is not installed.
 */
export function InstalledPluginsProvider({ children }: { children: ReactNode }) {
  const hasPlugins = useAllModules().some((m) => m.kind === 'plugin')
  const { data, isError } = useQuery({
    ...pluginsCatalogListOptions(),
    enabled: hasPlugins,
    select: installedIds,
  })
  const value = !hasPlugins || isError ? null : (data ?? NONE)
  const ready = !hasPlugins || isError || data !== undefined
  return createElement(
    InstalledPluginsReady.Provider,
    { value: ready },
    createElement(InstalledPlugins.Provider, { value }, children),
  )
}

/**
 * Whether the installed plugins are known. Until then their cards and pages are missing, so
 * anything that saves a whole list (a board layout) must wait for it.
 */
export function useInstalledPluginsReady(): boolean {
  return useContext(InstalledPluginsReady)
}

/** The modules in use: core modules, and the plugins this account installed. */
export function useModules(): readonly ModuleManifest[] {
  const all = useAllModules()
  const installed = useContext(InstalledPlugins)
  return useMemo(
    () => (installed ? all.filter((m) => m.kind === 'core' || installed.has(m.id)) : all),
    [all, installed],
  )
}

function byOrder<T extends { order: number }>(a: T, b: T) {
  return a.order - b.order
}

export type PageStatus = 'available' | 'pending' | 'unavailable'

/**
 * Every page of a scope with whether it is available there. Pages with an `availabilityQuery`
 * are `pending` until it has loaded, and unavailable if it fails.
 */
export function usePageStatuses(scope: Scope): { page: PageContribution; status: PageStatus }[] {
  const pages = useModules()
    .flatMap((m) => m.pages ?? [])
    .filter((p) => p.scopes.includes(scope.kind))
    .sort(byOrder)
  const queries = pages.map((p) => p.availabilityQuery?.(scope) ?? null)
  const results = useQueries({
    queries: queries.map(
      (query, i) => query ?? { queryKey: ['host.page', pages[i]!.id], queryFn: skipToken },
    ),
  })
  return pages.map((page, i) => {
    const result = results[i]!
    if (queries[i] && result.isPending) return { page, status: 'pending' }
    if (queries[i] && result.isError) return { page, status: 'unavailable' }
    const ok = page.isAvailable?.(scope, queries[i] ? result.data : undefined) ?? true
    return { page, status: ok ? 'available' : 'unavailable' }
  })
}

export function usePages(scope: Scope): PageContribution[] {
  return usePageStatuses(scope)
    .filter((p) => p.status === 'available')
    .map((p) => p.page)
}

export function useCards(board: BoardKind): CardContribution[] {
  return useModules()
    .flatMap((m) => m.cards ?? [])
    .filter((c) => c.scopes.includes(board))
}

export function useCalendarSources(): CalendarSourceContribution[] {
  return useModules().flatMap((m) => m.calendarSources ?? [])
}

export function useSettingsSections(level: SettingsLevel): SettingsSectionContribution[] {
  return useModules()
    .flatMap((m) => m.settingsSections ?? [])
    .filter((s) => s.level === level)
    .sort(byOrder)
}

export function useStatusItems(): StatusItemContribution[] {
  return useModules()
    .flatMap((m) => m.statusItems ?? [])
    .sort(byOrder)
}

export function useOverlays(): ComponentType[] {
  return useModules().flatMap((m) => m.overlays ?? [])
}

/** All contributions to an extension point another module defined, e.g. `'academics.courseColumns'`. */
export function useExtensions<T>(point: string): T[] {
  return useModules().flatMap((m) => (m.extensions?.[point] ?? []) as readonly T[])
}

export function mergeInvalidations(
  modules: readonly ModuleManifest[],
  base: Readonly<Record<string, readonly InvalidationTarget[]>> = {},
): Record<string, InvalidationTarget[]> {
  const merged: Record<string, InvalidationTarget[]> = {}
  for (const map of [base, ...modules.map((m) => m.realtimeInvalidations ?? {})]) {
    for (const [type, prefixes] of Object.entries(map)) {
      merged[type] = [...(merged[type] ?? []), ...prefixes]
    }
  }
  return merged
}

/** UI state the host itself keeps (sidebar, status bar, command palette). */
const HOST_UI_PREF_PREFIXES = ['layout.', 'commands.']

/** What the signed-in layout prefetches: the host's prefixes and every module's own. */
export function uiPrefPrefixes(modules: readonly ModuleManifest[] = builtInModules): string[] {
  return [...new Set([...HOST_UI_PREF_PREFIXES, ...modules.flatMap((m) => m.uiPrefPrefixes ?? [])])]
}

export function mergeSkipOwn(modules: readonly ModuleManifest[]): Set<string> {
  return new Set(modules.flatMap((m) => m.realtimeSkipOwn ?? []))
}
