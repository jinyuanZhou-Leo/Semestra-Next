import { useQuery } from '@tanstack/react-query'
import { History, MoreHorizontal, SquarePen } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { ShellToolbar } from '@/app/host/ShellToolbar'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { usePageConversation } from '../page-conversation'
import { programScope } from '../scope'
import { sessionQueryOptions } from '../use-chat'
import { Conversation } from './Conversation'
import { SessionColumn } from './SessionColumn'
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
 * The assistant as a page (M12 §6.1), laid out like the tasks page: the conversations in a column
 * on the left (or, where the page has no room for it, under the History button) and the open one
 * beside it. Its title and ⋯ menu sit in the app's top row. `sessionId` comes from the URL; a new
 * conversation gets its URL once created.
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
  const conversation = usePageConversation(sessionId)
  const [historyOpen, setHistoryOpen] = useState(false)
  const session = useQuery(sessionQueryOptions(sessionId)).data?.session
  const editing = useSessionEditing((id) => id === sessionId && onNavigate(null))
  const title = session ? sessionTitle(session) : m.assistant_name()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ShellToolbar>
        <h1 className="flex min-w-0 font-heading text-sm font-semibold">
          {session ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
                  <button
                    type="button"
                    className="min-w-0 truncate rounded-md px-1.5 py-1 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
                    onClick={() => editing.rename(session)}
                  />
                }
              >
                {title}
              </TooltipTrigger>
              <TooltipContent>{m.assistant_rename()}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="truncate px-1.5">{title}</span>
          )}
        </h1>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {/* Where the page is wide enough the conversations get a column of their own instead
              (by the content's width in CSS, so the page is drawn at once in its final layout). */}
          <div className="flex items-center gap-0.5 @page-lg/main:hidden">
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
            <ToolbarButton label={m.assistant_new()} onClick={() => onNavigate(null)}>
              <SquarePen />
            </ToolbarButton>
          </div>
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
      <div className="flex min-h-0 flex-1 @page-lg/main:gap-6 @page-lg/main:pt-2 @page-lg/main:pl-4">
        <SessionColumn
          className="hidden @page-lg/main:flex"
          activeId={conversation.currentId}
          onSelect={(id) => onNavigate(id)}
          onNew={() => onNavigate(null)}
          editing={editing}
        />
        <Conversation
          key={conversation.key}
          contentClassName="mx-auto w-full max-w-3xl"
          sessionId={sessionId}
          pageScope={programScope(programId)}
          onCreated={(id) => {
            conversation.created(id)
            onNavigate(id, { replace: true })
          }}
          focusInput
        />
      </div>
      {editing.dialogs}
    </div>
  )
}
