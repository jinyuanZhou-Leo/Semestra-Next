import { useNavigate } from '@tanstack/react-router'
import { PageHeader } from '@/app/host/PageHeader'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { SessionView } from '../components/SessionView'
import { useImportSession } from '../queries'
import { SOURCE_KIND_LABELS } from '../labels'

/**
 * An import session on its own page (M08 §6.2), opened from the import history or the status
 * bar: the same view as the dialog, for picking up a review later.
 */
export function ImportSessionPage({
  programId,
  sessionId,
}: {
  programId: string
  sessionId: string
}) {
  const navigate = useNavigate()
  const query = useImportSession(sessionId)
  const back = () => void navigate({ to: '/p/$programId', params: { programId } })
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={query.data ? SOURCE_KIND_LABELS[query.data.source_kind]() : m.imports_session()}
        subtitle={query.data ? formatDateTime(query.data.created_at) : null}
      />
      <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
        <AsyncBoundary query={query}>
          {(session) => (
            <SessionView
              session={session}
              mode="direct"
              className="min-h-[32rem] flex-1"
              onDone={back}
            />
          )}
        </AsyncBoundary>
      </div>
    </div>
  )
}
