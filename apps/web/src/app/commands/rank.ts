import { pinyin } from 'pinyin-pro'

/** What the palette matches a query against. */
export type Matchable = {
  title: string
  subtitle?: string
  keywords?: readonly string[]
}

const PREFIX = 4
const WORD_PREFIX = 3
const SUBSTRING = 2
const PINYIN = 1

const HAN = /\p{Script=Han}/u
const WORD_BREAK = /[\s\-_/·.,:;()（）【】[\]|]+/

const initialsCache = new Map<string, string>()

/** Pinyin initials of the Chinese characters in a text: 高等数学 → gdsx. */
export function pinyinInitials(text: string): string {
  let initials = initialsCache.get(text)
  if (initials === undefined) {
    initials = HAN.test(text)
      ? pinyin(text, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'removed' })
          .join('')
          .toLowerCase()
      : ''
    initialsCache.set(text, initials)
  }
  return initials
}

function tier(text: string, query: string): number {
  const lower = text.toLowerCase()
  if (lower.startsWith(query)) return PREFIX
  if (lower.split(WORD_BREAK).some((word) => word.startsWith(query))) return WORD_PREFIX
  if (lower.includes(query)) return SUBSTRING
  if (/^[a-z]+$/.test(query) && pinyinInitials(text).includes(query)) return PINYIN
  return 0
}

/**
 * How well an entry matches (M10 §5.4): prefix > word prefix > substring > pinyin initials.
 * The title counts more than the subtitle and keywords at the same tier; 0 means no match.
 */
export function matchScore(item: Matchable, rawQuery: string): number {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return 1
  let best = tier(item.title, query) * 10
  for (const other of [item.subtitle, ...(item.keywords ?? [])]) {
    if (other) best = Math.max(best, tier(other, query) * 10 - 5)
  }
  return Math.max(best, 0)
}

/**
 * Filters and orders entries for a query. Without a query: recently used first (most recent
 * first), then the given order. With one: by match score, recently used first among equals.
 */
export function rank<T extends Matchable & { key: string }>(
  items: readonly T[],
  query: string,
  recent: readonly string[] = [],
): T[] {
  const recency = new Map(recent.map((key, index) => [key, index]))
  const byRecency = (key: string) => recency.get(key) ?? Number.POSITIVE_INFINITY
  return items
    .map((item, index) => ({ item, index, score: matchScore(item, query) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || byRecency(a.item.key) - byRecency(b.item.key) || a.index - b.index,
    )
    .map((entry) => entry.item)
}

/** Remembers a used entry: newest first, without duplicates, at most `limit`. */
export function pushRecent(recent: readonly string[], key: string, limit = 20): string[] {
  return [key, ...recent.filter((k) => k !== key)].slice(0, limit)
}
