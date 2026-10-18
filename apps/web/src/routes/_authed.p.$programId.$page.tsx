import { createFileRoute } from '@tanstack/react-router'
import { ProgramView } from '@/modules/academics/shell/ScopeView'

/** A Program-scope page contributed by any module, e.g. `/p/<id>/today` (M04). */
export const Route = createFileRoute('/_authed/p/$programId/$page')({ component: ProgramPage })

function ProgramPage() {
  const { programId, page } = Route.useParams()
  return <ProgramView key={page} programId={programId} pageId={page} />
}
