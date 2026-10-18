import { expect, test } from 'vitest'
import { assessment, category } from './test-data'
import { compareValues, groupByCategory } from './sort'

test('values without a number sort last', () => {
  expect([3, null, 1].toSorted(compareValues)).toEqual([1, 3, null])
  expect(['b', 'a10', 'a2'].toSorted(compareValues)).toEqual(['a2', 'a10', 'b'])
})

test('groups follow the categories order, loose items come last, empty groups are left out', () => {
  const categories = [
    category({ id: 'k2', key: 'lab', name: 'Lab', position: 1 }),
    category({ id: 'k1', key: 'exam', position: 0 }),
    category({ id: 'k3', key: 'quiz', position: 2 }),
  ]
  const items = [
    assessment({ id: 'a', category_id: 'k2' }),
    assessment({ id: 'b' }),
    assessment({ id: 'c', category_id: 'k1' }),
    assessment({ id: 'd', category_id: 'gone' }),
  ]
  const groups = groupByCategory(items, categories, (a) => a.category_id)
  expect(groups.map((g) => [g.category?.id ?? null, g.items.map((i) => i.id)])).toEqual([
    ['k1', ['c']],
    ['k2', ['a']],
    [null, ['b', 'd']],
  ])
})
