import { createFileRoute } from '@tanstack/react-router'
import { TermView } from '@/modules/academics/shell/ScopeView'

export const Route = createFileRoute('/_authed/p/$programId/t/$termId/')({
  component: TermOverview,
})

function TermOverview() {
  const { programId, termId } = Route.useParams()
  return <TermView key={termId} programId={programId} termId={termId} />
}
