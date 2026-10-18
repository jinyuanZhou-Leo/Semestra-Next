import {
  Fragment,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { getLocale, localStorageKey, setLocale } from '@/paraglide/runtime'

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

/** Makes Paraglide use `locale`; null forgets the stored choice so the browser language wins. */
function applyLocale(locale: AppLocale | null): AppLocale {
  if (locale === null) remember(localStorageKey, null)
  else setLocale(locale, { reload: false })
  return getLocale()
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
 * simpler than making every message call reactive. `<html lang>` follows.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(getLocale)
  const [formatVersion, setFormatVersion] = useState(0)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const changeLocale = useCallback<LocaleState['changeLocale']>((next, options) => {
    setLocaleState(applyLocale(next))
    if (options?.chosenByUser) remember(CHOSEN_KEY, '1')
  }, [])
  const refreshFormats = useCallback(() => setFormatVersion((v) => v + 1), [])
  const value: LocaleState = { locale, changeLocale, refreshFormats }

  return (
    <LocaleContext value={value}>
      <Fragment key={`${locale}:${formatVersion}`}>{children}</Fragment>
    </LocaleContext>
  )
}

export function useLocale(): LocaleState {
  const state = useContext(LocaleContext)
  if (!state) throw new Error('useLocale must be used inside <LocaleProvider>')
  return state
}
