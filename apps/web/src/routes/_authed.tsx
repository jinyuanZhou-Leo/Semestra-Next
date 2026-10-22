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

/** Where signed-out visitors to `/` go instead of /login: the marketing site, on the hosted
 * service only (`VITE_LANDING_URL`, e.g. `/landing/`). Self-hosted builds leave it unset. */
export function landingFor(pathname: string): string | undefined {
  const landing = import.meta.env.VITE_LANDING_URL
  return landing && pathname === '/' ? landing : undefined
}

/** Everything below requires a signed-in user; others are sent to /login?redirect=… (or, at `/`,
 * to the landing page when there is one). */
export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context, location, preload }) => {
    try {
      await context.queryClient.ensureQueryData({
        ...accountProfileGetOptions(),
        revalidateIfStale: false,
      })
      // Not awaited: pages that read UI state wait for it themselves (see `useUiPref`). Not on a
      // link preload (hover), which would read it again for every link.
      if (!preload) void prefetchUiPrefs(context.queryClient)
      // Which plugins are installed decides the pages, cards and commands shown (M10).
      void context.queryClient.prefetchQuery(pluginsCatalogListOptions())
    } catch (err) {
      if (toApiError(err).status === 401) {
        const landing = landingFor(location.pathname)
        if (landing) throw redirect({ href: landing, reloadDocument: true, replace: true })
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
