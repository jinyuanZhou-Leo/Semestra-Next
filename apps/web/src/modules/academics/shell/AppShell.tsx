import { useLocation } from '@tanstack/react-router'
import { Fragment, type ReactNode, useEffect, useState } from 'react'
import { readCollapsedMirror, writeCollapsedMirror } from '@/app/boot'
import { ShellToolbarSlot } from '@/app/host/ShellToolbar'
import { usePreferences } from '@/app/preferences'
import { useModules, usePages } from '@/app/registry'
import { useUiPref } from '@/app/ui-pref'
import { m } from '@/paraglide/messages'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/ui/sidebar'
import { isLastPageCandidate, LAST_PAGE_KEY } from '../start-page'
import { AppSidebar } from './AppSidebar'
import { Tour } from './Tour'

function ShellInset({ children }: { children: ReactNode }) {
  const { open } = useSidebar()
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null)
  return (
    <SidebarInset className="h-full min-w-0 overflow-hidden">
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 has-[[data-shell-toolbar]:not(:empty)]:h-12">
        <div className="flex min-w-0 items-center gap-2 px-4">
          <SidebarTrigger
            className="-ml-1"
            aria-label={open ? m.academics_sidebar_collapse() : m.academics_sidebar_expand()}
          />
        </div>
        <div
          ref={setToolbar}
          data-shell-toolbar
          className="flex min-w-0 flex-1 items-center gap-1 pr-4"
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ShellToolbarSlot value={toolbar}>{children}</ShellToolbarSlot>
      </div>
    </SidebarInset>
  )
}

/**
 * Keeps the page on screen while the start page is "last page" (M11 `start_page`): only pages the
 * sidebar opens, not the term wizard, an import or settings.
 */
function useRememberLastPage(programId: string) {
  const pathname = useLocation({ select: (l) => l.pathname })
  const pageIds = usePages({ kind: 'program', programId }).map((page) => page.id)
  const remember =
    usePreferences().data?.start_page === 'last' &&
    isLastPageCandidate(pathname, programId, pageIds)
  const [last, setLast] = useUiPref<string | null>(LAST_PAGE_KEY, null, { scope: programId })
  useEffect(() => {
    if (remember && last !== pathname) setLast(pathname)
  }, [remember, last, pathname, setLast])
}

/**
 * The signed-in app around a Program's pages on a computer: the sidebar, the content and the
 * assistant panel docked on the right. Phones get `app/mobile/MobileShell` instead (M17).
 */
export function AppShell({ programId, children }: { programId: string; children: ReactNode }) {
  // Until the UI preferences load, the last value this browser saw, as the boot screen drew it.
  const [mirrored] = useState(readCollapsedMirror)
  const [collapsed, setCollapsed] = useUiPref('layout.sidebar_collapsed', mirrored)
  useEffect(() => writeCollapsedMirror(collapsed), [collapsed])
  // The assistant (M12) docks beside the content when it is installed.
  const Dock = useModules().find((module) => module.assistant)?.assistant?.Dock ?? Fragment
  useRememberLastPage(programId)
  return (
    <SidebarProvider
      open={!collapsed}
      onOpenChange={(open) => setCollapsed(!open)}
      className="h-dvh min-h-0"
    >
      <AppSidebar programId={programId} />
      <Dock>
        <ShellInset>{children}</ShellInset>
      </Dock>
      <Tour />
    </SidebarProvider>
  )
}
