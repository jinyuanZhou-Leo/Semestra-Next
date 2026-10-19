import { agentSessionGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { SquarePen } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '@/app/host/PageHeader'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Conversation } from './Conversation'
import { SessionList, sessionTitle } from './SessionList'

/**
 * The assistant as a page (M12 §6.1): past conversations on the left, one conversation on the
 * right. `sessionId` comes from the URL; a new conversation gets its URL once created.
 */
export function AssistantPage({
  programId,
  sessionId,
  onNavigate,
}: {
  programId: string
  sessionId: string | null
  onNavigate: (sessionId: string | null, options?: { replace?: boolean }) => void
}) {
  const [fresh, setFresh] = useState({ count: 0, createdId: null as string | null })
  const session = useQuery({
    ...agentSessionGetOptions({ path: { id: sessionId ?? '' } }),
    enabled: sessionId !== null,
  }).data?.session
  // A conversation created here keeps its component (and its running answer) when the URL
  // changes to its id.
  const key = sessionId && sessionId !== fresh.createdId ? sessionId : `new-${fresh.count}`
  const startNew = () => {
    setFresh((f) => ({ count: f.count + 1, createdId: null }))
    onNavigate(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={session ? sessionTitle(session) : m.assistant_name()}
        actions={
          <Button size="sm" variant="outline" onClick={startNew}>
            <SquarePen aria-hidden data-icon="inline-start" />
            {m.assistant_new()}
          </Button>
        }
      />
      <div className="mt-4 flex min-h-0 flex-1 border-t">
        <SessionList
          className="w-64 shrink-0 border-r p-3"
          activeId={sessionId}
          onSelect={(id) => onNavigate(id)}
          onDeleted={(id) => id === sessionId && startNew()}
        />
        <div className="flex min-w-0 flex-1 justify-center">
          <Conversation
            key={key}
            className="max-w-3xl"
            sessionId={sessionId}
            pageScope={{ program_id: programId, term_id: null, course_id: null }}
            onCreated={(id) => {
              setFresh((f) => ({ ...f, createdId: id }))
              onNavigate(id, { replace: true })
            }}
            focusInput
          />
        </div>
      </div>
    </div>
  )
}
