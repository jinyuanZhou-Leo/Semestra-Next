import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/p/$programId/c/$courseId/settings/$group')({
  // Settings are a dialog now (M11 §5.2): old links open it over the scope's page.
  beforeLoad: ({ params, location }) => {
    throw redirect({
      href: `/p/${params.programId}/c/${params.courseId}?settings=course/${params.group}${location.hash ? `#${location.hash}` : ''}`,
      replace: true,
    })
  },
})
