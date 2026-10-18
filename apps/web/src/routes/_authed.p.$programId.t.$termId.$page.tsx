import { createFileRoute } from '@tanstack/react-router'
import { TermView } from '@/modules/academics/shell/ScopeView'

export const Route = createFileRoute('/_authed/p/$programId/t/$termId/$page')({
  component: TermPage,
})

function TermPage() {
  const { programId, termId, page } = Route.useParams()
  return <TermView key={`${termId}:${page}`} programId={programId} termId={termId} pageId={page} />
}
