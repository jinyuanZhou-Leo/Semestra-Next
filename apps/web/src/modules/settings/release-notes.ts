import { getLocale } from '@/paraglide/runtime'

/** One file of `release-notes/` at the repository root (written by `scripts/release.mjs`). */
export type ReleaseItem = {
  kind: 'breaking' | 'new' | 'improved' | 'fixed'
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

/** An item's text in the interface language. */
export function itemText(item: ReleaseItem): string {
  return getLocale().startsWith('zh') ? item.zh : item.en
}
