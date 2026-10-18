import type { LucideIcon } from 'lucide-react'
import type { ComponentType, LazyExoticComponent } from 'react'
import type { ZodType } from 'zod'

/**
 * Extension contract shared by modules and plugins (M00 §4.4). Every frontend module exports
 * `defineModule({...})` from `modules/<id>/manifest.ts` and is listed in `app/registry.ts`.
 */

/** Paraglide message function, e.g. `m.grading_name`. */
export type Message = () => string

export type ScopeKind = 'program' | 'term' | 'course'

export type Scope =
  | { kind: 'program'; programId: string }
  | { kind: 'term'; programId: string; termId: string }
  | { kind: 'course'; programId: string; courseId: string }

type Lazy<P> = ComponentType<P> | LazyExoticComponent<ComponentType<P>>

export type PageProps = { scope: Scope }

export type PageContribution = {
  /** Unique within its scopes; the `$page` URL segment. */
  id: string
  scopes: readonly ScopeKind[]
  title: Message
  icon: LucideIcon
  component: Lazy<PageProps>
  order: number
  isAvailable?: (scope: Scope) => boolean
}

/** s = 1×1, m = 2×1, l = 2×2, xl = 4×2 on a 4-column grid. */
export type CardSize = 's' | 'm' | 'l' | 'xl'

export type CardProps<Settings = unknown> = {
  scope: Scope
  instanceId: string
  size: CardSize
  settings: Settings
}

export type CardContribution = {
  id: string
  scopes: readonly ScopeKind[]
  title: Message
  icon: LucideIcon
  sizes: readonly CardSize[]
  defaultSize: CardSize
  // Each card declares its own settings type; the host only passes what `settings.schema` parses.
  // oxlint-disable-next-line no-explicit-any
  component: Lazy<CardProps<any>>
  settings?: {
    schema: ZodType
    // oxlint-disable-next-line no-explicit-any
    component?: ComponentType<{ value: any; onChange: (value: any) => void }>
  }
  multiple: boolean
}

export type SettingsLevel = 'account' | 'program' | 'term' | 'course'

export type SettingsSectionProps = { scope?: Scope }

/** Details in M11. */
export type SettingsSectionContribution = {
  id: string
  level: SettingsLevel
  title: Message
  order: number
  component: Lazy<SettingsSectionProps>
}

export type CommandContext = { scope?: Scope; navigate: (to: string) => void }

/** Details in M10. A command either runs code or navigates (`to`). */
export type CommandContribution = {
  id: string
  title: Message
  keywords?: readonly string[]
  icon?: LucideIcon
  scopes?: readonly ScopeKind[]
} & ({ run: (ctx: CommandContext) => void | Promise<void> } | { to: string })

/** Defined by M04; kept open here so M04 can refine it without changing the contract. */
export type CalendarSourceContribution = { id: string; title: Message } & Record<string, unknown>

export type SearchResult = { id: string; title: string; subtitle?: string; to: string }

/** Results for the global search (command palette, M10). */
export type SearchProviderContribution = {
  id: string
  title: Message
  search: (query: string, scope?: Scope) => Promise<SearchResult[]>
}

/** `operationId` of a generated query (e.g. `coreJobList`): all its cached queries are refetched. */
export type QueryKeyPrefix = string

export type ModuleManifest = {
  id: string
  /** 'core' cannot be uninstalled; 'plugin' is installed per account (M10). */
  kind: 'core' | 'plugin'
  name: Message
  description: Message
  icon: LucideIcon
  pages?: readonly PageContribution[]
  cards?: readonly CardContribution[]
  settingsSections?: readonly SettingsSectionContribution[]
  commands?: readonly CommandContribution[]
  calendarSources?: readonly CalendarSourceContribution[]
  searchProviders?: readonly SearchProviderContribution[]
  /** Contributions to other modules' extension points, keyed `'<module>.<point>'`. */
  extensions?: Readonly<Record<string, readonly unknown[]>>
  /** SSE event type → queries to refetch when it arrives (see `app/realtime.ts`). */
  realtimeInvalidations?: Readonly<Record<string, readonly QueryKeyPrefix[]>>
}

export function defineModule<const M extends ModuleManifest>(manifest: M): M {
  return manifest
}

/** URL of a scope, or of one of its pages (M00 §4.3). */
export function scopePath(scope: Scope, pageId?: string): string {
  const base =
    scope.kind === 'program'
      ? `/p/${scope.programId}`
      : scope.kind === 'term'
        ? `/p/${scope.programId}/t/${scope.termId}`
        : `/p/${scope.programId}/c/${scope.courseId}`
  return pageId ? `${base}/${pageId}` : base
}
