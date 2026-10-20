import { agentSessionListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useRouter } from '@tanstack/react-router'
import { History, MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { HistoryLink } from '@/components/HistoryLink'
import { m } from '@/paraglide/messages'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import {
  SidebarMenuAction,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/ui/sidebar'
import {
  SessionList,
  SessionMenuItems,
  recentSessions,
  sessionTitle,
  useSessionEditing,
} from './SessionList'

/** How many conversations the sidebar lists before "All conversations…". */
export const RECENT_SESSIONS = 8

const SESSION_IN_PATH = /\/assistant\/([^/]+)/

/**
 * A sub-entry's ⋯ button, shown while that entry is hovered or focused (`showOnHover` would
 * follow the whole Sem entry, which holds every sub-entry).
 */
export const SUB_ACTION =
  'top-1 right-0.5 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 aria-expanded:bg-muted aria-expanded:opacity-100 md:opacity-0'

/**
 * The recent conversations under Sem in the app sidebar while its page is open (pinned first),
 * each with rename, pin and delete; "All conversations…" opens the searchable list.
 */
export function SessionNav({
  programId,
  onNavigate,
}: {
  programId: string
  onNavigate: () => void
}) {
  const router = useRouter()
  const activeId = useLocation({ select: (l) => SESSION_IN_PATH.exec(l.pathname)?.[1] ?? null })
  const [allOpen, setAllOpen] = useState(false)
  const base = `/p/${programId}/assistant`
  const editing = useSessionEditing((id) => id === activeId && router.history.push(base))
  // The same request as the full list, so both share the cache.
  const list = useQuery(agentSessionListOptions({ query: { limit: 100 } }))
  const items = recentSessions(list.data?.items ?? [])
  const recent = items.slice(0, RECENT_SESSIONS)

  return (
    <>
      <SidebarMenuSub aria-label={m.assistant_history()}>
        {list.isSuccess && items.length === 0 ? (
          <SidebarMenuSubItem>
            <span className="block px-3 py-1 text-xs text-muted-foreground">
              {m.assistant_history_empty()}
            </span>
          </SidebarMenuSubItem>
        ) : null}
        {recent.map((session) => {
          const title = sessionTitle(session)
          return (
            <SidebarMenuSubItem key={session.id}>
              <SidebarMenuSubButton
                isActive={session.id === activeId}
                className="group-focus-within/menu-sub-item:pr-7 group-hover/menu-sub-item:pr-7 group-has-aria-expanded/menu-sub-item:pr-7"
                title={title}
                render={
                  <HistoryLink
                    href={`${base}/${session.id}`}
                    onClick={onNavigate}
                    aria-current={session.id === activeId ? 'page' : undefined}
                  />
                }
              >
                <span className="truncate">{title}</span>
              </SidebarMenuSubButton>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuAction
                      className={SUB_ACTION}
                      aria-label={m.assistant_history_actions({ title })}
                    />
                  }
                >
                  <MoreHorizontal aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start">
                  <SessionMenuItems session={session} editing={editing} />
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuSubItem>
          )
        })}
        {items.length > 0 ? (
          <SidebarMenuSubItem>
            <SidebarMenuSubButton
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by its children
              render={<button type="button" />}
              className="w-full text-muted-foreground"
              onClick={() => setAllOpen(true)}
            >
              <History aria-hidden className="text-muted-foreground!" />
              <span>{m.assistant_history_all()}</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ) : null}
      </SidebarMenuSub>
      {editing.dialogs}
      <Dialog open={allOpen} onOpenChange={setAllOpen}>
        <DialogContent className="flex h-[min(36rem,80vh)] flex-col sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{m.assistant_history()}</DialogTitle>
          </DialogHeader>
          <SessionList
            className="flex-1"
            activeId={activeId}
            onSelect={(id) => {
              setAllOpen(false)
              onNavigate()
              router.history.push(`${base}/${id}`)
            }}
            onDeleted={(id) => id === activeId && router.history.push(base)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
