import { useLocation } from '@tanstack/react-router'
import { Menu, MonitorSmartphone } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useUiPref } from '@/app/ui-pref'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Sheet, SheetContent, SheetTitle } from '@/ui/sheet'
import { useProgram } from '../queries'
import { useIsNarrow } from './media'
import { Sidebar } from './Sidebar'
import { Tour } from './Tour'

/** Pages that work on a phone; everything else asks for a desktop (M02 §5.1). */
const PHONE_PAGE = /\/today$/

/** The signed-in app around a Program's pages: sidebar (a drawer on phones) and content. */
export function AppShell({ programId, children }: { programId: string; children: ReactNode }) {
  const narrow = useIsNarrow()
  const pathname = useLocation({ select: (l) => l.pathname })
  const [collapsed, setCollapsed] = useUiPref('layout.sidebar_collapsed', false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const programName = useProgram(programId).data?.name ?? ''

  if (narrow) {
    return (
      <div className="flex min-h-dvh flex-col bg-background">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.academics_open_navigation()}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu aria-hidden />
          </Button>
          <span className="truncate font-heading text-sm font-semibold">{programName}</span>
        </header>
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="p-0">
            <SheetTitle className="sr-only">{m.academics_sidebar_label()}</SheetTitle>
            <Sidebar programId={programId} drawer onNavigate={() => setDrawerOpen(false)} />
          </SheetContent>
        </Sheet>
        <main className="min-w-0 flex-1">
          {PHONE_PAGE.test(pathname) ? (
            children
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MonitorSmartphone aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{m.academics_desktop_only_title()}</EmptyTitle>
                <EmptyDescription>{m.academics_desktop_only_description()}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="flex h-dvh bg-background">
      <Sidebar
        programId={programId}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
      />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      <Tour />
    </div>
  )
}
