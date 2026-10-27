import {
  accountProfileGetOptions,
  pluginsCatalogListOptions,
  settingsPreferenceGetOptions,
} from '@semestra/api-client/react-query'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { toApiError } from '@/app/api'
import { CommandCenter } from '@/app/commands'
import { PREFERENCES_STALE, PreferencesSync } from '@/app/preferences'
import { useRealtime } from '@/app/realtime'
import { InstalledPluginsProvider, uiPrefPrefixes, useOverlays } from '@/app/registry'
import { SettingsDialog } from '@/app/settings'
import { prefetchUiPrefs } from '@/app/ui-pref'

/** Everything below requires a signed-in user; others are sent to /login?redirect=… */
export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context, location, preload }) => {
    try {
      await context.queryClient.ensureQueryData({
        ...accountProfileGetOptions(),
        revalidateIfStale: false,
      })
      // Not awaited: pages that read UI state wait for it themselves (see `useUiPref`). Not on a
      // link preload (hover), which would read it again for every link.
      if (!preload) void prefetchUiPrefs(context.queryClient, uiPrefPrefixes())
      // Only when not cached, as this runs on every navigation and hover; the layout reading
      // them stays mounted and is kept fresh by realtime events.
      // Which plugins are installed decides the pages, cards and commands shown (M10).
      context.queryClient.ensureQueryData(pluginsCatalogListOptions()).catch(() => undefined)
      // Theme, language and formats; the signed-in layout reads them (`usePreferences`).
      context.queryClient
        .ensureQueryData({ ...settingsPreferenceGetOptions(), staleTime: PREFERENCES_STALE })
        .catch(() => undefined)
    } catch (err) {
      if (toApiError(err).status === 401) {
        throw redirect({ to: '/login', search: { redirect: location.href } })
      }
      throw err
    }
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  useRealtime()
  return (
    <InstalledPluginsProvider>
      <PreferencesSync />
      <Outlet />
      <CommandCenter />
      <SettingsDialog />
      <ModuleOverlays />
    </InstalledPluginsProvider>
  )
}

function ModuleOverlays() {
  return useOverlays().map((Overlay, index) => <Overlay key={index} />)
}
