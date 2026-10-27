import {
  Fragment,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import {
  type Locale,
  getLocale,
  localStorageKey,
  overwriteGetLocale,
  overwriteSetLocale,
  setLocale,
} from '@/paraglide/runtime'

export type AppLocale = 'en' | 'zh-CN'
export const APP_LOCALES: readonly AppLocale[] = ['en', 'zh-CN']

/** Set when someone picks a language while signed out; written to their account at sign-in. */
const CHOSEN_KEY = 'semestra.locale-chosen'

function remember(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage blocked: the choice only lasts for this visit.
  }
}

// Paraglide works the locale out from its strategies (storage, then the browser) on every message
// call. It only changes through `setLocale` or `applyLocale`, so the answer is kept until then.
const resolveLocale = getLocale
const storeLocale = setLocale
let resolved: Locale | undefined
overwriteGetLocale(() => (resolved ??= resolveLocale()))
overwriteSetLocale((locale, options) => {
  const done = storeLocale(locale, options)
  resolved = undefined
  return done
})

/** Makes Paraglide use `locale`; null forgets the stored choice so the browser language wins. */
function applyLocale(locale: AppLocale | null): AppLocale {
  if (locale === null) remember(localStorageKey, null)
  else setLocale(locale, { reload: false })
  resolved = undefined
  return getLocale()
}

/**
 * How long animations stay instant once the re-mount has committed. A suppressed animation is
 * not gone: when motion comes back it continues from its original start, so this must outlast the
 * longest finite entrance animation (AiAction's success, 440 ms) or that one replays from midway.
 * Raise it when adding a longer one.
 */
const STILL_MS = 700
/** Drops the attribute even if no re-mount follows, so motion never stays off. */
const STILL_FALLBACK_MS = 3000
let fallbackTimer: ReturnType<typeof setTimeout> | undefined

/**
 * The re-mount in `LocaleProvider` mounts everything on screen again, which would replay entrance
 * animations: an open settings dialog would close and zoom in again. `data-remounting` on `<html>`
 * makes animations and transitions finish at once (theme.css) until `STILL_MS` after the re-mount
 * has committed, so the new tree simply replaces the old one.
 */
function holdStill() {
  const root = document.documentElement
  root.setAttribute('data-remounting', '')
  clearTimeout(fallbackTimer)
  fallbackTimer = setTimeout(() => root.removeAttribute('data-remounting'), STILL_FALLBACK_MS)
}

/**
 * Mounted again with the tree it sits in: restores motion `STILL_MS` after the re-mount has
 * committed. Counted from the commit, not the click, since rendering the whole app again takes a
 * while.
 */
function MotionBack() {
  useEffect(() => {
    const root = document.documentElement
    if (!root.hasAttribute('data-remounting')) return
    const timer = setTimeout(() => root.removeAttribute('data-remounting'), STILL_MS)
    return () => clearTimeout(timer)
  }, [])
  return null
}

export function wasLocaleChosenSignedOut(): boolean {
  try {
    return localStorage.getItem(CHOSEN_KEY) === '1'
  } catch {
    return false
  }
}

export function clearLocaleChosen() {
  remember(CHOSEN_KEY, null)
}

type LocaleState = {
  locale: AppLocale
  /** Switch the language now; null follows the browser. Does not save anything. */
  changeLocale: (locale: AppLocale | null, options?: { chosenByUser?: boolean }) => void
  /** Re-render the whole app after a clock or week-start change (see `LocaleProvider`). */
  refreshFormats: () => void
}

const LocaleContext = createContext<LocaleState | null>(null)

/**
 * Owns the interface language (M11 §5.4). Paraglide messages are plain functions, so a language
 * or clock-format change re-mounts everything below this provider; that is rare enough, and far
 * simpler than making every message call reactive (`holdStill` keeps it from replaying entrance
 * animations). `<html lang>` follows.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(getLocale)
  const [formatVersion, setFormatVersion] = useState(0)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const changeLocale = useCallback<LocaleState['changeLocale']>((next, options) => {
    const before = getLocale()
    const applied = applyLocale(next)
    if (applied !== before) holdStill()
    setLocaleState(applied)
    if (options?.chosenByUser) remember(CHOSEN_KEY, '1')
  }, [])
  const refreshFormats = useCallback(() => {
    holdStill()
    setFormatVersion((v) => v + 1)
  }, [])
  const value: LocaleState = { locale, changeLocale, refreshFormats }

  return (
    <LocaleContext value={value}>
      <Fragment key={`${locale}:${formatVersion}`}>
        <MotionBack />
        {children}
      </Fragment>
    </LocaleContext>
  )
}

export function useLocale(): LocaleState {
  const state = useContext(LocaleContext)
  if (!state) throw new Error('useLocale must be used inside <LocaleProvider>')
  return state
}
