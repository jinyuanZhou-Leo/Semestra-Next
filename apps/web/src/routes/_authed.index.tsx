import {
  academicsProgramListOptions,
  settingsPreferencesGetOptions,
} from '@semestra/api-client/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { pickProgram } from '@/modules/academics/queries'

/** `/` opens the remembered Program, else the first; without any, onboarding (M02 §5.7). */
export const Route = createFileRoute('/_authed/')({
  beforeLoad: async ({ context, location }) => {
    const { queryClient } = context
    // Always fresh: a Program deleted a moment ago must not be opened again.
    const programs = await queryClient.fetchQuery({
      ...academicsProgramListOptions(),
      staleTime: 0,
    })
    // `?settings=` and `#section` ride along, so old settings links still open the dialog.
    const carried = `${location.searchStr}${location.hash ? `#${location.hash}` : ''}`
    if (programs.items.length === 0) {
      throw redirect({ href: `/onboarding${carried}`, replace: true })
    }
    const preferences = await queryClient
      .ensureQueryData(settingsPreferencesGetOptions())
      .catch(() => undefined)
    const program = pickProgram(programs.items, preferences?.active_program_id)
    throw redirect({ href: `/p/${program!.id}${carried}`, replace: true })
  },
})
