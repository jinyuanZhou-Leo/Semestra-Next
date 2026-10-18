import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/$group', params: { group: 'account' }, replace: true })
  },
})
