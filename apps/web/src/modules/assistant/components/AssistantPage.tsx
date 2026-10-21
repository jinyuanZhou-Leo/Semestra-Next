import { useQuery } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import { History, MoreHorizontal, SquarePen } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { ShellToolbar } from '@/app/host/ShellToolbar'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { useSidebar } from '@/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { programScope } from '../scope'
import { sessionQueryOptions } from '../use-chat'
import { Conversation } from './Conversation'
import { SessionList, SessionMenuItems, sessionTitle, useSessionEditing } from './SessionList'

function ToolbarButton({
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

/**
 * The assistant as a page (M12 §6.1): one conversation as wide as the content allows. Its title,
 * "New conversation" and the ⋯ menu sit in the app's top row; past conversations are listed in
 * the app sidebar (or, while the sidebar is an icon rail, under the History button).
 * `sessionId` comes from the URL; a new conversation gets its URL once created.
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
  const { state: sidebar, isMobile } = useSidebar()
  // Which conversation the URL shows, read with the history entry in one snapshot: the location
  // changes before the route's params do, and reading the entry alone gave a new key for one
  // render while a new conversation got its URL, which remounted it and dropped the typed text.
  // Every visit to the page without a conversation (a link, "New conversation") is a new history
  // entry, so its key starts a new conversation even when the URL was already the page's.
  const at = useLocation({
    select: (l) => {
      const segment = l.pathname.replace(/\/$/, '').split('/').at(-1)
      // oxlint-disable-next-line no-underscore-dangle -- the router's name for an entry's key
      return segment === 'assistant' ? `new-${l.state.__TSR_key ?? ''}` : (segment ?? '')
    },
  })
  // A conversation created here keeps its component (and its running answer) when the URL
  // changes to its id.
  const [created, setCreated] = useState({ id: null as string | null, key: '' })
  const [historyOpen, setHistoryOpen] = useState(false)
  const session = useQuery(sessionQueryOptions(sessionId)).data?.session
  const editing = useSessionEditing((id) => id === sessionId && onNavigate(null))
  const key = at === created.id ? created.key : at
  const title = session ? sessionTitle(session) : m.assistant_name()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ShellToolbar>
        <h1 className="flex min-w-0 font-heading text-sm font-semibold">
          {session ? (
            <button
              type="button"
              className="min-w-0 truncate rounded-md px-1.5 py-1 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
              title={m.assistant_rename()}
              onClick={() => editing.rename(session)}
            >
              {title}
            </button>
          ) : (
            <span className="truncate px-1.5">{title}</span>
          )}
        </h1>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {/* The list in the sidebar is hidden on the icon rail. */}
          {sidebar === 'collapsed' || isMobile ? (
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
                  activeId={sessionId}
                  onSelect={(id) => {
                    setHistoryOpen(false)
                    onNavigate(id)
                  }}
                  onDeleted={(id) => id === sessionId && onNavigate(null)}
                />
              </PopoverContent>
            </Popover>
          ) : null}
          <ToolbarButton label={m.assistant_new()} onClick={() => onNavigate(null)}>
            <SquarePen />
          </ToolbarButton>
          {session ? (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={m.assistant_history_actions({ title })}
                        />
                      }
                    />
                  }
                >
                  <MoreHorizontal />
                </TooltipTrigger>
                <TooltipContent>{m.assistant_history_actions({ title })}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <SessionMenuItems session={session} editing={editing} />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </ShellToolbar>
      <div className="flex min-h-0 flex-1">
        <Conversation
          key={key}
          contentClassName="mx-auto w-full max-w-3xl"
          sessionId={sessionId}
          pageScope={programScope(programId)}
          onCreated={(id) => {
            setCreated({ id, key })
            onNavigate(id, { replace: true })
          }}
          focusInput
        />
      </div>
      {editing.dialogs}
    </div>
  )
}
