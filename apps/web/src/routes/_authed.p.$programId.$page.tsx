import { createFileRoute } from '@tanstack/react-router'
import { installedModules, preloadPage } from '@/app/registry'
import { ProgramView } from '@/modules/academics/shell/ScopeView'

/** A Program-scope page contributed by any module, e.g. `/p/<id>/today` (M04). */
export const Route = createFileRoute('/_authed/p/$programId/$page')({
  loader: ({ context, params }) =>
    preloadPage('program', params.page, installedModules(context.queryClient)),
  component: ProgramPage,
})

function ProgramPage() {
  const { programId, page } = Route.useParams()
  return <ProgramView key={page} programId={programId} pageId={page} />
}
