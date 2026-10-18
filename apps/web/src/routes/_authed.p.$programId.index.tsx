import { createFileRoute } from '@tanstack/react-router'
import { ProgramView } from '@/modules/academics/shell/ScopeView'

export const Route = createFileRoute('/_authed/p/$programId/')({ component: ProgramOverview })

function ProgramOverview() {
  const { programId } = Route.useParams()
  return <ProgramView programId={programId} />
}
