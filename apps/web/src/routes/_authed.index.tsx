import {
  academicsProgramListOptions,
  settingsPreferenceGetOptions,
} from '@semestra/api-client/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { pickProgram } from '@/modules/academics/queries'
import { requireSignIn } from '@/modules/auth/redirect'

/** `/` opens the remembered Program, else the first; without any, onboarding (M02 §5.7). */
export const Route = createFileRoute('/_authed/')({
  beforeLoad: async ({ context, location }) => {
    const { queryClient } = context
    // The session check (this runs before `/_authed`'s loader), the preferences and the Programs
    // start together; a failed request is reported after the session check.
    const signedIn = requireSignIn(queryClient, location.href)
    const preferences = queryClient
      .ensureQueryData(settingsPreferenceGetOptions())
      .catch(() => undefined)
    // Always fresh: a Program deleted a moment ago must not be opened again.
    const listing = queryClient.fetchQuery({ ...academicsProgramListOptions(), staleTime: 0 })
    listing.catch(() => undefined)
    await signedIn
    const programs = await listing
    // `?settings=` and `#section` ride along, so old settings links still open the dialog.
    const carried = `${location.searchStr}${location.hash ? `#${location.hash}` : ''}`
    if (programs.items.length === 0) {
      throw redirect({ href: `/onboarding${carried}`, replace: true })
    }
    const program = pickProgram(programs.items, (await preferences)?.active_program_id)
    throw redirect({ href: `/p/${program!.id}${carried}`, replace: true })
  },
})
