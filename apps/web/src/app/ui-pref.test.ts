import { act, renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import { useUiPref } from './ui-pref'

test('keeps a value per key and reloads it when the key changes', () => {
  localStorage.setItem('semestra.ui.course.c2.sort', '"grade"')
  const { result, rerender } = renderHook(({ id }) => useUiPref(`course.${id}.sort`, 'name'), {
    initialProps: { id: 'c1' },
  })
  expect(result.current[0]).toBe('name')
  act(() => result.current[1]('date'))
  expect(localStorage.getItem('semestra.ui.course.c1.sort')).toBe('"date"')

  rerender({ id: 'c2' })
  expect(result.current[0]).toBe('grade')
  rerender({ id: 'c1' })
  expect(result.current[0]).toBe('date')
})
