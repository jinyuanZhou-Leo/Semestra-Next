import { createFileRoute } from '@tanstack/react-router'
import { ImportSessionPage } from '@/modules/imports/pages/ImportSessionPage'

/** An import session's review (M08 §6.2), from the import history or the status bar. */
export const Route = createFileRoute('/_authed/p/$programId/imports/$sessionId')({
  component: ImportSession,
})

function ImportSession() {
  const { programId, sessionId } = Route.useParams()
  return <ImportSessionPage key={sessionId} programId={programId} sessionId={sessionId} />
}
