import { settingsPreferenceGetOptions } from '@semestra/api-client/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { isPhone } from '@/app/mobile/phone'
import { startPagePath } from '@/modules/academics/start-page'
import { requireSignIn } from '@/modules/auth/redirect'

/**
 * The Program's own address, where `/` and the installed app go: it opens the start page the user
 * chose (M11 `start_page`, Today by default). The Program's board is the "summary" page. On a
 * phone the phone shell picks among its own pages (M17).
 */
export const Route = createFileRoute('/_authed/p/$programId/')({
  beforeLoad: async ({ context: { queryClient }, params: { programId }, location }) => {
    if (isPhone()) return
    // The session check (this runs before `/_authed`'s loader) and the preferences start together.
    const signedIn = requireSignIn(queryClient, location.href)
    const preferences = queryClient
      .ensureQueryData(settingsPreferenceGetOptions())
      .catch(() => undefined)
    await signedIn
    const startPage = (await preferences)?.start_page ?? 'today'
    const href = await startPagePath(queryClient, programId, startPage)
    // `?settings=` and `#section` ride along, so settings links still open the dialog.
    const carried = `${location.searchStr}${location.hash ? `#${location.hash}` : ''}`
    throw redirect({ href: `${href}${carried}`, replace: true })
  },
})
