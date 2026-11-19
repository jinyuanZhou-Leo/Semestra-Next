import type { Term } from '@semestra/api-client'
import { useNavigate } from '@tanstack/react-router'
import {
  BookOpen,
  CalendarDays,
  CalendarPlus,
  ChartColumn,
  Check,
  ChevronDown,
  LibraryBig,
  MoreHorizontal,
  Undo2,
} from 'lucide-react'
import { useState } from 'react'
import { useHostAction } from '@/app/commands'
import { scopePath } from '@/app/extensions'
import { ManagePagesDialogView } from '@/app/host/ManagePagesDialog'
import { GROUP_LABEL } from '@/app/host/sidebar-classes'
import { HistoryLink } from '@/components/HistoryLink'
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
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from '@/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { courseColor, courseLabel } from '../color'
import { coursePath, newTermPath, termPath, termsAndCoursesPath } from '../paths'
import { useCourses } from '../queries'
import { useViewedTerm } from '../viewing-term'
import { useCourseLinkTab } from './course-tab'
import { TermWeekLine } from './ScopeView'
import { isSidebarPageActive, SUMMARY_PAGE, useSidebarPages } from './sidebar-pages'

const TERM_PAGE_ID = /^\/p\/[^/]+\/t\/[^/]+\/([^/?#]+)/

/** The same page in another term on a term page; elsewhere that term's overview. */
function termHref(programId: string, termId: string, pathname: string) {
  return termPath(programId, termId, TERM_PAGE_ID.exec(pathname)?.[1])
}

function Entry({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string
  icon: typeof BookOpen
  label: string
  active: boolean
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={label}
        isActive={active}
        render={<HistoryLink href={href} aria-current={active ? 'page' : undefined} />}
      >
        <Icon aria-hidden />
        <span className="truncate">{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/**
 * The name of the term the sidebar shows, as the label of its pages; it opens the list of terms.
 * Choosing one opens the same page there (or its overview), and the sidebar stays on that term.
 */
function TermSwitcher({
  programId,
  pathname,
  term,
  current,
  terms,
}: {
  programId: string
  pathname: string
  term: Term
  current: Term | undefined
  terms: readonly Term[]
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarGroupLabel
            // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by its children
            render={<button type="button" data-tour="term" />}
            className="w-fit max-w-[calc(100%-2rem)] cursor-pointer gap-1 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-expanded:bg-sidebar-accent group-data-[collapsible=icon]:pointer-events-none"
          />
        }
      >
        <span className="truncate">
          {term.name}
          {term.id === current?.id ? (
            <span className="text-sidebar-foreground/50">
              <TermWeekLine term={term} />
            </span>
          ) : null}
        </span>
        <ChevronDown aria-hidden className="size-3.5!" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-96 w-60" align="start" side="bottom">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {m.academics_sidebar_view_term()}
          </DropdownMenuLabel>
          {terms.toReversed().map((t) => (
            <DropdownMenuItem
              key={t.id}
              render={<HistoryLink href={termHref(programId, t.id, pathname)} />}
              aria-current={t.id === term.id ? 'true' : undefined}
            >
              <CalendarDays aria-hidden />
              <span className="truncate">{t.name}</span>
              {t.id === current?.id ? (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {m.academics_sidebar_current_badge()}
                </span>
              ) : null}
              {t.id === term.id ? (
                <Check aria-hidden className={t.id === current?.id ? '' : 'ml-auto'} />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<HistoryLink href={termsAndCoursesPath(programId)} />}>
          <BookOpen aria-hidden />
          {m.academics_sidebar_all_terms()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Back from another term to the current one: on a term page to the same page there, on a course
 * page to the current term's overview (the page opened then forgets the other term itself).
 */
function BackToCurrent({
  programId,
  pathname,
  current,
  onBack,
}: {
  programId: string
  pathname: string
  current: Term
  onBack: () => void
}) {
  const navigate = useNavigate()
  const onScopePage = /^\/p\/[^/]+\/[tc]\//.test(pathname)
  const label = m.academics_sidebar_back_to_current({ name: current.name })
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarGroupAction
            aria-label={label}
            onClick={() => {
              if (onScopePage) void navigate({ href: termHref(programId, current.id, pathname) })
              else onBack()
            }}
          />
        }
      >
        <Undo2 aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function PagesMenu({ onManage }: { onManage: () => void }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger render={<SidebarGroupAction aria-label={m.host_nav_more()} />} />
          }
        >
          <MoreHorizontal aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.host_nav_more()}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="right">
        <DropdownMenuItem onClick={onManage}>{m.host_nav_manage_pages()}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The courses of the term the sidebar shows. On the icon rail they fold into one "Courses" entry
 * whose menu (on hover or click) lists them, so a course is still one step away.
 */
function TermCourses({
  programId,
  term,
  pathname,
}: {
  programId: string
  term: Term
  pathname: string
}) {
  const courses = useCourses(programId, term.id).data?.items
  const tabOf = useCourseLinkTab(programId, courses?.map((c) => c.id) ?? [])
  const { state } = useSidebar()
  const isActive = (courseId: string) => {
    const href = coursePath(programId, courseId)
    return pathname === href || pathname.startsWith(`${href}/`)
  }
  const hrefOf = (courseId: string) => coursePath(programId, courseId, tabOf(courseId), term.id)

  if (state === 'collapsed') {
    const anyActive = (courses ?? []).some((course) => isActive(course.id))
    return (
      <>
        {/* Stands in for the hidden "Courses" label. The Separator's `data-horizontal:w-full`
            outranks SidebarSeparator's `w-auto`, so the margins need `w-auto` here too. */}
        <SidebarSeparator className="mx-3 data-horizontal:w-auto" />
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    openOnHover
                    delay={80}
                    render={
                      <SidebarMenuButton
                        isActive={anyActive}
                        aria-label={m.academics_sidebar_courses()}
                      />
                    }
                  >
                    <LibraryBig aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="start" className="max-h-96 w-60">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="truncate text-xs text-muted-foreground">
                        {term.name}
                      </DropdownMenuLabel>
                      {courses && courses.length === 0 ? (
                        <DropdownMenuItem disabled>
                          {m.academics_term_no_courses()}
                        </DropdownMenuItem>
                      ) : null}
                      {(courses ?? []).map((course) => {
                        const active = isActive(course.id)
                        return (
                          <DropdownMenuItem
                            key={course.id}
                            render={
                              <HistoryLink
                                href={hrefOf(course.id)}
                                aria-current={active ? 'page' : undefined}
                              />
                            }
                          >
                            <span
                              aria-hidden
                              className="mx-1 size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: courseColor(course) }}
                            />
                            <span className="truncate">{courseLabel(course)}</span>
                            {active ? <Check aria-hidden className="ml-auto" /> : null}
                          </DropdownMenuItem>
                        )
                      })}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </>
    )
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel className={GROUP_LABEL}>{m.academics_sidebar_courses()}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {courses && courses.length === 0 ? (
            <SidebarMenuItem>
              <span className="block px-3 py-1.5 text-xs text-muted-foreground">
                {m.academics_term_no_courses()}
              </span>
            </SidebarMenuItem>
          ) : null}
          {(courses ?? []).map((course) => {
            const active = isActive(course.id)
            return (
              <SidebarMenuItem key={course.id}>
                <SidebarMenuButton
                  isActive={active}
                  tooltip={course.title}
                  render={
                    <HistoryLink
                      href={hrefOf(course.id)}
                      aria-current={active ? 'page' : undefined}
                    />
                  }
                >
                  <span
                    aria-hidden
                    className="ml-1 size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: courseColor(course) }}
                  />
                  <span className="truncate">{courseLabel(course)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/**
 * The sidebar's working area (M02 §5.1): the pages of the term the user works in (the current
 * term, or another one until they go back) together with the Program's pages, then that term's
 * courses. The term's name above them switches the term.
 */
export function SidebarWork({ programId, pathname }: { programId: string; pathname: string }) {
  const { term, current, terms, loaded, isOther, backToCurrent } = useViewedTerm(
    programId,
    pathname,
  )
  const { all, shown, hidden, save } = useSidebarPages(programId, term?.id)
  const [managing, setManaging] = useState(false)
  // On a course page the tab bar's own handler is registered later and wins.
  useHostAction('nav.manage', () => setManaging(true))

  return (
    <>
      <SidebarGroup>
        {term ? (
          <TermSwitcher
            programId={programId}
            pathname={pathname}
            term={term}
            current={current}
            terms={terms}
          />
        ) : (
          <SidebarGroupLabel className={GROUP_LABEL}>
            {m.academics_sidebar_pages()}
          </SidebarGroupLabel>
        )}
        {isOther && current ? (
          <BackToCurrent
            programId={programId}
            pathname={pathname}
            current={current}
            onBack={backToCurrent}
          />
        ) : (
          <PagesMenu onManage={() => setManaging(true)} />
        )}
        <SidebarGroupContent>
          <SidebarMenu>
            {shown.map((entry) => (
              <Entry
                key={entry.id}
                href={entry.href}
                icon={entry.page.icon}
                label={entry.page.title()}
                active={isSidebarPageActive(entry, pathname)}
              />
            ))}
            {loaded && terms.length === 0 ? (
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={m.academics_term_new()}
                  render={<HistoryLink href={newTermPath(programId)} />}
                >
                  <CalendarPlus aria-hidden />
                  <span className="truncate">{m.academics_term_new()}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {term ? <TermCourses programId={programId} term={term} pathname={pathname} /> : null}
      <ManagePagesDialogView
        pages={all.map((entry) => entry.page)}
        hidden={hidden}
        onSave={save}
        description={m.host_nav_applies_sidebar()}
        open={managing}
        onOpenChange={setManaging}
      />
    </>
  )
}

/** The bottom of the sidebar: the whole Program's summary, and all terms and courses. */
export function SidebarProgramLinks({
  programId,
  pathname,
}: {
  programId: string
  pathname: string
}) {
  const summaryHref = scopePath({ kind: 'program', programId }, SUMMARY_PAGE)
  const academicsHref = termsAndCoursesPath(programId)
  return (
    <SidebarGroup className="mt-auto">
      <SidebarGroupContent>
        <SidebarMenu>
          <Entry
            href={summaryHref}
            icon={ChartColumn}
            label={m.academics_nav_summary()}
            active={pathname === summaryHref}
          />
          <Entry
            href={academicsHref}
            icon={BookOpen}
            label={m.academics_nav_terms_and_courses()}
            active={pathname === academicsHref}
          />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
