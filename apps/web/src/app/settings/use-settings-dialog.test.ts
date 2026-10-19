import { expect, test } from 'vitest'
import { parseSettingsParam, settingsHref } from './use-settings-dialog'

test('the scope travels with the level and is dropped for the account and on close', () => {
  expect(parseSettingsParam('term/calendar', 't1')).toEqual({
    level: 'term',
    group: 'calendar',
    scope: 't1',
  })
  expect(parseSettingsParam('account', 't1')).toEqual({ level: 'account', scope: undefined })
  // Old links have no scope: the page supplies it.
  expect(parseSettingsParam('course/general', null)?.scope).toBeUndefined()

  const place = { pathname: '/p/p1', searchStr: '?view=week' }
  expect(settingsHref(place, { level: 'course', group: 'general', scope: 'c1' })).toBe(
    '/p/p1?view=week&settings=course%2Fgeneral&scope=c1',
  )
  expect(settingsHref({ ...place, searchStr: '?settings=term&scope=t1' })).toBe('/p/p1')
})
