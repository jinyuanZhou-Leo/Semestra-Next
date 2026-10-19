import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/settings/$group')({
  // Settings are a dialog now (M11 §5.2): old links open it over the scope's page.
  beforeLoad: ({ params, location }) => {
    throw redirect({
      href: `/?settings=account/${params.group}${location.hash ? `#${location.hash}` : ''}`,
      replace: true,
    })
  },
})
