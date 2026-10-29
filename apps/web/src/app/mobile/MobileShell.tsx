import { Link, Navigate, useMatch } from '@tanstack/react-router'
import { Ellipsis, MonitorSmartphone } from 'lucide-react'
import { useState } from 'react'
import type { PageContribution, Scope } from '@/app/extensions'
import { PluginBoundary } from '@/app/host/PluginBoundary'
import { usePageStatuses } from '@/app/registry'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { MoreDrawer } from './MoreDrawer'

/** The Program's pages that have a phone version, the tabs first by their order. */
function usePhonePages(scope: Scope): { pages: PageContribution[]; tabs: PageContribution[] } {
  const pages = usePageStatuses(scope)
    .filter((entry) => entry.status === 'available' && entry.page.mobile)
    .map((entry) => entry.page)
  const tabs = pages
    .filter((page) => page.mobile?.tab)
    .sort((a, b) => a.mobile!.tab!.order - b.mobile!.tab!.order)
  return { pages, tabs }
}

/**
 * The signed-in app on a phone (M17): one page at a time over a tab bar. Only Program pages with
 * a phone version (`PageContribution.mobile`) are shown; every other address asks for a
 * computer. The desktop shell and pages are not loaded.
 */
export default function MobileShell({ programId }: { programId: string }) {
  const scope: Scope = { kind: 'program', programId }
  const { pages, tabs } = usePhonePages(scope)
  const pageMatch = useMatch({ from: '/_authed/p/$programId/$page', shouldThrow: false })
  const atProgram = useMatch({ from: '/_authed/p/$programId/', shouldThrow: false })
  const pageId = pageMatch?.params.page
  const home = tabs[0]
  const page = pages.find((candidate) => candidate.id === pageId)
  // The Program's address (where `/` and the installed app start) opens the first tab.
  if (atProgram && home) {
    return <Navigate to="/p/$programId/$page" params={{ programId, page: home.id }} replace />
  }
  const Page = page?.mobile?.component
  return (
    <div className="flex h-dvh flex-col bg-background">
      <main className="flex min-h-0 flex-1 flex-col">
        {Page ? (
          <PluginBoundary key={`${programId}:${page.id}`}>
            <Page scope={scope} />
          </PluginBoundary>
        ) : (
          <DesktopOnly programId={programId} home={home} />
        )}
      </main>
      <TabBar programId={programId} tabs={tabs} activeId={page?.id} />
    </div>
  )
}

function DesktopOnly({
  programId,
  home,
}: {
  programId: string
  home: PageContribution | undefined
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MonitorSmartphone aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{m.mobile_desktop_only_title()}</EmptyTitle>
        <EmptyDescription>{m.mobile_desktop_only_description()}</EmptyDescription>
      </EmptyHeader>
      {home ? (
        <EmptyContent>
          <Button
            nativeButton={false}
            render={<Link to="/p/$programId/$page" params={{ programId, page: home.id }} replace />}
          >
            {m.mobile_desktop_only_action({ page: home.title() })}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  )
}

const TAB = 'flex flex-col items-center gap-0.5 pt-2 text-[11px] font-medium text-muted-foreground'

function TabBar({
  programId,
  tabs,
  activeId,
}: {
  programId: string
  tabs: PageContribution[]
  activeId: string | undefined
}) {
  const [more, setMore] = useState(false)
  return (
    <nav
      aria-label={m.mobile_tabs_label()}
      className="grid shrink-0 auto-cols-fr grid-flow-col border-t bg-background pb-[max(env(safe-area-inset-bottom),0.5rem)]"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId
        const Icon = tab.icon
        return (
          <Link
            key={tab.id}
            to="/p/$programId/$page"
            params={{ programId, page: tab.id }}
            aria-current={active ? 'page' : undefined}
            className={cn(TAB, active && 'text-primary')}
          >
            <Icon aria-hidden className="size-6" strokeWidth={active ? 2.25 : 1.75} />
            {tab.title()}
          </Link>
        )
      })}
      <button type="button" className={TAB} onClick={() => setMore(true)}>
        <Ellipsis aria-hidden className="size-6" strokeWidth={1.75} />
        {m.mobile_more()}
      </button>
      <MoreDrawer programId={programId} open={more} onOpenChange={setMore} />
    </nav>
  )
}
