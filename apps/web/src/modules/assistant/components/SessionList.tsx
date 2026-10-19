import type { AgentSessionOut } from '@semestra/api-client'
import {
  agentSessionDeleteMutation,
  agentSessionListOptions,
  agentSessionUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { differenceInCalendarDays } from 'date-fns'
import { MessagesSquare, MoreHorizontal, Pencil, Pin, PinOff, SearchX, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { invalidateOperations } from '@/app/api'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Input } from '@/ui/input'
import { Item, ItemActions, ItemContent, ItemGroup } from '@/ui/item'
import { Label } from '@/ui/label'
import { Skeleton } from '@/ui/skeleton'

type Group = { id: string; title: string; items: AgentSessionOut[] }

/** Pinned first, then by when they were last used (M12 §6.1). */
export function groupSessions(items: readonly AgentSessionOut[], now = new Date()): Group[] {
  const groups: Group[] = [
    { id: 'pinned', title: m.assistant_history_pinned(), items: [] },
    { id: 'today', title: m.assistant_history_today(), items: [] },
    { id: 'yesterday', title: m.assistant_history_yesterday(), items: [] },
    { id: 'week', title: m.assistant_history_week(), items: [] },
    { id: 'earlier', title: m.assistant_history_earlier(), items: [] },
  ]
  for (const session of items) {
    const days = differenceInCalendarDays(now, new Date(session.updated_at))
    const index = session.pinned ? 0 : days <= 0 ? 1 : days === 1 ? 2 : days < 7 ? 3 : 4
    groups[index]?.items.push(session)
  }
  return groups.filter((g) => g.items.length > 0)
}

export function sessionTitle(session: Pick<AgentSessionOut, 'title'>): string {
  return session.title || m.assistant_untitled()
}

function RenameDialog({
  session,
  onOpenChange,
}: {
  session: AgentSessionOut | null
  onOpenChange: (open: boolean) => void
}) {
  const id = useId()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(session?.title ?? '')
  const update = useMutation({
    ...agentSessionUpdateMutation(),
    onSuccess: () => {
      void invalidateOperations(queryClient, ['agentSessionList', 'agentSessionGet'])
      onOpenChange(false)
    },
    onError: toastError,
  })
  return (
    <Dialog open={session !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (session && title.trim()) {
              update.mutate({ path: { id: session.id }, body: { title: title.trim() } })
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{m.assistant_rename_title()}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`${id}-title`}>{m.assistant_rename_label()}</Label>
            <Input
              id={`${id}-title`}
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {m.common_cancel()}
            </Button>
            <Button type="submit" disabled={!title.trim() || update.isPending}>
              {m.common_save()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Past conversations: search, pinned first, then grouped by day; each can be renamed, pinned
 * or deleted. Used by the full page and the panel's history menu.
 */
export function SessionList({
  activeId,
  onSelect,
  onDeleted,
  className,
}: {
  activeId: string | null
  onSelect: (id: string) => void
  onDeleted?: (id: string) => void
  className?: string
}) {
  const id = useId()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<AgentSessionOut | null>(null)
  const [deleting, setDeleting] = useState<AgentSessionOut | null>(null)
  const list = useQuery({
    ...agentSessionListOptions({ query: { query: query.trim() || undefined, limit: 100 } }),
    placeholderData: (previous) => previous,
  })
  const refresh = () => invalidateOperations(queryClient, ['agentSessionList'])
  const update = useMutation({
    ...agentSessionUpdateMutation(),
    onSuccess: refresh,
    onError: toastError,
  })
  const remove = useMutation({
    ...agentSessionDeleteMutation(),
    onSuccess: (_, variables) => {
      void refresh()
      onDeleted?.(variables.path.id)
      setDeleting(null)
    },
    onError: toastError,
  })
  const groups = groupSessions(list.data?.items ?? [])

  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      <Label htmlFor={`${id}-search`} className="sr-only">
        {m.assistant_history_search()}
      </Label>
      <Input
        id={`${id}-search`}
        type="search"
        placeholder={m.assistant_history_search()}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <nav aria-label={m.assistant_history()} className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {list.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : groups.length === 0 ? (
          query.trim() ? (
            <Empty className="border-0 p-4">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchX aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{m.assistant_history_no_match()}</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="link" size="sm" onClick={() => setQuery('')}>
                  {m.common_clear_filters()}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <Empty className="border-0 p-4">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessagesSquare aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{m.assistant_history_empty()}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )
        ) : (
          groups.map((group) => (
            <section key={group.id} aria-label={group.title}>
              <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group.title}</h3>
              <ItemGroup className="gap-0.5">
                {group.items.map((session) => (
                  <Item
                    key={session.id}
                    size="xs"
                    variant={session.id === activeId ? 'muted' : 'default'}
                    className="group/session gap-1 rounded-lg p-0 pr-1 hover:bg-muted"
                  >
                    <ItemContent className="min-w-0">
                      <button
                        type="button"
                        aria-current={session.id === activeId ? 'true' : undefined}
                        className="truncate rounded-lg px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                        onClick={() => onSelect(session.id)}
                      >
                        {sessionTitle(session)}
                      </button>
                    </ItemContent>
                    <ItemActions>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="opacity-0 group-hover/session:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
                              aria-label={m.assistant_history_actions({
                                title: sessionTitle(session),
                              })}
                            />
                          }
                        >
                          <MoreHorizontal aria-hidden />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setRenaming(session)}>
                            <Pencil aria-hidden />
                            {m.assistant_rename()}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              update.mutate({
                                path: { id: session.id },
                                body: { pinned: !session.pinned },
                              })
                            }
                          >
                            {session.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                            {session.pinned ? m.assistant_unpin() : m.assistant_pin()}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleting(session)}
                          >
                            <Trash2 aria-hidden />
                            {m.common_delete()}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            </section>
          ))
        )}
      </nav>
      <RenameDialog
        key={renaming?.id ?? 'none'}
        session={renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={m.assistant_delete_title()}
        description={m.assistant_delete_description({
          title: deleting ? sessionTitle(deleting) : '',
        })}
        confirmLabel={m.common_delete()}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ path: { id: deleting.id } })}
      />
    </div>
  )
}
