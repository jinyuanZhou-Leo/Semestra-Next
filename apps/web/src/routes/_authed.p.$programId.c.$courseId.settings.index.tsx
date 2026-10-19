import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/p/$programId/c/$courseId/settings/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: `/p/${params.programId}/c/${params.courseId}?settings=course`,
      replace: true,
    })
  },
})
