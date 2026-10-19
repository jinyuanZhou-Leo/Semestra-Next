import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/p/$programId/t/$termId/settings/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: `/p/${params.programId}/t/${params.termId}?settings=term`,
      replace: true,
    })
  },
})
