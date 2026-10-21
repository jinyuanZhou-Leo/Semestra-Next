import { createFileRoute } from '@tanstack/react-router'
import { installedModules, preloadPage } from '@/app/registry'
import { TermView } from '@/modules/academics/shell/ScopeView'

export const Route = createFileRoute('/_authed/p/$programId/t/$termId/$page')({
  loader: ({ context, params }) =>
    preloadPage('term', params.page, installedModules(context.queryClient)),
  component: TermPage,
})

function TermPage() {
  const { programId, termId, page } = Route.useParams()
  return <TermView key={`${termId}:${page}`} programId={programId} termId={termId} pageId={page} />
}
