import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DEFAULT_APPEARANCE, applyAppearance, resolveTheme, storedAppearance } from './appearance'
import { ThemeProvider, useTheme } from './theme'

function reset() {
  localStorage.clear()
  const root = document.documentElement
  root.className = ''
  root.removeAttribute('data-accent')
  root.removeAttribute('data-reduce-motion')
  root.removeAttribute('lang')
}
beforeEach(reset)
afterEach(reset)

const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>

test('with nothing stored the defaults apply', () => {
  expect(storedAppearance()).toEqual(DEFAULT_APPEARANCE)
})

test('stored values are validated, junk falls back to the defaults', () => {
  localStorage.setItem('semestra.theme', 'dark')
  localStorage.setItem('semestra.accent', '<script>')
  localStorage.setItem('semestra.reduce-motion', 'maybe')
  expect(storedAppearance()).toEqual({ theme: 'dark', accent: 'blue', reduceMotion: 'system' })
})

test('"system" resolves to the device theme, an explicit theme wins', () => {
  expect(resolveTheme('system', 'dark')).toBe('dark')
  expect(resolveTheme('light', 'dark')).toBe('light')
})

test('applyAppearance writes the class and data attributes the stylesheet keys on', () => {
  applyAppearance({ theme: 'dark', accent: 'rose', reduceMotion: 'on' }, 'dark')
  const root = document.documentElement
  expect(root).toHaveClass('dark')
  expect(root).toHaveAttribute('data-accent', 'rose')
  expect(root).toHaveAttribute('data-reduce-motion', 'on')
  applyAppearance({ theme: 'light', accent: 'rose', reduceMotion: 'system' }, 'light')
  expect(root).not.toHaveClass('dark')
  expect(root).not.toHaveAttribute('data-reduce-motion')
})

test('the provider applies a change to the page and remembers it for the next first paint', () => {
  const { result } = renderHook(() => useTheme(), { wrapper })
  act(() => result.current.setAccent('teal'))
  act(() => result.current.setTheme('dark'))
  expect(document.documentElement).toHaveAttribute('data-accent', 'teal')
  expect(document.documentElement).toHaveClass('dark')
  expect(localStorage.getItem('semestra.accent')).toBe('teal')
  expect(localStorage.getItem('semestra.theme')).toBe('dark')
})

test('setAppearance with the values already in use changes nothing', () => {
  const { result } = renderHook(() => useTheme(), { wrapper })
  const setSpy = vi.spyOn(Storage.prototype, 'setItem')
  act(() => result.current.setAppearance({ ...DEFAULT_APPEARANCE }))
  expect(setSpy).not.toHaveBeenCalled()
  setSpy.mockRestore()
})

test('the pre-React script gives the first frame the stored theme, accent and language', () => {
  const script = readFileSync(
    path.resolve(import.meta.dirname, '../../public/theme-init.js'),
    'utf8',
  )
  localStorage.setItem('semestra.theme', 'dark')
  localStorage.setItem('semestra.accent', 'amber')
  localStorage.setItem('semestra.reduce-motion', 'on')
  localStorage.setItem('PARAGLIDE_LOCALE', 'zh-CN')
  new Function(script)()
  const root = document.documentElement
  expect(root).toHaveClass('dark')
  expect(root).toHaveAttribute('data-accent', 'amber')
  expect(root).toHaveAttribute('data-reduce-motion', 'on')
  expect(root).toHaveAttribute('lang', 'zh-CN')
})

test('the pre-React script ignores an accent that is not a plain word', () => {
  const script = readFileSync(
    path.resolve(import.meta.dirname, '../../public/theme-init.js'),
    'utf8',
  )
  localStorage.setItem('semestra.accent', 'x" onload="evil')
  new Function(script)()
  expect(document.documentElement).not.toHaveAttribute('data-accent')
})
