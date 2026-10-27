import { useLocation } from '@tanstack/react-router'
import { MonitorSmartphone } from 'lucide-react'
import { Fragment, type ReactNode, useEffect, useState } from 'react'
import { readCollapsedMirror, writeCollapsedMirror } from '@/app/boot'
import { ShellSidebarOpen, ShellToolbarSlot } from '@/app/host/ShellToolbar'
import { useModules } from '@/app/registry'
import { useUiPref } from '@/app/ui-pref'
import { m } from '@/paraglide/messages'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Separator } from '@/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/ui/sidebar'
import { useProgram } from '../queries'
import { AppSidebar } from './AppSidebar'
import { Tour } from './Tour'

/** Pages that work on a phone; everything else asks for a desktop (M02 §5.1). */
const PHONE_PAGE = /\/today$/

function ShellInset({ programId, children }: { programId: string; children: ReactNode }) {
  const { isMobile, open } = useSidebar()
  const pathname = useLocation({ select: (l) => l.pathname })
  const programName = useProgram(programId).data?.name ?? ''
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null)
  return (
    <SidebarInset className="h-full min-w-0 overflow-hidden">
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 has-[[data-shell-toolbar]:not(:empty)]:h-12">
        <div className="flex min-w-0 items-center gap-2 px-4">
          <SidebarTrigger
            className="-ml-1"
            aria-label={
              isMobile
                ? m.academics_open_navigation()
                : open
                  ? m.academics_sidebar_collapse()
                  : m.academics_sidebar_expand()
            }
          />
          {isMobile ? (
            <>
              <Separator
                orientation="vertical"
                className="mr-2 data-vertical:h-4 data-vertical:self-auto"
              />
              <span className="truncate font-heading text-sm font-semibold">{programName}</span>
            </>
          ) : null}
        </div>
        <div
          ref={setToolbar}
          data-shell-toolbar
          className="flex min-w-0 flex-1 items-center gap-1 pr-4"
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {isMobile && !PHONE_PAGE.test(pathname) ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MonitorSmartphone aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.academics_desktop_only_title()}</EmptyTitle>
              <EmptyDescription>{m.academics_desktop_only_description()}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ShellToolbarSlot value={toolbar}>
            <ShellSidebarOpen value={open && !isMobile}>{children}</ShellSidebarOpen>
          </ShellToolbarSlot>
        )}
      </div>
    </SidebarInset>
  )
}

/**
 * The signed-in app around a Program's pages: the sidebar (a drawer on phones), the content and
 * the assistant panel docked on the right.
 */
export function AppShell({ programId, children }: { programId: string; children: ReactNode }) {
  // Until the UI preferences load, the last value this browser saw, as the boot screen drew it.
  const [mirrored] = useState(readCollapsedMirror)
  const [collapsed, setCollapsed] = useUiPref('layout.sidebar_collapsed', mirrored)
  useEffect(() => writeCollapsedMirror(collapsed), [collapsed])
  // The assistant (M12) docks beside the content when it is installed.
  const Dock = useModules().find((module) => module.assistant)?.assistant?.Dock ?? Fragment
  return (
    <SidebarProvider
      open={!collapsed}
      onOpenChange={(open) => setCollapsed(!open)}
      className="h-dvh min-h-0"
    >
      <AppSidebar programId={programId} />
      <Dock>
        <ShellInset programId={programId}>{children}</ShellInset>
      </Dock>
      <Tour />
    </SidebarProvider>
  )
}
