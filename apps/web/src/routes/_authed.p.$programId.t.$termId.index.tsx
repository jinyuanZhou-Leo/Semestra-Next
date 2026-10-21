import { createFileRoute } from '@tanstack/react-router'
import { OVERVIEW_PAGE } from '@/app/host/nav'
import { installedModules, preloadPage } from '@/app/registry'
import { TermView } from '@/modules/academics/shell/ScopeView'

export const Route = createFileRoute('/_authed/p/$programId/t/$termId/')({
  loader: ({ context }) =>
    preloadPage('term', OVERVIEW_PAGE, installedModules(context.queryClient)),
  component: TermOverview,
})

function TermOverview() {
  const { programId, termId } = Route.useParams()
  return <TermView key={termId} programId={programId} termId={termId} />
}
