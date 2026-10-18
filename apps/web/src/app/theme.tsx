import { MotionConfig } from 'motion/react'
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react'
import {
  type Accent,
  type Appearance,
  type ReduceMotion,
  type Theme,
  applyAppearance,
  resolveTheme,
  storeAppearance,
  storedAppearance,
  systemTheme,
} from './appearance'

export type { Accent, ReduceMotion, Theme }

type ThemeState = Appearance & {
  resolved: 'light' | 'dark'
  setTheme: (theme: Theme) => void
  setAccent: (accent: Accent) => void
  setReduceMotion: (reduceMotion: ReduceMotion) => void
  /** Replace all three at once, e.g. with the server preference after sign-in. */
  setAppearance: (appearance: Appearance) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

/**
 * Theme, accent color and motion setting (M00 §4.6, M11 §5.3). Modules and plugins only read
 * the resulting tokens. The choice is mirrored in localStorage for the pre-React script; the
 * user's preference on the server is applied by `PreferencesSync`.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(storedAppearance)
  const [system, setSystem] = useState(systemTheme)

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystem(query.matches ? 'dark' : 'light')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const resolved = resolveTheme(appearance.theme, system)
  useEffect(() => {
    applyAppearance(appearance, resolved)
  }, [appearance, resolved])

  // Stable functions that ignore a change to the same values: effects can depend on them.
  const setAppearance = useCallback((next: Appearance) => {
    setAppearanceState((current) => {
      if (
        current.theme === next.theme &&
        current.accent === next.accent &&
        current.reduceMotion === next.reduceMotion
      ) {
        return current
      }
      storeAppearance(next)
      return next
    })
  }, [])
  const setTheme = useCallback(
    (theme: Theme) =>
      setAppearanceState((c) => (storeAppearance({ ...c, theme }), { ...c, theme })),
    [],
  )
  const setAccent = useCallback(
    (accent: Accent) =>
      setAppearanceState((c) => (storeAppearance({ ...c, accent }), { ...c, accent })),
    [],
  )
  const setReduceMotion = useCallback(
    (reduceMotion: ReduceMotion) =>
      setAppearanceState((c) => (storeAppearance({ ...c, reduceMotion }), { ...c, reduceMotion })),
    [],
  )

  const value: ThemeState = {
    ...appearance,
    resolved,
    setAppearance,
    setTheme,
    setAccent,
    setReduceMotion,
  }

  return (
    <ThemeContext value={value}>
      <MotionConfig
        reducedMotion={
          appearance.reduceMotion === 'on'
            ? 'always'
            : appearance.reduceMotion === 'off'
              ? 'never'
              : 'user'
        }
      >
        {children}
      </MotionConfig>
    </ThemeContext>
  )
}

export function useTheme(): ThemeState {
  const state = useContext(ThemeContext)
  if (!state) throw new Error('useTheme must be used inside <ThemeProvider>')
  return state
}
