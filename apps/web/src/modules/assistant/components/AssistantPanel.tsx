import { agentSessionGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { History, Maximize2, SquarePen, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useCommandContext } from '@/app/commands/context'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { usePageScope } from '../scope'
import { panel, usePanel } from '../store'
import { Conversation } from './Conversation'
import { SessionList, sessionTitle } from './SessionList'

function HeaderButton({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & Omit<Parameters<typeof Button>[0], 'children'>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={label} {...props} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** The assistant docked on the right (M12 §6.1): one conversation, its history, new, expand. */
export function AssistantPanel() {
  const state = usePanel()
  const ctx = useCommandContext()
  const router = useRouter()
  const [historyOpen, setHistoryOpen] = useState(false)
  const pageScope = usePageScope(ctx.scope)
  const session = useQuery({
    ...agentSessionGetOptions({ path: { id: state.sessionId ?? '' } }),
    enabled: state.sessionId !== null,
  }).data?.session
  const title = session ? sessionTitle(session) : m.assistant_name()

  return (
    <aside aria-label={m.assistant_name()} className="flex h-full min-w-0 flex-col bg-background">
      <header className="flex h-10 shrink-0 items-center gap-0.5 border-b px-2">
        <h2 className="min-w-0 flex-1 truncate px-1.5 text-sm font-medium">{title}</h2>
        <HeaderButton label={m.assistant_new()} onClick={() => panel.show(null)}>
          <SquarePen />
        </HeaderButton>
        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" aria-label={m.assistant_history()} />
                  }
                />
              }
            >
              <History />
            </TooltipTrigger>
            <TooltipContent>{m.assistant_history()}</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="flex h-96 w-72 flex-col p-2">
            <SessionList
              activeId={state.sessionId}
              onSelect={(id) => {
                panel.show(id)
                setHistoryOpen(false)
              }}
              onDeleted={(id) => id === state.sessionId && panel.show(null)}
            />
          </PopoverContent>
        </Popover>
        {ctx.programId ? (
          <HeaderButton
            label={m.assistant_expand()}
            onClick={() => {
              panel.close()
              const base = `/p/${ctx.programId}/assistant`
              router.history.push(state.sessionId ? `${base}/${state.sessionId}` : base)
            }}
          >
            <Maximize2 />
          </HeaderButton>
        ) : null}
        <HeaderButton label={m.assistant_close()} onClick={() => panel.close()}>
          <X />
        </HeaderButton>
      </header>
      <Conversation
        key={state.view}
        sessionId={state.sessionId}
        pageScope={pageScope}
        onCreated={(id) => panel.created(id)}
        question={state.question}
        onQuestionTaken={() => panel.takeQuestion()}
        focusInput
      />
    </aside>
  )
}
