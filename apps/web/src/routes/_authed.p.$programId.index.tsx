import { createFileRoute } from '@tanstack/react-router'
import { OVERVIEW_PAGE } from '@/app/host/nav'
import { preloadPage } from '@/app/registry'
import { ProgramView } from '@/modules/academics/shell/ScopeView'

export const Route = createFileRoute('/_authed/p/$programId/')({
  loader: () => preloadPage('program', OVERVIEW_PAGE),
  component: ProgramOverview,
})

function ProgramOverview() {
  const { programId } = Route.useParams()
  return <ProgramView programId={programId} />
}
