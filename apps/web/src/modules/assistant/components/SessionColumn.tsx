import type { AgentSessionOut } from '@semestra/api-client'
import { agentSessionListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { MoreHorizontal, SearchX, SquarePen } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/ui/sidebar'
import {
  type SessionEditing,
  SessionMenuItems,
  TemporaryMark,
  groupSessions,
  sessionTitle,
} from './SessionList'

/**
 * The conversations in a column beside the open one on the assistant page, laid out like the
 * lists column of the tasks page: "New conversation", a search box, then the conversations,
 * pinned first and grouped by day, each with rename, pin and delete in its ⋯ menu.
 */
export function SessionColumn({
  activeId,
  onSelect,
  onNew,
  editing,
  className,
}: {
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  editing: SessionEditing
  className?: string
}) {
  const [query, setQuery] = useState('')
  const list = useQuery({
    ...agentSessionListOptions({ query: { query: query.trim() || undefined, limit: 100 } }),
    placeholderData: (previous) => previous,
  })
  const groups = groupSessions(list.data?.items ?? [])

  return (
    // The app shell's sidebar provider serves this one too (as in shadcn's sidebar-09).
    <Sidebar
      collapsible="none"
      className={cn('h-full flex-none bg-transparent text-foreground', className)}
      style={{ '--sidebar-width': '15rem' } as CSSProperties}
    >
      <SidebarHeader className="gap-2 px-0 pt-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={activeId === null} onClick={onNew}>
              <SquarePen aria-hidden className="text-muted-foreground!" />
              <span className="truncate">{m.assistant_new()}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarInput
          type="search"
          aria-label={m.assistant_history_search()}
          placeholder={m.assistant_history_search()}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </SidebarHeader>
      <nav aria-label={m.assistant_history()} className="flex min-h-0 flex-1 flex-col">
        <SidebarContent className="gap-0">
          {list.isSuccess && groups.length === 0 ? (
            <p className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
              {query.trim() ? <SearchX aria-hidden className="size-3.5" /> : null}
              {query.trim() ? m.assistant_history_no_match() : m.assistant_history_empty()}
            </p>
          ) : null}
          {groups.map((group) => (
            <SidebarGroup key={group.id} className="px-0">
              <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
              <SidebarMenu>
                {group.items.map((session) => (
                  <SessionEntry
                    key={session.id}
                    session={session}
                    active={session.id === activeId}
                    onSelect={() => onSelect(session.id)}
                    editing={editing}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>
      </nav>
    </Sidebar>
  )
}

function SessionEntry({
  session,
  active,
  onSelect,
  editing,
}: {
  session: AgentSessionOut
  active: boolean
  onSelect: () => void
  editing: SessionEditing
}) {
  const title = sessionTitle(session)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        aria-current={active ? 'true' : undefined}
        title={title}
        onClick={onSelect}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {session.temporary ? <TemporaryMark /> : null}
          {title}
        </span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction showOnHover aria-label={m.assistant_history_actions({ title })} />
          }
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <SessionMenuItems session={session} editing={editing} />
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}
