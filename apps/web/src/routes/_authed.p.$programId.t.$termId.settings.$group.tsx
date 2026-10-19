import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/p/$programId/t/$termId/settings/$group')({
  // Settings are a dialog now (M11 §5.2): old links open it over the scope's page.
  beforeLoad: ({ params, location }) => {
    throw redirect({
      href: `/p/${params.programId}/t/${params.termId}?settings=term/${params.group}${location.hash ? `#${location.hash}` : ''}`,
      replace: true,
    })
  },
})
