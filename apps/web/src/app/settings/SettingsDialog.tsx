import { useLocation, useRouterState } from '@tanstack/react-router'
import {
  BarChart3,
  Boxes,
  CalendarDays,
  Cable,
  Database,
  GraduationCap,
  Info,
  KeyRound,
  ListChecks,
  type LucideIcon,
  Palette,
  Plug,
  Puzzle,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Wrench,
} from 'lucide-react'
import { type CSSProperties, useEffect, useState } from 'react'
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
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@/ui/native-select'
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
  SidebarSeparator,
} from '@/ui/sidebar'
import { useHostAction } from '../commands'
import type { SettingsGroup, SettingsLevel } from '../extensions'
import { useSettingsSections } from '../registry'
import {
  CLUSTER_TITLES,
  GROUP_ALIASES,
  GROUP_TITLES,
  buildNavigation,
  clusterNavigation,
} from './groups'
import { type PathIds, type SettingsPath, scopeIdAt, useSettingsPath } from './scope-path'
import { PATH_LEVEL_NAMES, ScopePath } from './ScopePath'
import { SettingsSections } from './SettingsSections'
import { type SettingsTarget, useSettingsDialog } from './use-settings-dialog'

const GROUP_ICONS: Record<SettingsGroup, LucideIcon> = {
  general: SlidersHorizontal,
  grades: GraduationCap,
  account: UserRound,
  security: ShieldCheck,
  preferences: Palette,
  'ai-providers': KeyRound,
  'ai-models': Boxes,
  'ai-usage': BarChart3,
  'ai-permissions': ListChecks,
  'ai-mcp': Cable,
  calendar: CalendarDays,
  features: Wrench,
  integrations: Plug,
  plugins: Puzzle,
  data: Database,
  about: Info,
}

type Params = { programId?: string; termId?: string; courseId?: string }

/** The name shown above the groups: the Program, term or course being configured. */
function scopeName(path: SettingsPath): string | undefined {
  if (path.level === 'program') return path.program?.name
  if (path.level === 'term') return path.term?.name
  if (path.level === 'course') return path.course ? courseLabel(path.course) : undefined
  return undefined
}

/**
 * Settings as a dialog (M11 §5.2), shaped like shadcn's "sidebar in a dialog": the level path and
 * the groups on the left, the sections of the chosen group on the right. Account, Program, term
 * and course settings share it; `?settings=` names the level and `&scope=` its Program, term or
 * course, which otherwise comes from the page.
 */
export function SettingsDialog() {
  const { target, open, close } = useSettingsDialog()
  // The dialog sits above the pages, so the page's scope comes from the deepest match.
  const params = useRouterState({ select: (state) => state.matches.at(-1)?.params ?? {} }) as Params

  // "Manage plugins" in the command palette opens the plugin group of the account settings.
  useHostAction('settings.plugins', () => open({ level: 'account', group: 'plugins' }))

  return (
    <Dialog open={target !== undefined} onOpenChange={(next) => !next && close()}>
      {target ? (
        <DialogContent
          // Focus the level being edited, not the first node of the path; while the path is still
          // loading, the dialog itself (no focus ring on a level that is not the current one).
          initialFocus={() =>
            document.querySelector<HTMLElement>('[data-settings-level-current]') ??
            document.querySelector<HTMLElement>('[data-slot="dialog-content"]') ??
            true
          }
          className="gap-0 overflow-hidden p-0 h-[min(46rem,calc(100svh-2rem))] md:w-[72rem] md:max-w-[calc(100%-2rem)]"
          showCloseButton
        >
          <SettingsBody target={target} page={params} />
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

function SettingsBody({ target, page }: { target: SettingsTarget; page: Params }) {
  const { select, switchTo } = useSettingsDialog()
  // What was picked on the level path; until then the path follows the page on screen.
  const [picked, setPicked] = useState<PathIds | undefined>(undefined)
  const path = useSettingsPath(target, picked ?? page)
  const { level, scope } = path
  const groupId = target.group
  const name = scopeName(path)
  const sections = useSettingsSections(level)
  // Until the path is known the level is not either: show no groups rather than the wrong ones.
  const groups = path.pending ? [] : buildNavigation(sections, level)
  const runs = clusterNavigation(groups, level)
  const hash = useLocation({ select: (location) => location.hash })
  // Old links name a group that was split (`account/ai`): they open the page that replaced it.
  const wanted = groupId ? (GROUP_ALIASES[groupId] ?? groupId) : undefined
  // A link to a section that has since moved to another group still lands on that section.
  const current =
    groups.find((g) => g.id === wanted && g.sections.some((s) => s.id === hash)) ??
    groups.find((g) => g.sections.some((s) => s.id === hash)) ??
    groups.find((g) => g.id === wanted) ??
    groups[0]
  const title = name ?? m.settings_title()

  // Another level keeps the group on screen when that level has one with the same name.
  const goTo = (next: SettingsLevel, ids: PathIds) => {
    setPicked(ids)
    const id =
      next === 'program'
        ? ids.programId
        : next === 'term'
          ? ids.termId
          : (ids.courseId ?? undefined)
    switchTo({ level: next, group: current?.id, scope: id })
  }
  const levels = (['account', 'program', 'term', 'course'] as const).filter(
    (l) => l === 'account' || scopeIdAt(l, path) !== undefined,
  )

  // The course, term or Program the URL names is gone (deleted from this dialog, say): show the
  // nearest level above it and drop the stale id from the URL.
  const stale =
    target.scope !== undefined && !path.pending && scopeIdAt(target.level, path) !== target.scope
  const shownScope = scopeIdAt(level, path)
  const shownGroup = current?.id
  useEffect(() => {
    if (stale) switchTo({ level, group: shownGroup, scope: shownScope })
  }, [stale, level, shownGroup, shownScope, switchTo])

  // Jump to `#section` when the dialog opens with a hash or the group changes.
  useEffect(() => {
    if (hash && shownGroup !== undefined) document.getElementById(hash)?.scrollIntoView()
  }, [hash, shownGroup])

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
            <ScopePath path={path} onSelect={goTo} />
            <SidebarSeparator className="mx-3" />
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
            {/* Without the sidebar column, selects switch the level and the group. */}
            <NativeSelect
              aria-label={m.settings_path_label()}
              className="md:hidden"
              value={level}
              onChange={(event) =>
                goTo(event.target.value as SettingsLevel, {
                  programId: path.program?.id,
                  termId: path.term?.id,
                  courseId: path.course?.id ?? null,
                })
              }
            >
              {levels.map((l) => (
                <NativeSelectOption key={l} value={l}>
                  {PATH_LEVEL_NAMES[l]()}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {current ? (
              <NativeSelect
                aria-label={m.settings_title()}
                className="md:hidden"
                value={current.id}
                onChange={(event) => select(event.target.value)}
              >
                {runs.map((run) => {
                  const options = run.groups.map((group) => (
                    <NativeSelectOption key={group.id} value={group.id}>
                      {GROUP_TITLES[group.id]()}
                    </NativeSelectOption>
                  ))
                  return run.cluster ? (
                    <NativeSelectOptGroup key={run.cluster} label={CLUSTER_TITLES[run.cluster]()}>
                      {options}
                    </NativeSelectOptGroup>
                  ) : (
                    options
                  )
                })}
              </NativeSelect>
            ) : null}
          </header>
          {/* Keyed by scope and group: a new one opens at its top and its forms start fresh. */}
          <div
            key={`${level}:${scopeIdAt(level, path) ?? ''}:${current?.id ?? ''}`}
            className="flex-1 overflow-y-auto px-4 pb-8 md:px-6"
          >
            {path.pending ? null : current ? (
              <div className="mx-auto max-w-3xl">
                <SettingsSections level={level} scope={scope} group={current.id} />
              </div>
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
