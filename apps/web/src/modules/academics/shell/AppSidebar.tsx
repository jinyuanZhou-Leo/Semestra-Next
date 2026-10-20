import type { Program } from '@semestra/api-client'
import { useLocation } from '@tanstack/react-router'
import {
  BookOpen,
  ChevronsUpDown,
  GraduationCap,
  Library,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  MessageCircle,
  PictureInPicture2,
  Settings,
} from 'lucide-react'
import { type ReactNode, useState, useSyncExternalStore } from 'react'
import { openCommandPalette, useHostAction } from '@/app/commands'
import { useCommandContext } from '@/app/commands/context'
import { type AssistantContribution, scopePath } from '@/app/extensions'
import { formatHotkey } from '@/app/hotkeys'
import { ManagePagesDialog } from '@/app/host/ManagePagesDialog'
import { OVERVIEW_PAGE, useScopePages } from '@/app/host/nav'
import { PluginBoundary } from '@/app/host/PluginBoundary'
import { ENTRY_ACTION_ON_HOVER, GROUP_LABEL } from '@/app/host/sidebar-classes'
import { StatusBar } from '@/app/host/StatusBar'
import { useModules } from '@/app/registry'
import { useSettingsDialog } from '@/app/settings'
import { HistoryLink } from '@/components/HistoryLink'
import { cn } from '@/lib/utils'
import { SignOutDialog } from '@/modules/auth/components/SignOutDialog'
import { useAuth } from '@/modules/auth/useAuth'
import { UserAvatar } from '@/modules/auth/settings/UserAvatar'
import { m } from '@/paraglide/messages'
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
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { CreateProgramDialog } from '../components/CreateProgramDialog'
import { programPath, termsAndCoursesPath } from '../paths'
import { usePrograms } from '../queries'
import { SidebarTerms } from './SidebarTerms'

const ASSISTANT_PAGE = /\/assistant(\/|$)/

/**
 * One link of the main navigation; on the icon rail it shows its label as a tooltip. `children`
 * is the open page's own navigation, shown under it (hidden on the icon rail).
 */
function NavItem({
  href,
  icon: Icon,
  label,
  active,
  onNavigate,
  children,
}: {
  href: string
  icon: typeof BookOpen
  label: string
  active: boolean
  onNavigate: () => void
  children?: ReactNode
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
      {children}
    </SidebarMenuItem>
  )
}

/** The Program at the top: the Programs to switch between, and where a new one is created. */
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
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                tooltip={current.name}
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
              tooltip={user.display_name}
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
 * The assistant (M12): the row opens its full page; the small button on its right, shown on hover
 * or while the panel is open, opens or closes the side panel (also `Cmd/Ctrl + J`). On the full
 * page the recent conversations are listed under it. The interface tour points at the row.
 */
function AssistantNavItem({
  assistant,
  programId,
  active,
  onNavigate,
}: {
  assistant: AssistantContribution
  programId: string
  active: boolean
  onNavigate: () => void
}) {
  const open = useSyncExternalStore(assistant.panel.subscribe, assistant.panel.isOpen)
  const ctx = useCommandContext()
  const label = m.academics_nav_assistant()
  const panelLabel = open ? m.assistant_close_panel() : m.assistant_open_in_panel()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        data-tour="assistant"
        tooltip={label}
        isActive={active}
        render={
          <HistoryLink
            href={`${programPath(programId)}/assistant`}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
          />
        }
      >
        <MessageCircle aria-hidden />
        <span className="truncate">{label}</span>
      </SidebarMenuButton>
      {/* On the full page the panel is not shown, so its button would do nothing visible. */}
      {active ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <SidebarMenuAction
                aria-label={panelLabel}
                aria-pressed={open}
                className={cn(
                  ENTRY_ACTION_ON_HOVER,
                  'aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground',
                )}
                onClick={() => assistant.open(ctx)}
              />
            }
          >
            <PictureInPicture2 aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="right">
            {panelLabel} <Kbd>{formatHotkey('mod+j')}</Kbd>
          </TooltipContent>
        </Tooltip>
      )}
      {active && assistant.SidebarNav ? (
        <PluginBoundary silent>
          <assistant.SidebarNav programId={programId} onNavigate={onNavigate} />
        </PluginBoundary>
      ) : null}
    </SidebarMenuItem>
  )
}

/**
 * The left navigation of the signed-in app (M02 §5.1): the shadcn sidebar that collapses to an
 * icon rail on desktop and becomes a drawer on phones (only Today and the terms and courses).
 */
export function AppSidebar({ programId }: { programId: string }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const settings = useSettingsDialog()
  const pathname = useLocation({ select: (l) => l.pathname })
  const programs = usePrograms().data?.items ?? []
  const program = programs.find((p) => p.id === programId)
  const programScope = { kind: 'program', programId } as const
  const { pages } = useScopePages(programScope)
  const [managing, setManaging] = useState(false)
  const assistant = useModules().find((module) => module.assistant)?.assistant
  // On a term or course page the tab bar's own handler is registered later and wins.
  useHostAction('nav.manage', () => setManaging(true), !isMobile)
  // Following a link closes the drawer on phones.
  const onNavigate = () => setOpenMobile(false)

  const termsAndCoursesHref = termsAndCoursesPath(programId)

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
          {isMobile ? null : (
            <SidebarGroup className="pb-0">
              <SidebarMenu>
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
                {assistant ? (
                  <AssistantNavItem
                    assistant={assistant}
                    programId={programId}
                    active={ASSISTANT_PAGE.test(pathname)}
                    onNavigate={onNavigate}
                  />
                ) : null}
              </SidebarMenu>
            </SidebarGroup>
          )}

          <SidebarGroup>
            <SidebarGroupLabel className={GROUP_LABEL}>
              {m.academics_sidebar_pages()}
            </SidebarGroupLabel>
            {isMobile ? null : (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <DropdownMenuTrigger
                        render={<SidebarGroupAction aria-label={m.host_nav_more()} />}
                      />
                    }
                  >
                    <MoreHorizontal aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent>{m.host_nav_more()}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" side="right">
                  <DropdownMenuItem onClick={() => setManaging(true)}>
                    {m.host_nav_manage_pages()}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {pages
                  .filter((page) => !isMobile || page.id === 'today')
                  .map((page) => {
                    const href = scopePath(programScope, page.id)
                    const isOverview = page.id === OVERVIEW_PAGE
                    const active =
                      pathname === href || (isOverview && pathname === scopePath(programScope))
                    const SubNav = active && !isMobile ? page.sidebarNav : undefined
                    return (
                      <NavItem
                        key={page.id}
                        href={isOverview ? scopePath(programScope) : href}
                        icon={page.icon}
                        label={page.title()}
                        active={active}
                        onNavigate={onNavigate}
                      >
                        {SubNav ? (
                          <PluginBoundary key={page.id} silent>
                            <SubNav scope={programScope} onNavigate={onNavigate} />
                          </PluginBoundary>
                        ) : null}
                      </NavItem>
                    )
                  })}
                {isMobile ? null : (
                  <NavItem
                    href={termsAndCoursesHref}
                    icon={BookOpen}
                    label={m.academics_nav_terms_and_courses()}
                    active={pathname === termsAndCoursesHref}
                    onNavigate={onNavigate}
                  />
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarTerms programId={programId} pathname={pathname} onNavigate={onNavigate} />
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <SidebarSeparator className="mx-0" />
        <SidebarGroup className="p-0">
          {isMobile ? null : (
            <SidebarGroupLabel className={GROUP_LABEL}>
              {m.academics_sidebar_system()}
            </SidebarGroupLabel>
          )}
          <StatusBar />
          {isMobile ? null : (
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={m.settings_title()}
                  isActive={settings.target?.level === 'account'}
                  onClick={() => settings.open({ level: 'account' })}
                >
                  <Settings aria-hidden />
                  <span>{m.settings_title()}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
        </SidebarGroup>
        <SidebarMenu>
          <AccountMenu />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
      <ManagePagesDialog scope={programScope} open={managing} onOpenChange={setManaging} />
    </Sidebar>
  )
}
