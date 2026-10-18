import { useRouter } from '@tanstack/react-router'
import type { MouseEvent } from 'react'
import { cn } from '@/lib/utils'
import { type Scope, scopePath } from '../extensions'
import { usePages } from '../registry'

/** Navigation bar listing the pages available in a scope (M00 §4.4; M10 adds ordering). */
export function ScopeNav({ scope, activePageId }: { scope: Scope; activePageId?: string }) {
  const pages = usePages(scope)
  const router = useRouter()

  const follow = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    router.history.push(href)
  }

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border">
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
  )
}
