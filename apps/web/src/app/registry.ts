import type { PluginCatalog } from '@semestra/api-client'
import { pluginsCatalogListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { createContext, createElement, type ReactNode, useContext, useMemo } from 'react'
import academics from '@/modules/academics/manifest'
import auth from '@/modules/auth/manifest'
import plugins from '@/modules/plugins/manifest'
import settings from '@/modules/settings/manifest'
import type {
  BoardKind,
  CardContribution,
  ModuleManifest,
  PageContribution,
  QueryKeyPrefix,
  Scope,
  SettingsLevel,
  SettingsSectionContribution,
  StatusItemContribution,
} from './extensions'

/**
 * Every frontend module's manifest (M00 §4.4). Add new modules here, in no particular order.
 * `modules/_template` is a starting point to copy and is deliberately not listed.
 */
export const builtInModules: readonly ModuleManifest[] = [auth, settings, academics, plugins]

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
  return createElement(InstalledPlugins.Provider, { value }, children)
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

export function usePages(scope: Scope): PageContribution[] {
  return useModules()
    .flatMap((m) => m.pages ?? [])
    .filter((p) => p.scopes.includes(scope.kind) && (p.isAvailable?.(scope) ?? true))
    .sort(byOrder)
}

export function useCards(board: BoardKind): CardContribution[] {
  return useModules()
    .flatMap((m) => m.cards ?? [])
    .filter((c) => c.scopes.includes(board))
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

/** All contributions to an extension point another module defined, e.g. `'academics.courseColumns'`. */
export function useExtensions<T>(point: string): T[] {
  return useModules().flatMap((m) => (m.extensions?.[point] ?? []) as readonly T[])
}

export function mergeInvalidations(
  modules: readonly ModuleManifest[],
  base: Readonly<Record<string, readonly QueryKeyPrefix[]>> = {},
): Record<string, QueryKeyPrefix[]> {
  const merged: Record<string, QueryKeyPrefix[]> = {}
  for (const map of [base, ...modules.map((m) => m.realtimeInvalidations ?? {})]) {
    for (const [type, prefixes] of Object.entries(map)) {
      merged[type] = [...(merged[type] ?? []), ...prefixes]
    }
  }
  return merged
}
