import { type ReactNode, createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'

type ThemeState = { theme: Theme; resolved: 'light' | 'dark'; setTheme: (theme: Theme) => void }

const STORAGE_KEY = 'semestra.theme'
const ThemeContext = createContext<ThemeState | null>(null)

function stored(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Applies light, dark or the system theme as the `dark` class on <html> (M00 §4.6). The choice is
 * kept in localStorage; M11 connects it to the user's preference.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(stored)
  const [system, setSystem] = useState(systemTheme)

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystem(query.matches ? 'dark' : 'light')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const resolved = theme === 'system' ? system : theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])

  const setTheme = (next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Not persisted; still applied for this visit.
    }
  }

  return <ThemeContext value={{ theme, resolved, setTheme }}>{children}</ThemeContext>
}

export function useTheme(): ThemeState {
  const state = useContext(ThemeContext)
  if (!state) throw new Error('useTheme must be used inside <ThemeProvider>')
  return state
}
