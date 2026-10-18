import { Outlet, createFileRoute } from '@tanstack/react-router'

/** Course pages: `?fromTerm=` tells the breadcrumb which term the user came from (M02 §5.5). */
export const Route = createFileRoute('/_authed/p/$programId/c/$courseId')({
  validateSearch: (search: Record<string, unknown>): { fromTerm?: string } =>
    typeof search.fromTerm === 'string' ? { fromTerm: search.fromTerm } : {},
  component: Outlet,
})
