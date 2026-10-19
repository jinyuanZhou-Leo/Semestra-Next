import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/p/$programId/settings/')({
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/p/${params.programId}?settings=program`, replace: true })
  },
})
