import {
  accountProfileGetOptions,
  academicsProgramListOptions,
} from '@semestra/api-client/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Onboarding } from '@/modules/academics/onboarding/Onboarding'
import { onboardingInProgress } from '@/modules/academics/onboarding/progress'

export const Route = createFileRoute('/_authed/onboarding')({
  beforeLoad: async ({ context }) => {
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
  component: Onboarding,
})
