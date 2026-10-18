import { describe, expect, test } from 'vitest'
import { matchScore, pinyinInitials, pushRecent, rank } from './rank'

const items = [
  { key: 'a', title: 'Linear Algebra', subtitle: 'MAT223' },
  { key: 'b', title: 'Calculus I', keywords: ['MAT137'] },
  { key: 'c', title: '高等数学' },
  { key: 'd', title: 'Algorithms' },
  { key: 'e', title: 'Applied algebra' },
]

describe('palette ranking', () => {
  test('prefix beats word prefix beats substring', () => {
    expect(rank(items, 'alg').map((i) => i.key)).toEqual(['d', 'a', 'e'])
    expect(rank(items, 'gebra').map((i) => i.key)).toEqual(['a', 'e'])
  })

  test('subtitle and keywords match below the title at the same tier', () => {
    expect(rank(items, 'mat').map((i) => i.key)).toEqual(['a', 'b'])
    expect(matchScore(items[1]!, 'calc')).toBeGreaterThan(matchScore(items[1]!, 'mat137'))
  })

  test('Chinese titles match their pinyin initials', () => {
    expect(pinyinInitials('高等数学')).toBe('gdsx')
    expect(rank(items, 'gdsx').map((i) => i.key)).toEqual(['c'])
    expect(rank(items, 'sx').map((i) => i.key)).toEqual(['c'])
    expect(rank(items, '数学').map((i) => i.key)).toEqual(['c'])
  })

  test('recently used entries come first without a query and among equals', () => {
    expect(rank(items, '', ['c', 'a']).map((i) => i.key)).toEqual(['c', 'a', 'b', 'd', 'e'])
    expect(rank(items, 'alg', ['e']).map((i) => i.key)).toEqual(['d', 'e', 'a'])
    expect(rank([items[0]!, items[4]!], 'algebra', ['e']).map((i) => i.key)).toEqual(['e', 'a'])
  })

  test('recent list keeps the newest first without duplicates', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b', 3)).toEqual(['b', 'a', 'c'])
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
  })
})
