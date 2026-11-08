import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { History, SquarePen } from 'lucide-react'
import { useState } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/ui/drawer'
import { Conversation } from '../components/Conversation'
import { SessionList, sessionTitle } from '../components/SessionList'
import { usePageConversation } from '../page-conversation'
import { programScope } from '../scope'
import { sessionQueryOptions } from '../use-chat'

/**
 * Sem on a phone (M17): one conversation at full height, past ones in a drawer. Same addresses
 * as the full page (`/p/$programId/assistant/$sessionId?`).
 */
export default function AssistantMobilePage({
  programId,
  sessionId,
}: {
  programId: string
  sessionId: string | null
}) {
  const navigate = useNavigate()
  const open = (id: string | null, replace?: boolean) =>
    void navigate({
      to: '/p/$programId/assistant/{-$sessionId}',
      params: { programId, sessionId: id ?? undefined },
      replace,
    })
  const conversation = usePageConversation(sessionId)
  const [historyOpen, setHistoryOpen] = useState(false)
  const session = useQuery(sessionQueryOptions(sessionId)).data?.session
  const title = session ? sessionTitle(session) : m.assistant_name()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b px-2 pt-[env(safe-area-inset-top)]">
        <h1 className="min-w-0 flex-1 truncate px-2 py-3 font-heading text-base font-semibold">
          {title}
        </h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label={m.assistant_history()}
          onClick={() => setHistoryOpen(true)}
        >
          <History />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={m.assistant_new()}
          onClick={() => open(null)}
        >
          <SquarePen />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <Conversation
          key={conversation.key}
          sessionId={sessionId}
          pageScope={programScope(programId)}
          onCreated={(id) => {
            conversation.created(id)
            open(id, true)
          }}
        />
      </div>
      <Drawer open={historyOpen} onOpenChange={setHistoryOpen} showSwipeHandle>
        <DrawerContent className="h-[80dvh]">
          <DrawerHeader className="group-data-[swipe-axis=y]/drawer-popup:text-left">
            <DrawerTitle>{m.assistant_history()}</DrawerTitle>
          </DrawerHeader>
          <SessionList
            className="min-h-0 flex-1 px-2 pb-[max(env(safe-area-inset-bottom),1rem)]"
            activeId={sessionId}
            onSelect={(id) => {
              setHistoryOpen(false)
              open(id)
            }}
            onDeleted={(id) => id === sessionId && open(null)}
          />
        </DrawerContent>
      </Drawer>
    </div>
  )
}
