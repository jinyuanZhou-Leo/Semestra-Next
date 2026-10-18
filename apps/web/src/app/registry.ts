import { createContext, useContext } from 'react'
import academics from '@/modules/academics/manifest'
import ai from '@/modules/ai/manifest'
import auth from '@/modules/auth/manifest'
import settings from '@/modules/settings/manifest'
import type {
  CardContribution,
  ModuleManifest,
  PageContribution,
  QueryKeyPrefix,
  Scope,
  ScopeKind,
  SettingsLevel,
  SettingsSectionContribution,
  StatusItemContribution,
} from './extensions'

/**
 * Every frontend module's manifest (M00 §4.4). Add new modules here, in no particular order.
 * `modules/_template` is a starting point to copy and is deliberately not listed.
 */
const builtInModules: readonly ModuleManifest[] = [auth, settings, academics, ai]

/** Tests provide their own list: `<ModuleRegistry value={[manifest]}>`. */
export const ModuleRegistry = createContext<readonly ModuleManifest[]>(builtInModules)

/** Installed modules. Until M10 adds installation, every plugin counts as installed. */
export function useModules(): readonly ModuleManifest[] {
  return useContext(ModuleRegistry)
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

export function useCards(scope: ScopeKind): CardContribution[] {
  return useModules()
    .flatMap((m) => m.cards ?? [])
    .filter((c) => c.scopes.includes(scope))
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
