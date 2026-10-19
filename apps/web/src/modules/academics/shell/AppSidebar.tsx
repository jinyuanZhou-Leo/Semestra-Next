import type { Program, Term } from '@semestra/api-client'
import { useLocation } from '@tanstack/react-router'
import {
  BookOpen,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  ChevronsUpDown,
  GraduationCap,
  Library,
  LogOut,
  MoreHorizontal,
  Plus,
  Repeat,
  Search,
  Settings,
  Sun,
  Trash2,
} from 'lucide-react'
import { type MouseEvent, useState } from 'react'
import { openCommandPalette } from '@/app/commands'
import { scopePath } from '@/app/extensions'
import { formatHotkey } from '@/app/hotkeys'
import { usePages } from '@/app/registry'
import { StatusBar } from '@/app/host/StatusBar'
import { useUiPref } from '@/app/ui-pref'
import { HistoryLink } from '@/components/HistoryLink'
import { SignOutDialog } from '@/modules/auth/components/SignOutDialog'
import { useAuth } from '@/modules/auth/useAuth'
import { UserAvatar } from '@/modules/auth/settings/UserAvatar'
import { m } from '@/paraglide/messages'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Kbd } from '@/ui/kbd'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/ui/sidebar'
import { courseColor, courseLabel } from '../color'
import { CreateProgramDialog } from '../components/CreateProgramDialog'
import { DeleteTermDialog } from '../components/DeleteTermDialog'
import { allCoursesPath, coursePath, newTermPath, programPath, termPath } from '../paths'
import { useCourses, usePrograms, useTerms } from '../queries'

/** One link of the main navigation; on the icon rail it shows its label as a tooltip. */
function NavItem({
  href,
  icon: Icon,
  label,
  active,
  onNavigate,
}: {
  href: string
  icon: typeof BookOpen
  label: string
  active: boolean
  onNavigate: () => void
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={label}
        isActive={active}
        render={
          <HistoryLink
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
          />
        }
      >
        <Icon aria-hidden />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/** The Program at the top: a switcher with several Programs, a link to its overview with one. */
function ProgramHeader({ programs, current }: { programs: Program[]; current: Program }) {
  const { isMobile } = useSidebar()
  const [creating, setCreating] = useState(false)
  const face = (
    <>
      <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
        <GraduationCap aria-hidden className="size-4" />
      </div>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-heading font-semibold">{current.name}</span>
        {current.institution ? (
          <span className="truncate text-xs">{current.institution}</span>
        ) : null}
      </div>
    </>
  )
  if (programs.length < 2) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            tooltip={current.name}
            render={<HistoryLink href={programPath(current.id)} />}
          >
            {face}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                aria-label={m.academics_switch_program()}
              />
            }
          >
            {face}
            <ChevronsUpDown aria-hidden className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-64"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {m.academics_programs()}
              </DropdownMenuLabel>
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
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <CreateProgramDialog open={creating} onOpenChange={setCreating} />
    </SidebarMenu>
  )
}

function TermCourses({
  programId,
  term,
  pathname,
  onNavigate,
}: {
  programId: string
  term: Term
  pathname: string
  onNavigate: () => void
}) {
  const courses = useCourses(programId, term.id).data?.items
  return (
    <SidebarMenuSub>
      {courses && courses.length === 0 ? (
        <SidebarMenuSubItem>
          <span className="block px-3 py-1 text-xs text-muted-foreground">
            {m.academics_term_no_courses()}
          </span>
        </SidebarMenuSubItem>
      ) : null}
      {(courses ?? []).map((course) => {
        const courseHref = coursePath(programId, course.id)
        const courseActive = pathname === courseHref || pathname.startsWith(`${courseHref}/`)
        return (
          <SidebarMenuSubItem key={course.id}>
            <SidebarMenuSubButton
              isActive={courseActive}
              title={course.title}
              render={
                <HistoryLink
                  href={coursePath(programId, course.id, undefined, term.id)}
                  onClick={onNavigate}
                  aria-current={courseActive ? 'page' : undefined}
                />
              }
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
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        )
      })}
    </SidebarMenuSub>
  )
}

function TermItem({
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
  onToggle: (next: boolean) => void
  pathname: string
  onNavigate: () => void
}) {
  const { isMobile } = useSidebar()
  const [deleting, setDeleting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const href = termPath(programId, term.id)
  const active = pathname === href || pathname.startsWith(`${href}/`)
  return (
    <Collapsible
      open={expanded}
      onOpenChange={onToggle}
      className="group/collapsible"
      render={
        <SidebarMenuItem
          onContextMenu={(event: MouseEvent) => {
            event.preventDefault()
            setMenuOpen(true)
          }}
        />
      }
    >
      <SidebarMenuButton
        isActive={active}
        tooltip={term.name}
        className="group-has-data-[sidebar=menu-action]/menu-item:pr-14"
        render={
          <HistoryLink
            href={href}
            onClick={onNavigate}
            aria-current={pathname === href ? 'page' : undefined}
          />
        }
      >
        <CalendarDays aria-hidden />
        <span className="truncate">{term.name}</span>
        {term.is_current ? (
          <span className="shrink-0 rounded-4xl bg-primary/10 px-1.5 text-[0.625rem] font-medium text-primary">
            {m.academics_term_current_badge()}
          </span>
        ) : null}
      </SidebarMenuButton>
      <CollapsibleTrigger
        render={
          <SidebarMenuAction
            aria-label={expanded ? m.academics_collapse_term() : m.academics_expand_term()}
          />
        }
      >
        <ChevronRight
          aria-hidden
          className="transition-transform duration-200 group-data-open/collapsible:rotate-90 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction
              showOnHover
              className="right-7 aria-expanded:bg-muted"
              aria-label={m.academics_term_menu({ name: term.name })}
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={isMobile ? 'bottom' : 'right'}
          align={isMobile ? 'end' : 'start'}
        >
          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden />
            {m.academics_term_delete()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CollapsibleContent>
        <TermCourses
          programId={programId}
          term={term}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      </CollapsibleContent>
      <DeleteTermDialog term={term} open={deleting} onOpenChange={setDeleting} />
    </Collapsible>
  )
}

function AccountMenu() {
  const { isMobile } = useSidebar()
  const { user } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  if (!user) return null
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton
              size="lg"
              className="aria-expanded:bg-muted"
              aria-label={m.academics_account_menu()}
            />
          }
        >
          <UserAvatar name={user.display_name} src={user.avatar_url} />
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{user.display_name}</span>
            <span className="truncate text-xs">{user.email}</span>
          </div>
          <ChevronsUpDown aria-hidden className="ml-auto" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-56"
          side={isMobile ? 'bottom' : 'right'}
          align="end"
          sideOffset={4}
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="grid text-sm leading-tight font-normal">
              <span className="truncate font-medium text-foreground">{user.display_name}</span>
              <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setSigningOut(true)}>
            <LogOut aria-hidden />
            {m.home_sign_out()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SignOutDialog open={signingOut} onOpenChange={setSigningOut} />
    </SidebarMenuItem>
  )
}

/**
 * The left navigation of the signed-in app (M02 §5.1): the shadcn sidebar that collapses to an
 * icon rail on desktop and becomes a drawer on phones (only Today and the terms and courses).
 */
export function AppSidebar({ programId }: { programId: string }) {
  const { isMobile, setOpenMobile } = useSidebar()
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
  const toggleTerm = (termId: string, next?: boolean) =>
    setExpanded(
      (next ?? !open.includes(termId))
        ? open.includes(termId)
          ? open
          : [...open, termId]
        : open.filter((id) => id !== termId),
    )
  // Following a link closes the drawer on phones.
  const onNavigate = () => setOpenMobile(false)

  const todayHref = scopePath(programScope, 'today')
  const allCoursesHref = allCoursesPath(programId)

  return (
    <Sidebar collapsible="icon" data-tour="sidebar">
      <SidebarHeader>
        {program ? <ProgramHeader programs={programs} current={program} /> : null}
      </SidebarHeader>
      <SidebarContent>
        <nav
          aria-label={m.academics_sidebar_label()}
          className="flex min-h-0 flex-1 flex-col gap-2"
        >
          <SidebarGroup>
            <SidebarMenu>
              {isMobile ? null : (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    data-tour="command-palette"
                    tooltip={`${m.commands_open()} (${formatHotkey('mod+k')})`}
                    onClick={() => openCommandPalette()}
                  >
                    <Search aria-hidden />
                    <span className="truncate">{m.commands_open()}</span>
                    <Kbd className="ml-auto group-data-[collapsible=icon]:hidden">
                      {formatHotkey('mod+k')}
                    </Kbd>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {todayPage ? (
                <NavItem
                  href={todayHref}
                  icon={Sun}
                  label={todayPage.title()}
                  active={pathname === todayHref}
                  onNavigate={onNavigate}
                />
              ) : null}
              {isMobile ? null : (
                <NavItem
                  href={allCoursesHref}
                  icon={BookOpen}
                  label={m.academics_nav_all_courses()}
                  active={pathname === allCoursesHref}
                  onNavigate={onNavigate}
                />
              )}
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>{m.academics_terms()}</SidebarGroupLabel>
            {isMobile ? null : (
              <SidebarGroupAction
                title={m.academics_term_new()}
                aria-label={m.academics_term_new()}
                render={<HistoryLink href={newTermPath(programId)} />}
              >
                <CalendarPlus aria-hidden />
              </SidebarGroupAction>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {(terms ?? []).map((term) => (
                  <TermItem
                    key={term.id}
                    programId={programId}
                    term={term}
                    expanded={open.includes(term.id)}
                    onToggle={(next) => toggleTerm(term.id, next)}
                    pathname={pathname}
                    onNavigate={onNavigate}
                  />
                ))}
                {terms && terms.length === 0 ? (
                  <SidebarMenuItem>
                    <span className="block px-3 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                      {m.academics_terms_empty()}
                    </span>
                  </SidebarMenuItem>
                ) : null}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <SidebarSeparator className="mx-0" />
        <SidebarGroup className="p-0">
          {isMobile ? null : <SidebarGroupLabel>{m.academics_sidebar_system()}</SidebarGroupLabel>}
          <StatusBar />
          {isMobile ? null : (
            <SidebarMenu>
              <NavItem
                href="/settings/account"
                icon={Settings}
                label={m.settings_title()}
                active={pathname.startsWith('/settings')}
                onNavigate={onNavigate}
              />
            </SidebarMenu>
          )}
        </SidebarGroup>
        <SidebarMenu>
          <AccountMenu />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
