import type { NavTab } from '@semestra/api-client'

/** Canvas tabs the plugin shows with its own views (M16 §3). */
export const NATIVE_VIEWS = [
  'home',
  'announcements',
  'assignments',
  'grades',
  'modules',
  'pages',
  'quizzes',
  'syllabus',
] as const
export type NativeView = (typeof NATIVE_VIEWS)[number]

/** Hidden like in the old Canvas tab: files are reached through modules, discussions in Canvas. */
const HIDDEN_KINDS: ReadonlySet<string> = new Set(['files', 'discussions'])

function isNative(kind: string): kind is NativeView {
  return (NATIVE_VIEWS as readonly string[]).includes(kind)
}

/**
 * Where the user is: `tab` is a native view's name, or `tab:<external id>` for an external tool
 * or a tab the app does not know; `ref` is the item open in it (a page, an announcement...).
 */
export type CanvasLocation = { tab: string; ref?: string }

export type NavEntry =
  | { key: NativeView; kind: 'native'; label: string; tab: NavTab }
  | { key: string; kind: 'external' | 'unknown'; label: string; tab: NavTab }

/** The course menu as Canvas has it, minus hidden tabs, files and discussions. */
export function navEntries(tabs: readonly NavTab[]): NavEntry[] {
  const seen = new Set<string>()
  const entries: NavEntry[] = []
  for (const tab of tabs.toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    if (tab.hidden || HIDDEN_KINDS.has(tab.kind)) continue
    const entry: NavEntry = isNative(tab.kind)
      ? { key: tab.kind, kind: 'native', label: tab.label, tab }
      : {
          key: `tab:${tab.external_id}`,
          kind: tab.kind === 'external' ? 'external' : 'unknown',
          label: tab.label,
          tab,
        }
    if (seen.has(entry.key)) continue
    seen.add(entry.key)
    entries.push(entry)
  }
  return entries
}

export type Resolved =
  | { kind: 'native'; view: NativeView; ref?: string; entry?: NavEntry }
  | { kind: 'external' | 'unknown'; entry: NavEntry }

/**
 * What a location shows. Native views open even when their tab is hidden (a module item can
 * point to a quiz); a tab that is gone falls back to the home view.
 */
export function resolveLocation(location: CanvasLocation, entries: readonly NavEntry[]): Resolved {
  const entry = entries.find((e) => e.key === location.tab)
  if (isNative(location.tab))
    return { kind: 'native', view: location.tab, ref: location.ref, entry }
  if (entry && entry.kind !== 'native') return { kind: entry.kind, entry }
  return { kind: 'native', view: 'home', entry: entries.find((e) => e.key === 'home') }
}

export type HomeView = 'front_page' | 'modules' | 'syllabus' | 'assignments' | 'announcements'

/** The home tab follows the course's Canvas `default_view`. */
export function homeView(defaultView: string | null | undefined): HomeView {
  switch (defaultView) {
    case 'wiki':
      return 'front_page'
    case 'modules':
    case 'syllabus':
    case 'assignments':
      return defaultView
    case 'feed':
      return 'announcements'
    default:
      return 'modules'
  }
}

/**
 * Where a Canvas link inside HTML or a module item opens in the plugin. Files open in the
 * preview instead, and discussions stay in Canvas: both give null.
 */
export function refLocation(ref: { kind: string; ref: string }): CanvasLocation | null {
  switch (ref.kind) {
    case 'page':
      return { tab: 'pages', ref: ref.ref }
    case 'assignment':
      return { tab: 'assignments', ref: ref.ref }
    case 'quiz':
      return { tab: 'quizzes', ref: ref.ref }
    case 'module':
      return { tab: 'modules', ref: ref.ref }
    case 'announcement':
      return { tab: 'announcements', ref: ref.ref }
    default:
      return null
  }
}
