import { expect, test } from 'vitest'
import { parseScore, scorePatch, scoreText } from './score'

test.each([
  ['82', { kind: 'percentage', value: 82 }],
  [' 82.5% ', { kind: 'percentage', value: 82.5 }],
  ['82,5', { kind: 'percentage', value: 82.5 }],
  ['105', { kind: 'percentage', value: 105 }],
  ['18/20', { kind: 'points', earned: 18, possible: 20 }],
  ['18 / 20', { kind: 'points', earned: 18, possible: 20 }],
  ['18／20', { kind: 'points', earned: 18, possible: 20 }],
  ['0/5', { kind: 'points', earned: 0, possible: 5 }],
  ['', { kind: 'clear' }],
  ['   ', { kind: 'clear' }],
])('parseScore(%j)', (input, expected) => {
  expect(parseScore(input)).toEqual(expected)
})

test.each(['abc', '5/0', '1/2/3', '-3', '18/', '/20', '1001', '8 2'])(
  'parseScore(%j) is invalid',
  (input) => {
    expect(parseScore(input)).toEqual({ kind: 'invalid' })
  },
)

test('a points score is sent as points, a percentage clears the points', () => {
  expect(scorePatch(parseScore('18/20'))).toEqual({ points_earned: 18, points_possible: 20 })
  expect(scorePatch(parseScore('90'))).toEqual({ score_percentage: 90 })
  expect(scorePatch(parseScore(''))).toEqual({ score_percentage: null })
  expect(scorePatch(parseScore('x'))).toBeNull()
})

test('a stored score is shown the way it was typed', () => {
  const none = { score_percentage: null, points_earned: null, points_possible: null }
  expect(scoreText(none)).toBe('')
  expect(scoreText({ ...none, score_percentage: 82.5 })).toBe('82.5')
  expect(scoreText({ score_percentage: 90, points_earned: 18, points_possible: 20 })).toBe('18/20')
})
