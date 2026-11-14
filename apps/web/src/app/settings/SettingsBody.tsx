import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import {
  BarChart3,
  BellRing,
  Boxes,
  CalendarDays,
  Database,
  FolderOpen,
  GraduationCap,
  Info,
  KeyRound,
  ListChecks,
  Palette,
  Plug,
  Puzzle,
  School,
  Search,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import {
  type CSSProperties,
  type KeyboardEvent,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useState,
} from 'react'
import { whenIdle } from '@/lib/when-settled'
import { courseLabel } from '@/modules/academics/color'
import { m } from '@/paraglide/messages'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/ui/breadcrumb'
import { Button } from '@/ui/button'
import { DialogDescription, DialogTitle } from '@/ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@/ui/native-select'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from '@/ui/sidebar'
import { type Scope, type SettingsGroup, type SettingsLevel, preload } from '../extensions'
import { useModules, useSettingsSections } from '../registry'
import {
  CLUSTER_TITLES,
  GROUP_ALIASES,
  GROUP_TITLES,
  type NavGroup,
  buildNavigation,
  clusterNavigation,
} from './groups'
import { type PathIds, type SettingsPath, scopeIdAt, useSettingsPath } from './scope-path'
import { loadSections, sectionsReady } from './prefetch'
import { PATH_LEVEL_NAMES, ScopePath } from './ScopePath'
import { searchWords, useSectionSearch } from './search'
import { SectionFrame, SettingsSections } from './SettingsSections'
import { type SettingsTarget, useSettingsDialog } from './use-settings-dialog'

const GROUP_ICONS: Record<SettingsGroup, LucideIcon> = {
  general: SlidersHorizontal,
  grades: GraduationCap,
  account: UserRound,
  preferences: Palette,
  notifications: BellRing,
  calendar: CalendarDays,
  'ai-providers': KeyRound,
  'ai-models': Boxes,
  'ai-usage': BarChart3,
  'ai-sem': Sparkles,
  'api-mcp': Plug,
  tasks: ListChecks,
  files: FolderOpen,
  lms: School,
  plugins: Puzzle,
  data: Database,
  about: Info,
}

export type Params = { programId?: string; termId?: string; courseId?: string }

/** The group in the pane, which follows the one picked once its code and data are in. */
type Shown = {
  key: string
  level: SettingsLevel
  scope: Scope | undefined
  scopeId: string | undefined
  group: SettingsGroup
}

/** The name shown above the groups: the Program, term or course being configured. */
function scopeName(path: SettingsPath): string | undefined {
  if (path.level === 'program') return path.program?.name
  if (path.level === 'term') return path.term?.name
  if (path.level === 'course') return path.course ? courseLabel(path.course) : undefined
  return undefined
}

export function SettingsBody({ target, page }: { target: SettingsTarget; page: Params }) {
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

  // Search (M11 §5.2): every section of the level is rendered, the ones without the words hidden.
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const searching = searchWords(deferredQuery).length > 0
  const paneKey = path.pending ? '' : `${level}:${scopeIdAt(level, path) ?? ''}`
  const { ref: searchRef, matched: found } = useSectionSearch(searching ? deferredQuery : '')
  const matched = searching ? found : undefined
  const isHit = (section: { id: string }) => matched?.has(section.id) === true
  const hitGroups = groups.filter((group) => group.sections.some(isHit))
  const navRuns = searching ? clusterNavigation(hitGroups, level) : runs
  const clearOnEscape = (event: KeyboardEvent<HTMLInputElement>) => {
    // Esc clears the search first; only an empty field lets it close the dialog.
    if (event.key === 'Escape' && query) {
      event.stopPropagation()
      setQuery('')
    }
  }

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

  // The pane changes to the picked group once its code and data are in (at most a moment), so a
  // group shows complete instead of titles over spinners that then push it down (M11 §5.2). Until
  // then the previous group stays; when the dialog opens, the pane is empty.
  const queryClient = useQueryClient()
  const modules = useModules()
  const [shown, setShown] = useState<Shown | undefined>(undefined)
  const wantedKey = path.pending || !current ? undefined : `${paneKey}:${current.id}`
  const showWanted = useEffectEvent((key: string) => {
    if (!current) return undefined
    const next: Shown = {
      key,
      level,
      scope,
      scopeId: scopeIdAt(level, path),
      group: current.id,
    }
    let live = true
    void sectionsReady(current.sections, scope, queryClient, modules).then(() => {
      if (live) setShown(next)
    })
    return () => {
      live = false
    }
  })
  useEffect(() => (wantedKey === undefined ? undefined : showWanted(wantedKey)), [wantedKey])
  // A group of a course, term or Program that is gone (deleted here) is not kept up.
  const kept = shown && scopeIdAt(shown.level, path) === shown.scopeId ? shown : undefined

  // Once a group shows, the code of the level's other groups loads in an idle moment; their data
  // loads when the group's button is hovered or focused, like a page's on a link (M11 §5.2).
  const preloadOthers = useEffectEvent(() => {
    for (const group of groups)
      for (const section of group.sections) void preload(section.component)
  })
  const shownPane = shown ? `${shown.level}:${shown.scopeId ?? ''}` : undefined
  useEffect(() => (shownPane === undefined ? undefined : whenIdle(preloadOthers)), [shownPane])
  const prepare = (group: NavGroup) =>
    void loadSections(group.sections, scope, queryClient, modules)

  // Jump to `#section` when the dialog opens with a hash or the group changes.
  const shownGroupKey = kept?.key
  useEffect(() => {
    if (hash && shownGroupKey !== undefined) document.getElementById(hash)?.scrollIntoView()
  }, [hash, shownGroupKey])

  return (
    <>
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <DialogDescription className="sr-only">{m.settings_dialog_description()}</DialogDescription>
      <SidebarProvider
        className="h-full min-h-0 items-start"
        style={{ '--sidebar-width': '15rem' } as CSSProperties}
      >
        <Sidebar collapsible="none" className="hidden border-r md:flex">
          <SidebarHeader className="px-3 pt-3 pb-0">
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <SidebarInput
                type="search"
                aria-label={m.settings_search_label()}
                placeholder={m.settings_search_label()}
                className="pl-8"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={clearOnEscape}
              />
            </div>
          </SidebarHeader>
          <SidebarContent>
            <ScopePath path={path} onSelect={goTo} />
            {/* The Separator's `data-horizontal:w-full` outranks SidebarSeparator's `w-auto`, so with
                side margins it ends up wider than the column and the sidebar scrolls sideways. */}
            <SidebarSeparator className="mx-3 data-horizontal:w-auto" />
            <nav aria-label={m.settings_title()}>
              {navRuns.map((run) => (
                <SidebarGroup key={run.cluster ?? 'all'}>
                  {run.cluster ? (
                    <SidebarGroupLabel>{CLUSTER_TITLES[run.cluster]()}</SidebarGroupLabel>
                  ) : null}
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {run.groups.map((group) => {
                        const Icon = GROUP_ICONS[group.id]
                        const active = !searching && group.id === current?.id
                        return (
                          <SidebarMenuItem key={group.id}>
                            <SidebarMenuButton
                              isActive={active}
                              aria-current={active ? 'page' : undefined}
                              onPointerEnter={() => prepare(group)}
                              onFocus={() => prepare(group)}
                              onClick={() => {
                                setQuery('')
                                select(group.id)
                              }}
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
                  <span className="truncate">
                    {level === 'account' && !path.pending ? m.settings_path_account() : title}
                  </span>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="max-md:hidden" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="max-md:hidden">
                    {searching
                      ? m.settings_search_results()
                      : current
                        ? GROUP_TITLES[current.id]()
                        : null}
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
            key={searching ? `${paneKey}:?` : (kept?.key ?? '')}
            className="flex flex-1 flex-col overflow-y-auto px-4 pb-8 md:px-6"
          >
            {path.pending ? null : searching ? (
              <>
                {matched?.size === 0 ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <SearchX />
                      </EmptyMedia>
                      <EmptyTitle>{m.settings_search_empty_title()}</EmptyTitle>
                      <EmptyDescription>{m.settings_search_empty_description()}</EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button variant="outline" onClick={() => setQuery('')}>
                        {m.settings_search_clear()}
                      </Button>
                    </EmptyContent>
                  </Empty>
                ) : null}
                <div ref={searchRef} className="mx-auto w-full max-w-3xl space-y-10">
                  {groups.map((group) => (
                    <div key={group.id} hidden={!group.sections.some(isHit)} className="space-y-6">
                      <p className="text-xs font-medium text-muted-foreground">
                        {GROUP_TITLES[group.id]()}
                      </p>
                      {group.sections.map((section) => (
                        <SectionFrame
                          key={section.id}
                          section={section}
                          scope={scope}
                          hidden={!isHit(section)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </>
            ) : kept ? (
              <div className="mx-auto w-full max-w-3xl">
                <SettingsSections level={kept.level} scope={kept.scope} group={kept.group} />
              </div>
            ) : current ? null : (
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
