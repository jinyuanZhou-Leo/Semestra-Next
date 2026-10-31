import type { Course, Program, Term } from '@semestra/api-client'
import { ChevronDown, Pin, PinOff, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Scope } from '@/app/extensions'
import { PageHeader } from '@/app/host/PageHeader'
import { ScopeNav } from '@/app/host/ScopeNav'
import { useSettingsDialog } from '@/app/settings/use-settings-dialog'
import { HistoryLink } from '@/components/HistoryLink'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { courseColor, courseLabel } from '../color'
import { coursePath, termPath, termsAndCoursesPath } from '../paths'
import { usePins } from '../pins'
import { modifierKey } from './hotkeys'

type Sibling = { id: string; label: string; href: string; dot?: string; shortcut?: string }

/** A button that jumps to a sibling (another term, another course of the term). */
function SiblingMenu({
  siblings,
  activeId,
  menuLabel,
}: {
  siblings: Sibling[]
  activeId?: string
  menuLabel: string
}) {
  if (siblings.length < 2) return null
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-xs" aria-label={menuLabel} />}
            />
          }
        >
          <ChevronDown aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{menuLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className="max-h-80 w-60 overflow-y-auto">
        {siblings.map((s) => (
          <DropdownMenuItem
            key={s.id}
            render={<HistoryLink href={s.href} />}
            aria-current={s.id === activeId ? 'true' : undefined}
            className={cn(s.id === activeId && 'font-medium')}
          >
            {s.dot ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.dot }}
              />
            ) : null}
            <span className="truncate">{s.label}</span>
            {s.shortcut ? <DropdownMenuShortcut>{s.shortcut}</DropdownMenuShortcut> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Crumb({
  label,
  href,
  siblings,
  activeId,
  menuLabel,
}: {
  label: string
  href: string
  siblings?: Sibling[]
  activeId?: string
  menuLabel?: string
}) {
  return (
    <li className="flex min-w-0 items-center">
      <HistoryLink
        href={href}
        className="truncate rounded-lg px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
      >
        {label}
      </HistoryLink>
      {siblings && menuLabel ? (
        <SiblingMenu siblings={siblings} activeId={activeId} menuLabel={menuLabel} />
      ) : null}
    </li>
  )
}

function Separator() {
  return (
    <li aria-hidden className="px-0.5 text-muted-foreground/60">
      /
    </li>
  )
}

/**
 * The header of a Program, term or course page (M02 §5.1) on the shared `PageHeader`. Program and
 * term pages are in the sidebar, so their header is the page's title (a term page names its term
 * in the subtitle). A course page has its parents as breadcrumbs (the Program is in the sidebar,
 * so it is left out), the course as the title with a menu to switch to another course of the
 * term, and the course's page tabs. Terms and courses also have pin and settings buttons.
 */
export function ScopeHeader({
  scope,
  activePageId,
  program,
  terms,
  term,
  course,
  termCourses,
  title,
  subtitle,
}: {
  scope: Scope
  activePageId?: string
  program: Program
  terms: readonly Term[]
  term?: Term
  course?: Course
  /** Courses of `term` in its order (for the course switcher). */
  termCourses?: readonly Course[]
  /** The title of a Program or term page; courses are titled with their own name. */
  title?: string
  subtitle?: ReactNode
}) {
  const settings = useSettingsDialog()
  const { isPinned, toggle } = usePins(program.id)
  const pin =
    scope.kind === 'term'
      ? ({ kind: 'term', id: scope.termId } as const)
      : scope.kind === 'course'
        ? ({ kind: 'course', id: scope.courseId } as const)
        : null
  const pinned = pin ? isPinned(pin) : false
  const index = course ? (termCourses ?? []).findIndex((c) => c.id === course.id) : -1
  const mod = modifierKey()
  const courseSiblings = (termCourses ?? []).map((c, i) => ({
    id: c.id,
    label: courseLabel(c),
    href: coursePath(program.id, c.id, undefined, term?.id),
    dot: courseColor(c),
    shortcut: i === index - 1 ? `${mod} ↑` : i === index + 1 ? `${mod} ↓` : undefined,
  }))
  const termSiblings = terms.map((t) => ({
    id: t.id,
    label: t.name,
    href: termPath(program.id, t.id),
  }))
  const pinLabel = pinned ? m.academics_unpin() : m.academics_pin()
  return (
    <PageHeader
      title={course ? courseLabel(course) : (title ?? term?.name ?? program.name)}
      switcher={
        course ? (
          <SiblingMenu
            siblings={courseSiblings}
            activeId={course.id}
            menuLabel={m.academics_switch_course()}
          />
        ) : null
      }
      breadcrumb={
        course && term ? (
          <nav aria-label={m.academics_breadcrumbs()}>
            <ol className="-ml-1.5 flex min-w-0 flex-wrap items-center text-sm">
              <Crumb
                label={m.academics_nav_terms_and_courses()}
                href={termsAndCoursesPath(program.id, { term: term.id })}
              />
              <Separator />
              <Crumb
                label={term.name}
                href={termPath(program.id, term.id)}
                siblings={termSiblings}
                activeId={term.id}
                menuLabel={m.academics_switch_term()}
              />
            </ol>
          </nav>
        ) : null
      }
      subtitle={subtitle}
      actions={
        <>
          {pin ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-pressed={pinned}
                    aria-label={pinLabel}
                    onClick={() => toggle(pin)}
                  />
                }
              >
                {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
              </TooltipTrigger>
              <TooltipContent>{pinLabel}</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={m.academics_scope_settings()}
                  onClick={() => settings.open({ level: scope.kind })}
                />
              }
            >
              <Settings aria-hidden />
            </TooltipTrigger>
            <TooltipContent>{m.academics_scope_settings()}</TooltipContent>
          </Tooltip>
        </>
      }
    >
      {scope.kind === 'course' ? <ScopeNav scope={scope} activePageId={activePageId} /> : null}
    </PageHeader>
  )
}
