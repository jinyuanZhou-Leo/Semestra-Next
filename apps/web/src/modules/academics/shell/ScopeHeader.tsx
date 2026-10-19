import type { Course, Program, Term } from '@semestra/api-client'
import { ChevronDown, Pin, PinOff, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Scope } from '@/app/extensions'
import { ScopeNav } from '@/app/host/ScopeNav'
import { useSettingsDialog } from '@/app/settings'
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
import { courseColor, courseLabel } from '../color'
import { coursePath, programPath, termPath } from '../paths'
import { usePins } from '../pins'
import { usePrograms } from '../queries'
import { modifierKey } from './hotkeys'

type Sibling = { id: string; label: string; href: string; dot?: string; shortcut?: string }

function Crumb({
  label,
  href,
  current,
  siblings,
  activeId,
  menuLabel,
}: {
  label: string
  href: string
  current?: boolean
  siblings?: Sibling[]
  activeId?: string
  menuLabel: string
}) {
  return (
    <li className="flex min-w-0 items-center">
      <HistoryLink
        href={href}
        aria-current={current ? 'page' : undefined}
        className={cn(
          'truncate rounded-lg px-1.5 py-0.5 hover:bg-muted',
          current ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </HistoryLink>
      {siblings && siblings.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-xs" aria-label={menuLabel} />}
          >
            <ChevronDown aria-hidden />
          </DropdownMenuTrigger>
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
 * The header of a Program, term or course page (M02 §5.1): breadcrumbs whose segments switch
 * between siblings, a settings button, and the scope's page tabs.
 */
export function ScopeHeader({
  scope,
  activePageId,
  program,
  terms,
  term,
  course,
  termCourses,
  children,
}: {
  scope: Scope
  activePageId?: string
  program: Program
  terms: readonly Term[]
  term?: Term
  course?: Course
  /** Courses of `term` in its order (for the course switcher). */
  termCourses?: readonly Course[]
  /** Extra header content under the breadcrumbs (e.g. the Program's counts). */
  children?: ReactNode
}) {
  const settings = useSettingsDialog()
  const programs = usePrograms().data?.items ?? [program]
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
  return (
    <header className="space-y-3 px-6 pt-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <nav aria-label={m.academics_breadcrumbs()}>
            <ol className="flex min-w-0 flex-wrap items-center text-sm">
              <Crumb
                label={program.name}
                href={programPath(program.id)}
                current={scope.kind === 'program'}
                siblings={programs.map((p) => ({
                  id: p.id,
                  label: p.name,
                  href: programPath(p.id),
                }))}
                activeId={program.id}
                menuLabel={m.academics_switch_program()}
              />
              {term ? (
                <>
                  <Separator />
                  <Crumb
                    label={term.name}
                    href={termPath(program.id, term.id)}
                    current={scope.kind === 'term'}
                    siblings={terms.map((t) => ({
                      id: t.id,
                      label: t.name,
                      href: termPath(program.id, t.id),
                    }))}
                    activeId={term.id}
                    menuLabel={m.academics_switch_term()}
                  />
                </>
              ) : null}
              {course ? (
                <>
                  <Separator />
                  <Crumb
                    label={courseLabel(course)}
                    href={coursePath(program.id, course.id, undefined, term?.id)}
                    current
                    siblings={courseSiblings}
                    activeId={course.id}
                    menuLabel={m.academics_switch_course()}
                  />
                </>
              ) : null}
            </ol>
          </nav>
          {children}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {pin ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-pressed={pinned}
              aria-label={pinned ? m.academics_unpin() : m.academics_pin()}
              title={pinned ? m.academics_unpin() : m.academics_pin()}
              onClick={() => toggle(pin)}
            >
              {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.academics_scope_settings()}
            title={m.academics_scope_settings()}
            onClick={() => settings.open({ level: scope.kind })}
          >
            <Settings aria-hidden />
          </Button>
        </div>
      </div>
      <div data-tour="page-tabs">
        <ScopeNav scope={scope} activePageId={activePageId} />
      </div>
    </header>
  )
}
