import {
  academicsProgramListOptions,
  settingsPreferencesGetOptions,
} from '@semestra/api-client/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { pickProgram } from '@/modules/academics/queries'

/** `/` opens the remembered Program, else the first; without any, onboarding (M02 §5.7). */
export const Route = createFileRoute('/_authed/')({
  beforeLoad: async ({ context }) => {
    const { queryClient } = context
    // Always fresh: a Program deleted a moment ago must not be opened again.
    const programs = await queryClient.fetchQuery({
      ...academicsProgramListOptions(),
      staleTime: 0,
    })
    if (programs.items.length === 0) throw redirect({ to: '/onboarding', replace: true })
    const preferences = await queryClient
      .ensureQueryData(settingsPreferencesGetOptions())
      .catch(() => undefined)
    const program = pickProgram(programs.items, preferences?.active_program_id)
    throw redirect({ to: '/p/$programId', params: { programId: program!.id }, replace: true })
  },
})
