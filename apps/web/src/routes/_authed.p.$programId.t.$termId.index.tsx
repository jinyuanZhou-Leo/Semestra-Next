import { createFileRoute } from '@tanstack/react-router'
import { OVERVIEW_PAGE } from '@/app/host/nav'
import { preloadPage } from '@/app/registry'
import { TermView } from '@/modules/academics/shell/ScopeView'

export const Route = createFileRoute('/_authed/p/$programId/t/$termId/')({
  loader: ({ context, params }) =>
    preloadPage(
      { kind: 'term', programId: params.programId, termId: params.termId },
      OVERVIEW_PAGE,
      context.queryClient,
    ),
  component: TermOverview,
})

function TermOverview() {
  const { programId, termId } = Route.useParams()
  return <TermView key={termId} programId={programId} termId={termId} />
}
