import {
  settingsSchemaListOptions,
  settingsValueGetOptions,
} from '@semestra/api-client/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Scope, SettingsLevel } from '../extensions'

export type ScopeParams = { scope_type: SettingsLevel; scope_id?: string }

/** Which id of the page's scope belongs to the level being edited. */
export function scopeParamsFor(level: SettingsLevel, scope?: Scope): ScopeParams | null {
  if (level === 'account') return { scope_type: 'account' }
  const id =
    level === 'program'
      ? scope?.programId
      : level === 'term'
        ? scope?.kind === 'term'
          ? scope.termId
          : undefined
        : scope?.kind === 'course'
          ? scope.courseId
          : undefined
  return id ? { scope_type: level, scope_id: id } : null
}

/** What a namespace's form reads: the schemas (one list for all) and its values at `params`. */
export function namespaceQueries(namespace: string, params: ScopeParams) {
  return {
    schemas: { ...settingsSchemaListOptions(), staleTime: Infinity },
    values: settingsValueGetOptions({ path: { namespace }, query: params }),
  }
}

/** Loads what `NamespaceForm` shows, for the settings dialog to show it complete (M11 §5.2). */
export function prefetchNamespaceForm(
  namespace: string,
  level: SettingsLevel,
  scope: Scope | undefined,
  queryClient: QueryClient,
): Promise<unknown> {
  const params = scopeParamsFor(level, scope)
  if (params === null) return Promise.resolve()
  const queries = namespaceQueries(namespace, params)
  return Promise.all([
    queryClient.ensureQueryData(queries.schemas),
    queryClient.ensureQueryData(queries.values),
  ])
}
