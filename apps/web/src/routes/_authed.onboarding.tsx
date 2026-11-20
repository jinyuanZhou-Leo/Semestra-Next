import {
  accountProfileGetOptions,
  academicsProgramListOptions,
} from '@semestra/api-client/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { preloadExtensions } from '@/app/extensions'
import { installedModules } from '@/app/registry'
import { Onboarding } from '@/modules/academics/onboarding/Onboarding'
import { onboardingInProgress } from '@/modules/academics/onboarding/progress'
import { requireSignIn } from '@/modules/auth/redirect'
import { PROGRAM_SETUP_FIELDS } from '@/modules/academics/types'

export const Route = createFileRoute('/_authed/onboarding')({
  beforeLoad: async ({ context, location }) => {
    await requireSignIn(context.queryClient, location.href)
    const me = await context.queryClient.ensureQueryData(accountProfileGetOptions())
    const programs = await context.queryClient.fetchQuery({
      ...academicsProgramListOptions(),
      staleTime: 0,
    })
    // Onboarding is for the first Program; one started in this tab may finish after creating it.
    if (programs.items.length > 0 && !onboardingInProgress(me.id)) {
      throw redirect({ to: '/', replace: true })
    }
  },
  // The Program step shows fields other modules contribute; their code loads on demand.
  loader: ({ context }) =>
    preloadExtensions(installedModules(context.queryClient), PROGRAM_SETUP_FIELDS),
  component: Onboarding,
})
