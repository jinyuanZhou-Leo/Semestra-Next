import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { setLocale } from '@/paraglide/runtime'
import { LocaleProvider, useLocale } from './locale'

afterEach(() => {
  vi.useRealTimers()
  setLocale('en', { reload: false })
  document.documentElement.removeAttribute('data-remounting')
})

const root = document.documentElement
const mount = () => renderHook(() => useLocale(), { wrapper: LocaleProvider }).result

test('a language change keeps motion off until a while after the re-mount commits', () => {
  vi.useFakeTimers()
  const locale = mount()
  act(() => locale.current.changeLocale('zh-CN'))
  expect(locale.current.locale).toBe('zh-CN')
  expect(root).toHaveAttribute('data-remounting')
  act(() => vi.advanceTimersByTime(650))
  expect(root).toHaveAttribute('data-remounting')
  act(() => vi.advanceTimersByTime(100))
  expect(root).not.toHaveAttribute('data-remounting')
})

test('choosing the language already shown re-mounts nothing and leaves motion alone', () => {
  const locale = mount()
  act(() => locale.current.changeLocale('en'))
  expect(root).not.toHaveAttribute('data-remounting')
})

test('a clock-format change holds motion the same way', () => {
  vi.useFakeTimers()
  const locale = mount()
  act(() => locale.current.refreshFormats())
  expect(root).toHaveAttribute('data-remounting')
  act(() => vi.advanceTimersByTime(750))
  expect(root).not.toHaveAttribute('data-remounting')
})
