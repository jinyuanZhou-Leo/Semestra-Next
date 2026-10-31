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
    await requireSignIn(queryClient, location.href)
    const preferences = await queryClient
      .ensureQueryData(settingsPreferenceGetOptions())
      .catch(() => undefined)
    const href = await startPagePath(queryClient, programId, preferences?.start_page ?? 'today')
    // `?settings=` and `#section` ride along, so settings links still open the dialog.
    const carried = `${location.searchStr}${location.hash ? `#${location.hash}` : ''}`
    throw redirect({ href: `${href}${carried}`, replace: true })
  },
})
