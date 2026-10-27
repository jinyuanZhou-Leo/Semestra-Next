import { getLocale } from '@/paraglide/runtime'
import AREAS from '../../../../../.changeset/areas.json'

/** One file of `release-notes/` at the repository root (written by `scripts/release.mjs`). */
export type ReleaseItem = {
  kind: 'breaking' | 'new' | 'improved' | 'fixed'
  /** A key of `.changeset/areas.json`: the part of the app the note is about. */
  area?: string
  en: string
  zh: string
}

export type Release = {
  version: string
  date: string
  level: 'major' | 'minor' | 'patch'
  items: ReleaseItem[]
}

/** UI state: the newest version whose notes this account has seen (or skipped as new). */
export const LAST_SEEN_KEY = 'release.last_seen'

export const KIND_ORDER: readonly ReleaseItem['kind'][] = ['breaking', 'new', 'improved', 'fixed']

/** At most this many versions in the "What's new" dialog; the rest are on the About page. */
export const DIALOG_MAX_VERSIONS = 3

// Each file is its own small chunk, loaded when a page needs it; the list of versions comes from
// the file names, so knowing which versions exist costs nothing.
const files = import.meta.glob<Release>('../../../../../release-notes/*.json', {
  import: 'default',
})

const byVersion = new Map(
  Object.entries(files).map(([file, load]) => [file.replace(/^.*\/|\.json$/g, ''), load]),
)

/** Plain `MAJOR.MINOR.PATCH` comparison; a pre-release suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/, 3).map(Number)
  const pb = b.split(/[.-]/, 3).map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** Versions that have notes, newest first. */
export function releaseVersions(): string[] {
  return [...byVersion.keys()].toSorted((a, b) => compareVersions(b, a))
}

export async function loadRelease(version: string): Promise<Release | undefined> {
  return byVersion.get(version)?.()
}

/** The notes of every version after `after` up to and including `upTo`, newest first. */
export async function releasesBetween(after: string, upTo: string): Promise<Release[]> {
  const versions = releaseVersions().filter(
    (v) => compareVersions(v, after) > 0 && compareVersions(v, upTo) <= 0,
  )
  const releases = await Promise.all(versions.map(loadRelease))
  return releases.filter((release) => release !== undefined)
}

const AREA_ORDER = Object.keys(AREAS)

function isZh() {
  return getLocale().startsWith('zh')
}

/** An item's text in the interface language. */
export function itemText(item: ReleaseItem): string {
  return isZh() ? item.zh : item.en
}

/** The name of the part of the app an item is about, in the interface language. */
export function itemArea(item: ReleaseItem): string | undefined {
  const area = item.area
    ? (AREAS as Record<string, { en: string; zh: string }>)[item.area]
    : undefined
  return area && (isZh() ? area.zh : area.en)
}

/** Items in the order of `.changeset/areas.json`, so notes about one part sit together. */
export function byArea(items: ReleaseItem[]): ReleaseItem[] {
  const rank = (item: ReleaseItem) => {
    const index = item.area ? AREA_ORDER.indexOf(item.area) : -1
    return index === -1 ? AREA_ORDER.length : index
  }
  return items.toSorted((a, b) => rank(a) - rank(b))
}
