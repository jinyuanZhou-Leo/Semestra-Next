import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { TermsAndCoursesPage } from '@/modules/academics/pages/TermsAndCoursesPage'

type Search = { tab?: 'terms' | 'courses'; term?: string }

/** `?tab=` picks the sub-module, `?term=` the selected term / the course table's term filter. */
export const Route = createFileRoute('/_authed/p/$programId/academics')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(search.tab === 'terms' || search.tab === 'courses' ? { tab: search.tab } : {}),
    ...(typeof search.term === 'string' && search.term ? { term: search.term } : {}),
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
