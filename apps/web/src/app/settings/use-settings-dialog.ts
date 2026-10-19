import { useLocation, useRouter } from '@tanstack/react-router'
import type { SettingsLevel } from '../extensions'

/** What the settings dialog shows: a level, optionally one of its groups and a section in it. */
export type SettingsTarget = { level: SettingsLevel; group?: string; section?: string }

const LEVELS: readonly string[] = ['account', 'program', 'term', 'course']
const PARAM = 'settings'

type Place = { pathname: string; searchStr: string }

/** `account/preferences` → the level and group; anything else means the dialog is closed. */
export function parseSettingsParam(value: string | null): SettingsTarget | undefined {
  const [level, group] = (value ?? '').split('/')
  if (!level || !LEVELS.includes(level)) return undefined
  return { level: level as SettingsLevel, group: group || undefined }
}

/** The page at `place` with the dialog opened on `target`, or closed when there is none. */
export function settingsHref(place: Place, target?: SettingsTarget): string {
  const params = new URLSearchParams(place.searchStr)
  if (target) params.set(PARAM, target.group ? `${target.level}/${target.group}` : target.level)
  else params.delete(PARAM)
  const query = params.toString()
  const hash = target?.section ? `#${target.section}` : ''
  return `${place.pathname}${query ? `?${query}` : ''}${hash}`
}

/**
 * The settings dialog lives in the URL (`?settings=<level>/<group>#section`) so a link opens it
 * and Back closes it. Switching groups replaces the entry; only opening adds one.
 */
export function useSettingsDialog() {
  const router = useRouter()
  const { pathname, searchStr, state } = useLocation()
  const target = parseSettingsParam(new URLSearchParams(searchStr).get(PARAM))
  // Set on the history entry that opened the dialog, so closing goes back instead of stacking.
  const opened = (state as { settingsOpened?: boolean }).settingsOpened === true
  const place = { pathname, searchStr }

  const open = (next: SettingsTarget) => {
    router.history.push(settingsHref(place, next), { settingsOpened: true })
  }
  const select = (group: string, section?: string) => {
    if (!target) return
    router.history.replace(settingsHref(place, { level: target.level, group, section }), {
      settingsOpened: opened,
    })
  }
  const close = () => {
    if (opened) router.history.back()
    else router.history.replace(settingsHref(place))
  }
  return { target, open, select, close }
}
