import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/settings/')({
  beforeLoad: () => {
    throw redirect({ href: `/?settings=account`, replace: true })
  },
})
