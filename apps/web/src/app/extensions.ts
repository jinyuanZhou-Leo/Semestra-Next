import type { JobOut, Occurrence } from '@semestra/api-client'
import type { QueryClient, UseQueryOptions } from '@tanstack/react-query'
import { lazyRouteComponent } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import type { ZodType } from 'zod'

/**
 * Extension contract shared by modules and plugins (M00 §4.4). Every frontend module exports
 * `defineModule({...})` from `modules/<id>/manifest.ts` and is listed in `app/registry.ts`.
 */

/** Paraglide message function, e.g. `m.grading_name`. */
export type Message = () => string

export type ScopeKind = 'program' | 'term' | 'course'

/**
 * Where a card can go: the overview of a Program, term or course, or a Program's Today page
 * (`today`, M04). On the Today board a card gets the Program's scope.
 */
export type BoardKind = ScopeKind | 'today'

export type Scope =
  | { kind: 'program'; programId: string }
  | { kind: 'term'; programId: string; termId: string }
  | { kind: 'course'; programId: string; courseId: string }

/** A component, or one whose code loads on demand (`preloadable`). */
type Lazy<P> = ComponentType<P>

/** `preload` goes away once the code has loaded (see `preloadable`). */
export type Preloadable<P> = ComponentType<P> & { preload?: () => Promise<void> }

/**
 * A component whose code loads on demand, can start loading before it renders, and once loaded
 * renders at once. A plain `React.lazy` suspends on its first render even when its code is
 * already there, and React then keeps the fallback up for at least 300 ms: a blank flash on every
 * first page switch or settings group. Pages, cards and settings sections use this; the router
 * and the settings dialog call `preload` before they show them (see `preloadPage`).
 *
 * Built on TanStack Router's `lazyRouteComponent`, which is not tied to routes: a failed load is
 * forgotten so the next preload or render tries again, and a chunk missing after a deploy
 * reloads the page once.
 */
export function preloadable<P>(load: () => Promise<{ default: ComponentType<P> }>): Preloadable<P> {
  return lazyRouteComponent(load) as unknown as Preloadable<P>
}

/** Starts loading `component` if it is `preloadable`; resolves when it has loaded or failed. */
export function preload(component: unknown): Promise<void> {
  const load = (component as Partial<Preloadable<unknown>> | undefined)?.preload
  return load ? load().catch(() => undefined) : Promise.resolve()
}

export type PageProps = { scope: Scope }

export type PageContribution = {
  /** Unique within its scopes; the `$page` URL segment. */
  id: string
  scopes: readonly ScopeKind[]
  title: Message
  icon: LucideIcon
  component: Lazy<PageProps>
  /** A line for the page header under the title (Program pages; term and course pages keep their own). */
  headerSubtitle?: ComponentType<PageProps>
  /** The board the page shows, if any (the scope's own or Today's), so its cards load with it. */
  board?: 'scope' | 'today'
  /**
   * The page on phones (M17), Program pages only: its own component, written for a narrow
   * screen, in place of `component`. With `tab` it is a tab of the phone's tab bar (by `order`).
   * Pages without it ask for a computer on phones.
   */
  mobile?: { component: Lazy<PageProps>; tab?: { order: number } }
  /**
   * Starts the page's main data along with its code, from the route loader (also on hover), so
   * the page's own queries find it in the cache instead of waiting for the page to mount. Use
   * `queryClient.prefetchQuery` (it never throws): the page still loads and reports its data.
   * `preload` is true for a hovered link, which may never be followed: keep that part cheap.
   * `modules` are the modules in use (core and installed plugins), for data that depends on what
   * other modules contribute (the calendar's sources).
   */
  prefetch?: (
    scope: Scope,
    queryClient: QueryClient,
    options: { preload: boolean; modules: readonly ModuleManifest[] },
  ) => void
  order: number
  /** `data` is what `availabilityQuery` loaded (undefined without one). */
  isAvailable?: (scope: Scope, data: unknown) => boolean
  /**
   * Data `isAvailable` needs beyond the scope, e.g. a course's LMS link (M16). It goes through
   * the query cache, so a page that loads the same data anyway shares the request; the page is
   * left out until it has loaded. null: nothing to load for this scope.
   */
  // oxlint-disable-next-line no-explicit-any
  availabilityQuery?: (scope: Scope) => UseQueryOptions<any, any, any, any> | null
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
  scopes: readonly BoardKind[]
  title: Message
  icon: LucideIcon
  sizes: readonly CardSize[]
  defaultSize: CardSize
  // Each card declares its own settings type; the host only passes what `settings.schema` parses.
  // oxlint-disable-next-line no-explicit-any
  component: Lazy<CardProps<any>>
  /**
   * Per-instance settings, edited from the card's gear button: `component` if given, else a
   * form generated from `schema` (texts `settings_card_<card id>_<field>_label|_description`,
   * dots and dashes as underscores). `fields` hides fields the card itself writes (a counter's
   * value) or orders them. The schema's JSON Schema is exported to the backend for validation.
   * `component` also gets the board's `scope`.
   */
  settings?: {
    schema: ZodType
    // oxlint-disable-next-line no-explicit-any
    component?: ComponentType<{ value: any; onChange: (value: any) => void; scope?: Scope }>
    fields?: FieldOverrides
  }
  multiple: boolean
  /**
   * Starts the card's main data along with its code when a page shows the board it is on, so it
   * does not wait for the card to mount (like `PageContribution.prefetch`, but not for a hovered
   * link). Only data that does not depend on the card's settings. `scope` is the page's (the
   * Program's for Today); `modules` are the modules in use.
   */
  prefetch?: (
    scope: Scope,
    queryClient: QueryClient,
    options: { modules: readonly ModuleManifest[] },
  ) => void
  /**
   * A small (S, 1×1) card has no title row: its content says what it is in its first line (a
   * stat's label, a habit's name) and the header's buttons float over the top right corner. Set
   * this when the content cannot name itself, to keep the title row on S too.
   */
  keepTitleWhenSmall?: boolean
  /**
   * Buttons in the card's header next to its title (e.g. a counter's reset). Like the settings
   * button, the host shows them on hover or focus (always on touch screens), not the card.
   */
  // oxlint-disable-next-line no-explicit-any
  headerActions?: ComponentType<CardProps<any>>
  description?: Message
}

/** A card of a module's default layout; `size` falls back to the card's `defaultSize`. */
export type BoardSlot = { card: string; size?: CardSize }

export type SettingsLevel = 'account' | 'program' | 'term' | 'course'

export type SettingsSectionProps = { scope?: Scope }

/**
 * Where a section sits in the settings navigation (M11 §5.1). A section without a group goes to
 * 'features' at account level and 'general' on Program, term and course pages.
 */
export type SettingsGroup =
  | 'general'
  | 'grades'
  | 'account'
  | 'security'
  | 'preferences'
  | 'ai-providers'
  | 'ai-models'
  | 'ai-usage'
  | 'ai-permissions'
  | 'ai-memory'
  | 'ai-mcp'
  | 'calendar'
  | 'features'
  | 'integrations'
  | 'plugins'
  | 'data'
  | 'about'

export type FieldControl = 'switch' | 'select' | 'segmented' | 'number' | 'text' | 'time'

/** Tweaks for a form generated from a namespace's JSON Schema. */
export type FieldOverrides = {
  /** Fields in the order to show; fields not listed follow in schema order. */
  order?: readonly string[]
  /** Fields to leave out of the form. */
  hidden?: readonly string[]
  /** Force a control instead of the one picked from the field's type. */
  controls?: Readonly<Record<string, FieldControl>>
}

type SettingsSectionBase = {
  id: string
  level: SettingsLevel
  group?: SettingsGroup
  title: Message
  description?: Message
  icon?: LucideIcon
  order: number
  /** Irreversible actions of the group (delete…): the title turns red. Give it the highest `order`. */
  danger?: boolean
  /** Marks a plugin's section: shown on its plugin page (M10), not in the settings navigation. */
  pluginId?: string
}

/**
 * A settings section (M11 §5.1): either a custom `component`, or a `namespace` registered in
 * the backend with `register_settings`, for which the form is generated from its schema. Field
 * texts come from the messages `settings_<namespace>_<field>_label|_description` and
 * `..._option_<value>` (dots and dashes in the namespace become underscores).
 */
export type SettingsSectionContribution = SettingsSectionBase &
  (
    | { component: Lazy<SettingsSectionProps>; namespace?: undefined; fields?: undefined }
    | { namespace: string; fields?: FieldOverrides; component?: undefined }
  )

export type CommandContext = {
  /** The scope of the page the palette was opened on. */
  scope?: Scope
  /** The Program being viewed (also on account settings pages). */
  programId?: string
  navigate: (to: string) => void
  /** For commands that need data: read it through the cache (`fetchQuery`). */
  queryClient: QueryClient
}

/**
 * An entry of the command palette (M10 §5.4). It runs code, navigates (`to`), or opens a
 * second list (`useChildren`, a hook called while that list is open, e.g. "Switch term →"). `scopes` limits it to pages of those scopes.
 */
export type CommandContribution = {
  id: string
  title: Message
  keywords?: readonly string[]
  icon?: LucideIcon
  scopes?: readonly ScopeKind[]
  /** Hides the command when it cannot run here, e.g. "Add card" on a page without a board. */
  isAvailable?: (ctx: CommandContext) => boolean
  /** A shortcut shown next to the command (the shortcut itself is registered with `useHotkey`). */
  hotkey?: string
} & (
  | { run: (ctx: CommandContext) => void | Promise<void> }
  | { to: string }
  | { useChildren: (ctx: CommandContext) => readonly CommandChild[] }
)

/** An entry of a command's second-level list. */
export type CommandChild = {
  id: string
  title: string
  subtitle?: string
  keywords?: readonly string[]
  icon?: LucideIcon
  /** A colour dot, e.g. a course colour. */
  dot?: string
} & ({ run: (ctx: CommandContext) => void | Promise<void> } | { to: string })

/**
 * Entries of the palette's "Navigation" group besides the scope's pages (M10 §5.4), e.g. the
 * terms and courses of the Program. `useItems` is a hook, called while the palette is open.
 */
export type NavigationSourceContribution = {
  id: string
  useItems: (ctx: CommandContext) => readonly CommandChild[]
}

/** The AI assistant (M12): `Cmd/Ctrl + J` and the palette's "Ask AI" call `open`. */
export type AssistantContribution = {
  /** Without a question it toggles the panel; with one it asks it in a new conversation. */
  open: (ctx: CommandContext, question?: string) => void
  /** Whether the panel is open (for `useSyncExternalStore`), e.g. to highlight its entry. */
  panel: { subscribe: (listener: () => void) => () => void; isOpen: () => boolean }
  /** Wraps the app shell's content and docks the panel beside it (M12 §6.1). */
  Dock: ComponentType<{ children: ReactNode }>
  /** Recent conversations under the assistant's sidebar entry while its full page is open. */
  SidebarNav?: Lazy<{ programId: string }>
  /** The assistant on a phone (M17): a tab after the pages' tabs, at the full page's addresses. */
  mobile?: Lazy<{ programId: string; sessionId: string | null }>
}

/**
 * A calendar source's label, icon and click behaviour in the calendar (M04 §5.2). The data itself
 * always comes from the backend source of the same name (`calendar.occurrence.list`).
 */
export type CalendarSourceContribution = {
  /** Backend source name, e.g. 'grading.assessments'. */
  source: string
  label: Message
  icon: LucideIcon
  /** Shown before the user changes the calendar's filters. */
  defaultVisible: boolean
  /** "Open" in the occurrence's details; without it the details have no open action. */
  onOpen?: (
    occurrence: Occurrence,
    navigate: (to: string) => void,
    ctx: { programId: string },
  ) => void
}

export type SearchResult = { id: string; title: string; subtitle?: string; to: string }

/** Results for the global search (command palette, M10). */
export type SearchProviderContribution = {
  id: string
  title: Message
  search: (query: string, scope?: Scope) => Promise<SearchResult[]>
}

/** One line of the sidebar status bar: something still in progress the user should see anywhere. */
export type StatusItem = {
  icon: LucideIcon
  label: string
  /** 0–100; shows a thin bar under the label. */
  progress?: number
  /** Where clicking the line goes. */
  to?: string
  tone?: 'default' | 'success' | 'error'
}

/**
 * Rendered at the bottom of the sidebar by the host (M10): a running timer, a background or AI
 * task. Not for notifications. `useStatus` is a hook; returning null hides the line.
 */
export type StatusItemContribution = {
  id: string
  order: number
  useStatus: () => StatusItem | null
}

/**
 * How the status bar names a kind of background job (`core_jobs.kind`) and where clicking it goes,
 * e.g. the import review page of a syllabus parse (M10 §5.6).
 */
export type JobKindContribution = {
  kind: string
  title: Message
  /** The page the job belongs to; `job.result` is available once it has finished. */
  to?: (job: JobOut) => string | undefined
}

/** `operationId` of a generated query (e.g. `coreJobList`): all its cached queries are refetched. */
export type QueryKeyPrefix = string

/**
 * Part of a generated query key: the cached queries whose key contains it are refetched, e.g.
 * `{ _id: 'gradingGradebookGet', path: { course_id } }` refetches one course's gradebook only.
 */
export type QueryMatch = { readonly _id: QueryKeyPrefix } & Readonly<Record<string, unknown>>

/** What an SSE event refetches: whole operations, or what a function of its data names. */
export type InvalidationTarget =
  | QueryKeyPrefix
  | ((data: Readonly<Record<string, unknown>>) => readonly (QueryKeyPrefix | QueryMatch)[])

export type ModuleManifest = {
  id: string
  /** 'core' cannot be uninstalled; 'plugin' is installed per account (M10). */
  kind: 'core' | 'plugin'
  name: Message
  description: Message
  icon: LucideIcon
  /** What a plugin needs before it is useful, shown on its catalog page (M10 §5.3). */
  requirements?: Message
  pages?: readonly PageContribution[]
  cards?: readonly CardContribution[]
  settingsSections?: readonly SettingsSectionContribution[]
  commands?: readonly CommandContribution[]
  navigationSources?: readonly NavigationSourceContribution[]
  /** At most one module provides the assistant. */
  assistant?: AssistantContribution
  calendarSources?: readonly CalendarSourceContribution[]
  searchProviders?: readonly SearchProviderContribution[]
  statusItems?: readonly StatusItemContribution[]
  jobKinds?: readonly JobKindContribution[]
  /**
   * Components rendered once for the whole signed-in app, e.g. a dialog other modules open
   * through a function (the import review that `launch()` of an import source opens, M08).
   */
  overlays?: readonly ComponentType[]
  /** Contributions to other modules' extension points, keyed `'<module>.<point>'`. */
  extensions?: Readonly<Record<string, readonly unknown[]>>
  /** Cards placed on new boards of each kind, appended in registry order (M10 §2). */
  defaultBoard?: Readonly<Partial<Record<BoardKind, readonly BoardSlot[]>>>
  /** Prefixes of the UI state keys the module reads (`useUiPref`), prefetched at sign-in. */
  uiPrefPrefixes?: readonly string[]
  /** SSE event type → queries to refetch when it arrives (see `app/realtime.ts`). */
  realtimeInvalidations?: Readonly<Record<string, readonly InvalidationTarget[]>>
  /**
   * Event types this tab ignores when its own request caused them: list one only if every
   * mutation behind it already updates or invalidates its queries (`app/realtime.ts`).
   */
  realtimeSkipOwn?: readonly string[]
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

/** URL of a scope's settings page, optionally of one group of sections (M11 §5.2). */
export function scopeSettingsPath(scope: Scope, group?: string): string {
  const base = `${scopePath(scope)}/settings`
  return group ? `${base}/${group}` : base
}
