import type { Program, Term } from '@semestra/api-client'
import { useLocation } from '@tanstack/react-router'
import {
  BookOpen,
  CalendarPlus,
  ChevronRight,
  ChevronsUpDown,
  LayoutDashboard,
  Library,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  Repeat,
  Search,
  Settings,
  Sun,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { openCommandPalette } from '@/app/commands'
import { scopePath, scopeSettingsPath } from '@/app/extensions'
import { formatHotkey } from '@/app/hotkeys'
import { usePages } from '@/app/registry'
import { StatusBar } from '@/app/host/StatusBar'
import { useUiPref } from '@/app/ui-pref'
import { HistoryLink } from '@/components/HistoryLink'
import { cn } from '@/lib/utils'
import { useAuth } from '@/modules/auth/useAuth'
import { UserAvatar } from '@/modules/auth/settings/UserAvatar'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Kbd } from '@/ui/kbd'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { courseColor, courseLabel } from '../color'
import { CreateProgramDialog } from '../components/CreateProgramDialog'
import { DeleteTermDialog } from '../components/DeleteTermDialog'
import { allCoursesPath, coursePath, newTermPath, programPath, termPath } from '../paths'
import { usePins } from '../pins'
import { useCourses, usePrograms, useTerms } from '../queries'

type Props = {
  programId: string
  /** Icon rail instead of the full sidebar (desktop only). */
  collapsed?: boolean
  onToggleCollapsed?: () => void
  /** The drawer on phones: only today and the term/course navigation (M02 §5.1). */
  drawer?: boolean
  /** Called after following a link (closes the drawer). */
  onNavigate?: () => void
}

function NavLink({
  href,
  icon: Icon,
  label,
  active,
  collapsed,
  onNavigate,
}: {
  href: string
  icon: typeof BookOpen
  label: string
  active: boolean
  collapsed?: boolean
  onNavigate?: () => void
}) {
  return (
    <HistoryLink
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm',
        collapsed && 'justify-center',
        active
          ? 'bg-muted font-medium text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {collapsed ? null : <span className="truncate">{label}</span>}
    </HistoryLink>
  )
}

function ProgramSwitcher({ programs, current }: { programs: Program[]; current: Program }) {
  const [creating, setCreating] = useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              className="h-auto w-full justify-between px-2 py-1.5 text-left"
              aria-label={m.academics_switch_program()}
            />
          }
        >
          <span className="min-w-0">
            <span className="block truncate font-heading text-sm font-semibold">
              {current.name}
            </span>
            {current.institution ? (
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {current.institution}
              </span>
            ) : null}
          </span>
          <ChevronsUpDown aria-hidden className="size-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{m.academics_programs()}</DropdownMenuLabel>
            {programs.map((p) => (
              <DropdownMenuItem
                key={p.id}
                render={<HistoryLink href={programPath(p.id)} />}
                aria-current={p.id === current.id ? 'true' : undefined}
              >
                <Library aria-hidden />
                <span className="truncate">{p.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {m.academics_program_new()}
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <HistoryLink
                href={scopeSettingsPath({ kind: 'program', programId: current.id }, 'general')}
              />
            }
          >
            <Settings aria-hidden />
            {m.academics_program_manage()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateProgramDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

function TermCourses({
  programId,
  term,
  pathname,
  onNavigate,
  panelId,
}: {
  programId: string
  term: Term
  pathname: string
  onNavigate?: () => void
  panelId: string
}) {
  const courses = useCourses(programId, term.id).data?.items
  return (
    <ul id={panelId} className="mt-0.5 mb-1 ml-5 space-y-0.5 border-l border-border pl-2">
      {courses && courses.length === 0 ? (
        <li className="px-2 py-1 text-xs text-muted-foreground">{m.academics_term_no_courses()}</li>
      ) : null}
      {(courses ?? []).map((course) => {
        const courseHref = coursePath(programId, course.id)
        const courseActive = pathname === courseHref || pathname.startsWith(`${courseHref}/`)
        return (
          <li key={course.id}>
            <HistoryLink
              href={coursePath(programId, course.id, undefined, term.id)}
              onClick={onNavigate}
              aria-current={courseActive ? 'page' : undefined}
              title={course.title}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2 py-1 text-sm',
                courseActive
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: courseColor(course) }}
              />
              <span className="truncate">{courseLabel(course)}</span>
              {course.term_ids.length > 1 ? (
                <Repeat
                  aria-label={m.academics_course_year_long()}
                  className="ml-auto size-3 shrink-0"
                />
              ) : null}
            </HistoryLink>
          </li>
        )
      })}
    </ul>
  )
}

function TermGroup({
  programId,
  term,
  expanded,
  onToggle,
  pathname,
  onNavigate,
}: {
  programId: string
  term: Term
  expanded: boolean
  onToggle: () => void
  pathname: string
  onNavigate?: () => void
}) {
  const { isPinned, toggle } = usePins(programId)
  const [deleting, setDeleting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const href = termPath(programId, term.id)
  const active = pathname === href || pathname.startsWith(`${href}/`)
  const pin = { kind: 'term', id: term.id } as const
  const panelId = `sidebar-term-${term.id}`
  return (
    <li>
      <div
        onContextMenu={(event) => {
          event.preventDefault()
          setMenuOpen(true)
        }}
        className={cn(
          'group flex items-center gap-0.5 rounded-xl pr-1',
          active ? 'bg-muted' : 'hover:bg-muted',
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={expanded ? m.academics_collapse_term() : m.academics_expand_term()}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
        >
          <ChevronRight
            aria-hidden
            className={cn('size-4 transition-transform motion-reduce:transition-none', {
              'rotate-90': expanded,
            })}
          />
        </button>
        <HistoryLink
          href={href}
          onClick={onNavigate}
          aria-current={pathname === href ? 'page' : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm',
            active ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <span className="truncate">{term.name}</span>
          {term.is_current ? (
            <span className="shrink-0 rounded-4xl bg-primary/10 px-1.5 text-[0.625rem] font-medium text-primary">
              {m.academics_term_current_badge()}
            </span>
          ) : null}
        </HistoryLink>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                aria-label={m.academics_term_menu({ name: term.name })}
              />
            }
          >
            <MoreHorizontal aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              render={
                <HistoryLink
                  href={scopeSettingsPath({ kind: 'term', programId, termId: term.id }, 'general')}
                />
              }
            >
              <Settings aria-hidden />
              {m.academics_term_settings()}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggle(pin)}>
              {isPinned(pin) ? <PinOff aria-hidden /> : <Pin aria-hidden />}
              {isPinned(pin) ? m.academics_unpin() : m.academics_pin()}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
              <Trash2 aria-hidden />
              {m.academics_term_delete()}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {expanded ? (
        <TermCourses
          programId={programId}
          term={term}
          pathname={pathname}
          onNavigate={onNavigate}
          panelId={panelId}
        />
      ) : null}
      <DeleteTermDialog term={term} open={deleting} onOpenChange={setDeleting} />
    </li>
  )
}

function AccountMenu({ collapsed }: { collapsed?: boolean }) {
  const { user, signOut } = useAuth()
  const [creating, setCreating] = useState(false)
  if (!user) return null
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              className={cn(
                'h-auto w-full justify-start gap-2 px-2 py-1.5',
                collapsed && 'justify-center',
              )}
              aria-label={m.academics_account_menu()}
            />
          }
        >
          <UserAvatar name={user.display_name} src={user.avatar_url} size="sm" />
          {collapsed ? null : <span className="truncate text-sm">{user.display_name}</span>}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" className="w-56">
          <DropdownMenuItem render={<HistoryLink href="/settings/account" />}>
            <Settings aria-hidden />
            {m.academics_account_settings()}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {m.academics_program_new()}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void signOut()}>
            <LogOut aria-hidden />
            {m.home_sign_out()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateProgramDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

/** The left navigation of the signed-in app (M02 §5.1). */
export function Sidebar({ programId, collapsed, onToggleCollapsed, drawer, onNavigate }: Props) {
  const pathname = useLocation({ select: (l) => l.pathname })
  const programs = usePrograms().data?.items ?? []
  const program = programs.find((p) => p.id === programId)
  const terms = useTerms(programId).data?.items
  const programScope = { kind: 'program', programId } as const
  const todayPage = usePages(programScope).find((p) => p.id === 'today')
  const current = terms?.find((t) => t.is_current)
  const [expanded, setExpanded] = useUiPref<string[] | null>('academics.sidebar_expanded', null, {
    scope: programId,
  })
  const open = expanded ?? (current ? [current.id] : [])
  const toggleTerm = (termId: string) =>
    setExpanded(open.includes(termId) ? open.filter((id) => id !== termId) : [...open, termId])

  const overviewHref = programPath(programId)
  const settingsHref = '/settings/account'

  if (collapsed && !drawer) {
    return (
      <nav
        aria-label={m.academics_sidebar_label()}
        data-tour="sidebar"
        className="flex h-full w-14 flex-col items-center gap-1 border-r border-border bg-sidebar px-2 py-3"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleCollapsed}
          aria-label={m.academics_sidebar_expand()}
        >
          <PanelLeftOpen aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          data-tour="command-palette"
          onClick={() => openCommandPalette()}
          aria-label={m.commands_open()}
          title={`${m.commands_open()} (${formatHotkey('mod+k')})`}
        >
          <Search aria-hidden />
        </Button>
        <div className="mt-2 flex w-full flex-col gap-1">
          <NavLink
            collapsed
            href={overviewHref}
            icon={LayoutDashboard}
            label={m.academics_nav_overview()}
            active={pathname === overviewHref}
          />
          {todayPage ? (
            <NavLink
              collapsed
              href={scopePath(programScope, 'today')}
              icon={Sun}
              label={todayPage.title()}
              active={pathname === scopePath(programScope, 'today')}
            />
          ) : null}
          <NavLink
            collapsed
            href={allCoursesPath(programId)}
            icon={BookOpen}
            label={m.academics_nav_all_courses()}
            active={pathname === allCoursesPath(programId)}
          />
        </div>
        <div className="mt-auto flex w-full flex-col gap-1">
          <StatusBar collapsed />
          <NavLink
            collapsed
            href={settingsHref}
            icon={Settings}
            label={m.settings_title()}
            active={pathname.startsWith('/settings')}
          />
          <AccountMenu collapsed />
        </div>
      </nav>
    )
  }

  return (
    <nav
      aria-label={m.academics_sidebar_label()}
      data-tour="sidebar"
      className={cn(
        'flex h-full flex-col gap-3 overflow-hidden bg-sidebar px-3 py-3',
        drawer ? 'w-full' : 'w-64 border-r border-border',
      )}
    >
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          {program && programs.length > 1 ? (
            <ProgramSwitcher programs={programs} current={program} />
          ) : (
            <p className="truncate px-2 py-1.5 font-heading text-sm font-semibold">
              {program?.name ?? ''}
            </p>
          )}
        </div>
        {drawer ? null : (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleCollapsed}
            aria-label={m.academics_sidebar_collapse()}
          >
            <PanelLeftClose aria-hidden />
          </Button>
        )}
      </div>

      {drawer ? null : (
        <button
          type="button"
          data-tour="command-palette"
          onClick={() => openCommandPalette()}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground ring-1 ring-foreground/10 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Search aria-hidden className="size-4" />
          <span className="flex-1 truncate text-left">{m.commands_open()}</span>
          <Kbd>{formatHotkey('mod+k')}</Kbd>
        </button>
      )}

      <div className="space-y-0.5">
        {drawer ? null : (
          <NavLink
            href={overviewHref}
            icon={LayoutDashboard}
            label={m.academics_nav_overview()}
            active={pathname === overviewHref || pathname === `${overviewHref}/overview`}
            onNavigate={onNavigate}
          />
        )}
        {todayPage ? (
          <NavLink
            href={scopePath(programScope, 'today')}
            icon={Sun}
            label={todayPage.title()}
            active={pathname === scopePath(programScope, 'today')}
            onNavigate={onNavigate}
          />
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between px-2 pb-1">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {m.academics_terms()}
          </h2>
          {drawer ? null : (
            <HistoryLink
              href={newTermPath(programId)}
              aria-label={m.academics_term_new()}
              title={m.academics_term_new()}
              className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <CalendarPlus aria-hidden className="size-4" />
            </HistoryLink>
          )}
        </div>
        <ul className="space-y-0.5">
          {(terms ?? []).map((term) => (
            <TermGroup
              key={term.id}
              programId={programId}
              term={term}
              expanded={open.includes(term.id)}
              onToggle={() => toggleTerm(term.id)}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
        {terms && terms.length === 0 ? (
          <HistoryLink
            href={newTermPath(programId)}
            className="mx-2 block py-1 text-sm text-primary hover:underline"
          >
            {m.academics_term_new()}
          </HistoryLink>
        ) : null}
        {drawer ? null : (
          <div className="mt-2">
            <NavLink
              href={allCoursesPath(programId)}
              icon={BookOpen}
              label={m.academics_nav_all_courses()}
              active={pathname === allCoursesPath(programId)}
              onNavigate={onNavigate}
            />
          </div>
        )}
      </div>

      <div className="space-y-1 border-t border-border pt-2">
        <StatusBar />
        {drawer ? null : (
          <NavLink
            href={settingsHref}
            icon={Settings}
            label={m.settings_title()}
            active={pathname.startsWith('/settings')}
          />
        )}
        <AccountMenu />
      </div>
    </nav>
  )
}
