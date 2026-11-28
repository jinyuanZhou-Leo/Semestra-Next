import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { preloadable } from '@/app/extensions'
import { preloadProgramRoute } from '@/app/registry'

// Loaded by the loader on a computer only: a phone shows the courses tab here (M17 `mobileTabs`).
const TermsAndCoursesPage = preloadable(
  () => import('@/modules/academics/pages/TermsAndCoursesPage'),
)

type Search = { tab?: 'terms' | 'courses'; term?: string }

/** `?tab=` picks the sub-module, `?term=` the selected term / the course table's term filter. */
export const Route = createFileRoute('/_authed/p/$programId/academics')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(search.tab === 'terms' || search.tab === 'courses' ? { tab: search.tab } : {}),
    ...(typeof search.term === 'string' && search.term ? { term: search.term } : {}),
  }),
  loader: ({ context, params, preload }) =>
    preloadProgramRoute(params.programId, 'academics', TermsAndCoursesPage, context.queryClient, {
      preload,
    }),
  component: TermsAndCourses,
})

function TermsAndCourses() {
  const { programId } = Route.useParams()
  const { tab = 'terms', term } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const update = (next: Search) =>
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })
  return (
    <TermsAndCoursesPage
      programId={programId}
      tab={tab}
      termId={term}
      onTabChange={(next) => update({ tab: next })}
      onTermChange={(next) => update({ term: next })}
    />
  )
}
