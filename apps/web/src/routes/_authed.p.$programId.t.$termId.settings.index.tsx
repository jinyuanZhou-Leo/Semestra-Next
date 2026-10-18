import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/p/$programId/t/$termId/settings/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/p/$programId/t/$termId/settings/$group',
      params: { ...params, group: 'general' },
      replace: true,
    })
  },
})
