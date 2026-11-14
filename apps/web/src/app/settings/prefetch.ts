import type { QueryClient } from '@tanstack/react-query'
import {
  type ModuleManifest,
  type Scope,
  type SettingsSectionContribution,
  preload,
} from '../extensions'
import { prefetchNamespaceForm } from './NamespaceForm'

/**
 * Longest the dialog keeps the previous group up while the next one loads: on a slow connection
 * the group then shows with its spinners rather than leaving the click without an answer.
 */
export const READY_TIMEOUT_MS = 1000

/** Starts the code and the data of `sections`; resolves when both are in (or failed). */
export function loadSections(
  sections: readonly SettingsSectionContribution[],
  scope: Scope | undefined,
  queryClient: QueryClient,
  modules: readonly ModuleManifest[],
): Promise<void> {
  return Promise.all(
    sections.map((section) =>
      Promise.all([
        preload(section.component),
        (section.namespace !== undefined
          ? prefetchNamespaceForm(section.namespace, section.level, scope, queryClient)
          : (section.prefetch?.(scope, queryClient, { modules }) ?? Promise.resolve())
        ).catch(() => undefined),
      ]),
    ),
  ).then(() => undefined)
}

/** `loadSections`, but resolving after `READY_TIMEOUT_MS` at the latest. */
export function sectionsReady(
  sections: readonly SettingsSectionContribution[],
  scope: Scope | undefined,
  queryClient: QueryClient,
  modules: readonly ModuleManifest[],
): Promise<void> {
  return Promise.race([
    loadSections(sections, scope, queryClient, modules),
    new Promise<void>((resolve) => setTimeout(resolve, READY_TIMEOUT_MS)),
  ])
}
