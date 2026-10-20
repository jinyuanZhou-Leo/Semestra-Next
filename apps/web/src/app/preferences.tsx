import type { Preferences } from '@semestra/api-client'
import {
  settingsPreferenceGetOptions,
  settingsPreferenceGetQueryKey,
  settingsPreferenceUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { toastError } from '@/lib/errors'
import { getFormatPreferences, setFormatPreferences } from '@/lib/format'
import { clearLocaleChosen, useLocale, wasLocaleChosenSignedOut } from './locale'
import { useTheme } from './theme'

/** The signed-in user's preferences (M11 §2); undefined while loading. */
export function usePreferences() {
  return useQuery({ ...settingsPreferenceGetOptions(), staleTime: 5 * 60_000 })
}

/** The preferences a patch may change; `locale` and `active_program_id` also accept null. */
export type PreferencePatch = Partial<Omit<Preferences, 'updated_at'>>

const MUTATION_KEY = ['settings', 'preferences', 'update']

/**
 * Returns `update(patch)`: applies the change to the cached preferences at once (so everything
 * that reads them follows immediately) and saves it; a failure restores the server's state.
 */
export function useUpdatePreferences() {
  const queryClient = useQueryClient()
  const queryKey = settingsPreferenceGetQueryKey()
  const { mutate } = useMutation({
    ...settingsPreferenceUpdateMutation(),
    mutationKey: MUTATION_KEY,
    onError: toastError,
    // Refetch only after the last in-flight change: an earlier response must not overwrite
    // a later optimistic value.
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: MUTATION_KEY }) === 1) {
        void queryClient.invalidateQueries({ queryKey })
      }
    },
  })
  return useCallback(
    (patch: PreferencePatch) => {
      queryClient.setQueryData<Preferences>(queryKey, (current) =>
        current ? { ...current, ...patch } : current,
      )
      mutate({ body: patch })
    },
    [queryClient, queryKey, mutate],
  )
}

/**
 * Applies the stored preferences to the running app (theme, accent, motion, language, clock
 * format, week start). Mounted once inside the signed-in layout.
 */
export function PreferencesSync() {
  const { data } = usePreferences()
  const { setAppearance } = useTheme()
  const { locale: current, changeLocale, refreshFormats } = useLocale()
  const update = useUpdatePreferences()

  const theme = data?.theme
  const accent = data?.accent
  const reduceMotion = data?.reduce_motion
  useEffect(() => {
    if (theme && accent && reduceMotion) setAppearance({ theme, accent, reduceMotion })
  }, [theme, accent, reduceMotion, setAppearance])

  const loaded = data !== undefined
  const locale = data?.locale ?? null
  useEffect(() => {
    if (!loaded) return
    if (locale === null && wasLocaleChosenSignedOut()) {
      // A language picked on the sign-in page becomes the account's language.
      clearLocaleChosen()
      update({ locale: current })
      return
    }
    clearLocaleChosen()
    changeLocale(locale)
  }, [loaded, locale, current, changeLocale, update])

  const timeFormat = data?.time_format
  const weekStart = data?.week_start
  useEffect(() => {
    if (timeFormat === undefined || weekStart === undefined) return
    const known = getFormatPreferences()
    if (known.timeFormat === timeFormat && known.weekStart === weekStart) return
    // Formatted dates are computed while rendering: re-render everything with the new format.
    setFormatPreferences({ timeFormat, weekStart })
    refreshFormats()
  }, [timeFormat, weekStart, refreshFormats])

  return null
}
