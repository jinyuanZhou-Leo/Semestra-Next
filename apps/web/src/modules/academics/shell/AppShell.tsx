import { Fragment, type ReactNode, useEffect, useState } from 'react'
import { readCollapsedMirror, writeCollapsedMirror } from '@/app/boot'
import { ShellSidebarOpen, ShellToolbarSlot } from '@/app/host/ShellToolbar'
import { useModules } from '@/app/registry'
import { useUiPref } from '@/app/ui-pref'
import { m } from '@/paraglide/messages'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/ui/sidebar'
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
        <ShellToolbarSlot value={toolbar}>
          <ShellSidebarOpen value={open}>{children}</ShellSidebarOpen>
        </ShellToolbarSlot>
      </div>
    </SidebarInset>
  )
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
