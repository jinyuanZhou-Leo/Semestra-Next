import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/p/$programId/c/$courseId/settings/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/p/$programId/c/$courseId/settings/$group',
      params: { ...params, group: 'general' },
      replace: true,
    })
  },
})
