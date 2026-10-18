import { useRouter } from '@tanstack/react-router'
import { MoreHorizontal } from 'lucide-react'
import { type MouseEvent, useState } from 'react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { type Scope, scopePath } from '../extensions'
import { useHostAction } from '../commands/bus'
import { ManagePagesDialog } from './ManagePagesDialog'
import { useScopePages } from './nav'

/**
 * The tab bar of a scope (M10 §5.1): its available pages in the user's order, without hidden
 * ones, and a "⋯" menu to manage them.
 */
export function ScopeNav({ scope, activePageId }: { scope: Scope; activePageId?: string }) {
  const { pages } = useScopePages(scope)
  const router = useRouter()
  const [managing, setManaging] = useState(false)
  useHostAction('nav.manage', () => setManaging(true))

  const follow = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    router.history.push(href)
  }

  return (
    <div className="flex items-end border-b border-border">
      <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {pages.map((page) => {
          const href = scopePath(scope, page.id)
          const active = page.id === activePageId
          return (
            <a
              key={page.id}
              href={href}
              onClick={(event) => follow(event, href)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 border-b-2 px-3 py-2 text-sm whitespace-nowrap',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <page.icon aria-hidden className="size-4" />
              {page.title()}
            </a>
          )
        })}
      </nav>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="mb-1 shrink-0"
              aria-label={m.host_nav_more()}
              title={m.host_nav_more()}
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setManaging(true)}>
              {m.host_nav_manage_pages()}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ManagePagesDialog scope={scope} open={managing} onOpenChange={setManaging} />
    </div>
  )
}
