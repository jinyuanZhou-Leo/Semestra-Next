import {
  accountProfileGetOptions,
  pluginsCatalogListOptions,
} from '@semestra/api-client/react-query'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { toApiError } from '@/app/api'
import { CommandCenter } from '@/app/commands'
import { PreferencesSync } from '@/app/preferences'
import { useRealtime } from '@/app/realtime'
import { InstalledPluginsProvider, useOverlays } from '@/app/registry'
import { SettingsDialog } from '@/app/settings'
import { prefetchUiPrefs } from '@/app/ui-pref'

/** Everything below requires a signed-in user; others are sent to /login?redirect=… */
export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData({
        ...accountProfileGetOptions(),
        revalidateIfStale: false,
      })
      // Not awaited: pages that read UI state wait for it themselves (see `useUiPref`).
      void prefetchUiPrefs(context.queryClient)
      // Which plugins are installed decides the pages, cards and commands shown (M10).
      void context.queryClient.prefetchQuery(pluginsCatalogListOptions())
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
