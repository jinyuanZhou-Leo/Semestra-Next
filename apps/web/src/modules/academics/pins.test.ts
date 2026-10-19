import { expect, test } from 'vitest'
import { movePin, type Pin } from './pins'

const term = (id: string): Pin => ({ kind: 'term', id })
const course = (id: string): Pin => ({ kind: 'course', id })

test('moving a pin shifts the others, as on screen', () => {
  const pins = [course('a'), term('b'), course('c')]
  expect(movePin(pins, pins, 0, 2)).toEqual([term('b'), course('c'), course('a')])
  expect(movePin(pins, pins, 2, 1)).toEqual([course('a'), course('c'), term('b')])
})

test('pins that are not on screen keep their places', () => {
  const pins = [course('a'), term('hidden'), course('b'), course('gone'), course('c')]
  const shown = [course('a'), course('b'), course('c')]
  expect(movePin(pins, shown, 0, 1)).toEqual([
    course('b'),
    term('hidden'),
    course('a'),
    course('gone'),
    course('c'),
  ])
})

test('moving outside the list changes nothing', () => {
  const pins = [course('a'), course('b')]
  expect(movePin(pins, pins, 0, -1)).toEqual(pins)
  expect(movePin(pins, pins, 1, 2)).toEqual(pins)
})
