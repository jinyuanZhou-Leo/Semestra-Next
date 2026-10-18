import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/p/$programId/settings/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/p/$programId/settings/$group',
      params: { programId: params.programId, group: 'general' },
      replace: true,
    })
  },
})
