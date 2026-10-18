import { expect, test } from 'vitest'
import type { SettingsSectionContribution } from '../extensions'
import { buildNavigation, groupOf, isNavigable } from './groups'

function section(
  id: string,
  overrides: Pick<
    Partial<SettingsSectionContribution>,
    'group' | 'level' | 'order' | 'pluginId'
  > = {},
): SettingsSectionContribution {
  return { id, level: 'account', title: () => id, order: 100, namespace: `x.${id}`, ...overrides }
}

test('groups follow the fixed navigation order and sections follow their order', () => {
  const groups = buildNavigation(
    [
      section('about', { group: 'about' }),
      section('b', { group: 'preferences', order: 20 }),
      section('a', { group: 'preferences', order: 10 }),
      section('profile', { group: 'account' }),
    ],
    'account',
  )
  expect(groups.map((g) => g.id)).toEqual(['account', 'preferences', 'about'])
  expect(groups[1]!.sections.map((s) => s.id)).toEqual(['a', 'b'])
})

test('sections without a group go to Features (account) or General (scoped levels)', () => {
  expect(groupOf(section('a'))).toBe('features')
  expect(groupOf(section('a', { level: 'program' }))).toBe('general')
  expect(groupOf(section('a', { group: 'data' }))).toBe('data')
})

test('only the requested level is listed, and empty groups never appear', () => {
  const sections = [section('a', { level: 'program' }), section('b', { group: 'about' })]
  expect(buildNavigation(sections, 'program').map((g) => g.id)).toEqual(['general'])
  expect(buildNavigation(sections, 'course')).toEqual([])
})

test("an account-level plugin section lives on the plugin's page, not in the navigation", () => {
  const plugin = section('p', { pluginId: 'canvas' })
  expect(isNavigable(plugin)).toBe(false)
  expect(isNavigable(section('p', { pluginId: 'canvas', level: 'program' }))).toBe(true)
  expect(buildNavigation([plugin], 'account')).toEqual([])
})
