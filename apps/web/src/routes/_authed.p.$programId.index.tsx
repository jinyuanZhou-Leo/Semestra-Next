import { createFileRoute } from '@tanstack/react-router'
import { OVERVIEW_PAGE } from '@/app/host/nav'
import { installedModules, preloadPage } from '@/app/registry'
import { ProgramView } from '@/modules/academics/shell/ScopeView'

export const Route = createFileRoute('/_authed/p/$programId/')({
  loader: ({ context }) =>
    preloadPage('program', OVERVIEW_PAGE, installedModules(context.queryClient)),
  component: ProgramOverview,
})

function ProgramOverview() {
  const { programId } = Route.useParams()
  return <ProgramView programId={programId} />
}
