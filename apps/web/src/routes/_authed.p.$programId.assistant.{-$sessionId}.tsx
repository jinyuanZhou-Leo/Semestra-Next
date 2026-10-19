import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AssistantPage } from '@/modules/assistant/components/AssistantPage'

/** The assistant as a full page (M12 §6.1): `/p/$programId/assistant/$sessionId?`. */
export const Route = createFileRoute('/_authed/p/$programId/assistant/{-$sessionId}')({
  component: Assistant,
})

function Assistant() {
  const { programId, sessionId } = Route.useParams()
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <AssistantPage
      programId={programId}
      sessionId={sessionId ?? null}
      onNavigate={(id, options) =>
        void navigate({
          to: '/p/$programId/assistant/{-$sessionId}',
          params: { programId, sessionId: id ?? undefined },
          replace: options?.replace,
        })
      }
    />
  )
}
