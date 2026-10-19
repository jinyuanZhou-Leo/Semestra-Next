import { createFileRoute, redirect } from '@tanstack/react-router'

/** The old "All courses" page is now the courses tab of "Terms & courses". */
export const Route = createFileRoute('/_authed/p/$programId/courses')({
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/p/${params.programId}/academics?tab=courses`, replace: true })
  },
})
