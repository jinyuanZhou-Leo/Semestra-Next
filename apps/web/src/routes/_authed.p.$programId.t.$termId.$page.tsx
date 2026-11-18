import { createFileRoute } from '@tanstack/react-router'
import { preloadPage } from '@/app/registry'
import { pageSearch } from '@/lib/page-search'
import { TermView } from '@/modules/academics/shell/ScopeView'

/** String search params belong to the page itself (e.g. the open announcement, M09). */
export const Route = createFileRoute('/_authed/p/$programId/t/$termId/$page')({
  validateSearch: pageSearch,
  loader: ({ context, params, preload }) =>
    preloadPage(
      { kind: 'term', programId: params.programId, termId: params.termId },
      params.page,
      context.queryClient,
      { preload },
    ),
  component: TermPage,
})

function TermPage() {
  const { programId, termId, page } = Route.useParams()
  return <TermView key={`${termId}:${page}`} programId={programId} termId={termId} pageId={page} />
}
