import { createFileRoute } from '@tanstack/react-router'
import { OVERVIEW_PAGE } from '@/app/host/nav'
import { preloadPage } from '@/app/registry'
import { ProgramView } from '@/modules/academics/shell/ScopeView'

export const Route = createFileRoute('/_authed/p/$programId/')({
  loader: ({ context, params }) =>
    preloadPage(
      { kind: 'program', programId: params.programId },
      OVERVIEW_PAGE,
      context.queryClient,
    ),
  component: ProgramOverview,
})

function ProgramOverview() {
  const { programId } = Route.useParams()
  return <ProgramView programId={programId} />
}
