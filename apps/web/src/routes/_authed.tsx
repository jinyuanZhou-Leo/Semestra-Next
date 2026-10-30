import {
  pluginsCatalogListOptions,
  settingsPreferenceGetOptions,
} from '@semestra/api-client/react-query'
import { Outlet, createFileRoute } from '@tanstack/react-router'
import { CommandCenter } from '@/app/commands'
import { PREFERENCES_STALE, PreferencesSync } from '@/app/preferences'
import { useRealtime } from '@/app/realtime'
import { InstalledPluginsProvider, uiPrefPrefixes, useOverlays } from '@/app/registry'
import { SettingsDialog } from '@/app/settings/SettingsDialog'
import { prefetchUiPrefs } from '@/app/ui-pref'
import { aiStatusOptions } from '@/hooks/use-ai-status'
import { requireSignIn } from '@/modules/auth/redirect'

/** Everything below requires a signed-in user; others are sent to /login?redirect=… */
export const Route = createFileRoute('/_authed')({
  // The session check waits in the loader, not here: every `beforeLoad` runs before any loader
  // or route code starts, so waiting here put the pages' code and data a round trip behind it.
  // A signed-out user's requests fail, and the loader sends them to sign in.
  beforeLoad: ({ context, preload }) => {
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
    // Whether AI is set up decides what Sem and the AI buttons show; knowing it before they
    // open keeps them from showing one state and then the other.
    context.queryClient.ensureQueryData(aiStatusOptions()).catch(() => undefined)
  },
  loader: ({ context, location }) => requireSignIn(context.queryClient, location.href),
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
