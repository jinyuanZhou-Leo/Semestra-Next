/**
 * The three appearance preferences (M11 §5.3) and how they reach the document. The matching
 * pre-React script is `public/theme-init.js`; keep the two in sync.
 */

export type Theme = 'light' | 'dark' | 'system'
export type Accent = 'neutral' | 'blue' | 'violet' | 'green' | 'orange' | 'rose' | 'teal' | 'amber'
export type ReduceMotion = 'system' | 'on' | 'off'

export const ACCENTS: readonly Accent[] = [
  'neutral',
  'blue',
  'violet',
  'green',
  'orange',
  'rose',
  'teal',
  'amber',
]

export type Appearance = { theme: Theme; accent: Accent; reduceMotion: ReduceMotion }

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'system',
  accent: 'blue',
  reduceMotion: 'system',
}

const KEYS = {
  theme: 'semestra.theme',
  accent: 'semestra.accent',
  reduceMotion: 'semestra.reduce-motion',
} as const

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not persisted; still applied for this visit.
  }
}

/** What the last visit stored; the server preference replaces it once it has loaded. */
export function storedAppearance(): Appearance {
  const theme = read(KEYS.theme)
  const accent = read(KEYS.accent)
  const motion = read(KEYS.reduceMotion)
  return {
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
    accent: ACCENTS.includes(accent as Accent) ? (accent as Accent) : DEFAULT_APPEARANCE.accent,
    reduceMotion: motion === 'on' || motion === 'off' ? motion : 'system',
  }
}

export function storeAppearance(appearance: Appearance) {
  write(KEYS.theme, appearance.theme)
  write(KEYS.accent, appearance.accent)
  write(KEYS.reduceMotion, appearance.reduceMotion)
}

export function systemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveTheme(theme: Theme, system: 'light' | 'dark'): 'light' | 'dark' {
  return theme === 'system' ? system : theme
}

/** Sets the class and data attributes that `theme.css` keys on. */
export function applyAppearance(appearance: Appearance, resolved: 'light' | 'dark') {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.setAttribute('data-accent', appearance.accent)
  if (appearance.reduceMotion === 'system') root.removeAttribute('data-reduce-motion')
  else root.setAttribute('data-reduce-motion', appearance.reduceMotion)
}
