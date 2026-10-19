import {
  academicsCourseGetOptions,
  academicsProgramGetOptions,
  academicsTermGetOptions,
} from '@semestra/api-client/react-query'
import { useLocation, useRouterState } from '@tanstack/react-router'
import {
  CalendarDays,
  Database,
  GraduationCap,
  Info,
  type LucideIcon,
  Palette,
  Plug,
  Puzzle,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Wrench,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { type CSSProperties, useEffect } from 'react'
import { courseLabel } from '@/modules/academics/color'
import { m } from '@/paraglide/messages'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/ui/breadcrumb'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'
import { Empty, EmptyHeader, EmptyTitle } from '@/ui/empty'
import { NativeSelect, NativeSelectOption } from '@/ui/native-select'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/ui/sidebar'
import { useHostAction } from '../commands'
import type { Scope, SettingsGroup, SettingsLevel } from '../extensions'
import { useSettingsSections } from '../registry'
import { CLUSTER_TITLES, GROUP_TITLES, buildNavigation, clusterNavigation } from './groups'
import { SettingsSections } from './SettingsSections'
import { useSettingsDialog } from './use-settings-dialog'

const GROUP_ICONS: Record<SettingsGroup, LucideIcon> = {
  general: SlidersHorizontal,
  grades: GraduationCap,
  account: UserRound,
  security: ShieldCheck,
  preferences: Palette,
  ai: Sparkles,
  calendar: CalendarDays,
  features: Wrench,
  integrations: Plug,
  plugins: Puzzle,
  data: Database,
  about: Info,
}

type Params = { programId?: string; termId?: string; courseId?: string }

/** The scope a settings level applies to on the page on screen; none when the page has none. */
function scopeOf(level: SettingsLevel, { programId, termId, courseId }: Params) {
  if (level === 'program' && programId) return { kind: 'program', programId } as const
  if (level === 'term' && programId && termId) return { kind: 'term', programId, termId } as const
  if (level === 'course' && programId && courseId) {
    return { kind: 'course', programId, courseId } as const
  }
  return undefined
}

/** The name shown above the groups: the Program, term or course being configured. */
function useScopeName(scope: Scope | undefined): string | undefined {
  const program = useQuery({
    ...academicsProgramGetOptions({
      path: { program_id: scope?.kind === 'program' ? scope.programId : '' },
    }),
    enabled: scope?.kind === 'program',
    staleTime: 60_000,
  })
  const term = useQuery({
    ...academicsTermGetOptions({ path: { term_id: scope?.kind === 'term' ? scope.termId : '' } }),
    enabled: scope?.kind === 'term',
    staleTime: 60_000,
  })
  const course = useQuery({
    ...academicsCourseGetOptions({
      path: { course_id: scope?.kind === 'course' ? scope.courseId : '' },
    }),
    enabled: scope?.kind === 'course',
    staleTime: 60_000,
  })
  if (scope?.kind === 'program') return program.data?.name
  if (scope?.kind === 'term') return term.data?.name
  if (scope?.kind === 'course') return course.data ? courseLabel(course.data) : undefined
  return undefined
}

/**
 * Settings as a dialog (M11 §5.2), shaped like shadcn's "sidebar in a dialog": the groups on the
 * left, the sections of the chosen group on the right. Account settings and the Program, term
 * and course settings share it; the level comes from `?settings=` and the scope from the page.
 */
export function SettingsDialog() {
  const { target, open, close } = useSettingsDialog()
  // The dialog sits above the pages, so the scope comes from the deepest match, not its own.
  const params = useRouterState({ select: (state) => state.matches.at(-1)?.params ?? {} }) as Params
  const scope = target ? scopeOf(target.level, params) : undefined
  // A scope level only exists on the pages of that scope.
  const available = target !== undefined && (target.level === 'account' || scope !== undefined)

  // "Manage plugins" in the command palette opens the plugin group of the account settings.
  useHostAction('settings.plugins', () => open({ level: 'account', group: 'plugins' }))

  return (
    <Dialog open={available} onOpenChange={(next) => !next && close()}>
      {available ? (
        <DialogContent
          className="gap-0 overflow-hidden p-0 h-[min(46rem,calc(100svh-2rem))] md:w-[72rem] md:max-w-[calc(100%-2rem)]"
          showCloseButton
        >
          <SettingsBody level={target.level} scope={scope} groupId={target.group} />
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

function SettingsBody({
  level,
  scope,
  groupId,
}: {
  level: SettingsLevel
  scope?: Scope
  groupId?: string
}) {
  const { select } = useSettingsDialog()
  const name = useScopeName(scope)
  const sections = useSettingsSections(level)
  const groups = buildNavigation(sections, level)
  const runs = clusterNavigation(groups, level)
  const current = groups.find((g) => g.id === groupId) ?? groups[0]
  const title = name ?? m.settings_title()

  // Jump to `#section` when the dialog opens with a hash or the group changes.
  const hash = useLocation({ select: (location) => location.hash })
  useEffect(() => {
    if (hash) document.getElementById(hash)?.scrollIntoView()
  }, [hash, current?.id])

  return (
    <>
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <DialogDescription className="sr-only">{m.settings_dialog_description()}</DialogDescription>
      <SidebarProvider
        className="h-full min-h-0 items-start"
        style={{ '--sidebar-width': '15rem' } as CSSProperties}
      >
        <Sidebar collapsible="none" className="hidden border-r md:flex">
          <SidebarContent>
            <nav aria-label={m.settings_title()}>
              {runs.map((run) => (
                <SidebarGroup key={run.cluster ?? 'all'}>
                  {run.cluster ? (
                    <SidebarGroupLabel>{CLUSTER_TITLES[run.cluster]()}</SidebarGroupLabel>
                  ) : null}
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {run.groups.map((group) => {
                        const Icon = GROUP_ICONS[group.id]
                        return (
                          <SidebarMenuItem key={group.id}>
                            <SidebarMenuButton
                              isActive={group.id === current?.id}
                              aria-current={group.id === current?.id ? 'page' : undefined}
                              onClick={() => select(group.id)}
                            >
                              <Icon aria-hidden />
                              <span>{GROUP_TITLES[group.id]()}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        )
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </nav>
          </SidebarContent>
        </Sidebar>
        <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-3 pr-14 pl-4 md:pl-6">
            <Breadcrumb className="min-w-0">
              <BreadcrumbList className="flex-nowrap">
                <BreadcrumbItem className="min-w-0 max-md:hidden">
                  <span className="truncate">{title}</span>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="max-md:hidden" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="max-md:hidden">
                    {current ? GROUP_TITLES[current.id]() : null}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            {/* Without the sidebar column, a select switches the group. */}
            {current ? (
              <NativeSelect
                aria-label={m.settings_title()}
                className="md:hidden"
                value={current.id}
                onChange={(event) => select(event.target.value)}
              >
                {groups.map((group) => (
                  <NativeSelectOption key={group.id} value={group.id}>
                    {GROUP_TITLES[group.id]()}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : null}
          </header>
          {/* Keyed by group so a new group opens at its top instead of the old scroll position. */}
          <div key={current?.id} className="flex-1 overflow-y-auto px-4 pb-6 md:px-6">
            {current ? (
              <SettingsSections level={level} scope={scope} group={current.id} />
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{m.settings_empty()}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </main>
      </SidebarProvider>
    </>
  )
}
