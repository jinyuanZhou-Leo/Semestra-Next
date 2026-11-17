import { createFileRoute } from '@tanstack/react-router'
import { preloadPage } from '@/app/registry'
import { TermView } from '@/modules/academics/shell/ScopeView'

/** String search params belong to the page itself (e.g. the open announcement, M09). */
export const Route = createFileRoute('/_authed/p/$programId/t/$termId/$page')({
  validateSearch: (search: Record<string, unknown>): Record<string, string> =>
    Object.fromEntries(
      Object.entries(search).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
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
