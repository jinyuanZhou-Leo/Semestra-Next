import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Course, Term } from '@semestra/api-client'
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronRight,
  MoreHorizontal,
  PinOff,
  Repeat,
  Trash2,
} from 'lucide-react'
import { type CSSProperties, type MouseEvent, useState } from 'react'
import { GROUP_LABEL } from '@/app/host/sidebar-classes'
import { useUiPref } from '@/app/ui-pref'
import { HistoryLink } from '@/components/HistoryLink'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/ui/sidebar'
import { courseColor, courseLabel } from '../color'
import { DeleteTermDialog } from '../components/DeleteTermDialog'
import { useCurrentTerm } from '../current-term'
import { coursePath, termPath } from '../paths'
import { movePin, type Pin as PinRef, usePins } from '../pins'
import { useCourses, useTerms } from '../queries'

type Dragging = {
  ref: (node: HTMLElement | null) => void
  style: CSSProperties
  listeners: ReturnType<typeof useSortable>['listeners']
}

type EntryMenu = {
  onMove: (delta: -1 | 1) => void
  canMoveUp: boolean
  canMoveDown: boolean
  onUnpin: () => void
}

/** The remembered folding of pinned terms (ids that are open). */
function useOpenTerms(programId: string) {
  const [expanded, setExpanded] = useUiPref<string[] | null>('academics.sidebar_expanded', null, {
    scope: programId,
  })
  const open = expanded ?? []
  const setOpen = (termId: string, next: boolean) =>
    setExpanded(
      next
        ? open.includes(termId)
          ? open
          : [...open, termId]
        : open.filter((id) => id !== termId),
    )
  return { open, setOpen }
}

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

/** The "⋯" menu of a sidebar entry: where it sits among the pins, unpinning, deleting a term. */
function EntryActions({
  name,
  menu,
  onDelete,
  open,
  onOpenChange,
  className,
}: {
  name: string
  menu?: EntryMenu
  onDelete?: () => void
  /** Where the button sits when the row has another action on its right. */
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <SidebarMenuAction
            showOnHover
            className={cn('aria-expanded:bg-muted', className)}
            aria-label={m.academics_term_menu({ name })}
          />
        }
      >
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start">
        {menu ? (
          <>
            <DropdownMenuItem disabled={!menu.canMoveUp} onClick={() => menu.onMove(-1)}>
              <ArrowUp aria-hidden />
              {m.academics_sidebar_move_up()}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!menu.canMoveDown} onClick={() => menu.onMove(1)}>
              <ArrowDown aria-hidden />
              {m.academics_sidebar_move_down()}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={menu.onUnpin}>
              <PinOff aria-hidden />
              {m.academics_unpin()}
            </DropdownMenuItem>
          </>
        ) : null}
        {menu && onDelete ? <DropdownMenuSeparator /> : null}
        {onDelete ? (
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 aria-hidden />
            {m.academics_term_delete()}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A term with its courses; in the pinned group it also moves and unpins. */
function TermEntry({
  programId,
  term,
  expanded,
  onToggle,
  pathname,
  menu,
  dragging,
}: {
  programId: string
  term: Term
  expanded: boolean
  onToggle: (next: boolean) => void
  pathname: string
  menu?: EntryMenu
  dragging?: Dragging
}) {
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
          ref={dragging?.ref}
          style={dragging?.style}
          {...dragging?.listeners}
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
        render={<HistoryLink href={href} aria-current={pathname === href ? 'page' : undefined} />}
      >
        <CalendarDays aria-hidden />
        <span className="truncate">{term.name}</span>
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
      <EntryActions
        name={term.name}
        className="right-7"
        menu={menu}
        onDelete={() => setDeleting(true)}
        open={menuOpen}
        onOpenChange={setMenuOpen}
      />
      <CollapsibleContent>
        <TermCourses programId={programId} term={term} pathname={pathname} />
      </CollapsibleContent>
      <DeleteTermDialog term={term} open={deleting} onOpenChange={setDeleting} />
    </Collapsible>
  )
}

/** A pinned course: one flat row with its colour, and the pin menu. */
function CourseEntry({
  programId,
  course,
  pathname,
  menu,
  dragging,
}: {
  programId: string
  course: Course
  pathname: string
  menu: EntryMenu
  dragging?: Dragging
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const href = coursePath(programId, course.id)
  const active = pathname === href || pathname.startsWith(`${href}/`)
  const label = courseLabel(course)
  return (
    <SidebarMenuItem
      ref={dragging?.ref}
      style={dragging?.style}
      {...dragging?.listeners}
      onContextMenu={(event: MouseEvent) => {
        event.preventDefault()
        setMenuOpen(true)
      }}
    >
      <SidebarMenuButton
        isActive={active}
        tooltip={course.title}
        className="group-has-data-[sidebar=menu-action]/menu-item:pr-8"
        render={<HistoryLink href={href} aria-current={pathname === href ? 'page' : undefined} />}
      >
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: courseColor(course) }}
        />
        <span className="truncate">{label}</span>
      </SidebarMenuButton>
      <EntryActions name={label} menu={menu} open={menuOpen} onOpenChange={setMenuOpen} />
    </SidebarMenuItem>
  )
}

type PinnedEntry = { pin: PinRef; term?: Term; course?: Course }

/** The row of one pin, made draggable inside the pinned group. */
function SortablePin({
  entry,
  ...props
}: {
  entry: PinnedEntry
  programId: string
  pathname: string
  menu: EntryMenu
  expanded: boolean
  onToggle: (next: boolean) => void
}) {
  const sortable = useSortable({ id: `${entry.pin.kind}:${entry.pin.id}` })
  const dragging: Dragging = {
    ref: sortable.setNodeRef,
    // Rows only move up and down.
    style: {
      transform: CSS.Translate.toString(sortable.transform && { ...sortable.transform, x: 0 }),
      transition: sortable.transition,
      position: sortable.isDragging ? 'relative' : undefined,
      zIndex: sortable.isDragging ? 10 : undefined,
    },
    listeners: sortable.listeners,
  }
  if (entry.term) {
    return (
      <TermEntry
        programId={props.programId}
        term={entry.term}
        expanded={props.expanded}
        onToggle={props.onToggle}
        pathname={props.pathname}
        menu={props.menu}
        dragging={dragging}
      />
    )
  }
  return entry.course ? (
    <CourseEntry
      programId={props.programId}
      course={entry.course}
      pathname={props.pathname}
      menu={props.menu}
      dragging={dragging}
    />
  ) : null
}

/**
 * The pinned terms and courses in the user's order (M02 §5.1), below the term the sidebar shows.
 * Pins are added from a term's or course's page header and moved by dragging or from their menu.
 */
export function SidebarPins({ programId, pathname }: { programId: string; pathname: string }) {
  const terms = useTerms(programId).data?.items
  const { term: current } = useCurrentTerm(programId)
  const { pins, setPins, toggle } = usePins(programId)
  // The Program's courses, only to show pinned courses (an open term lists its own).
  const courses = useCourses(programId, undefined, {
    enabled: pins.some((pin) => pin.kind === 'course'),
  }).data?.items
  const { open, setOpen } = useOpenTerms(programId)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  // The current term is in the sidebar already, so a pin of it waits (hidden) until it is not current any more.
  const entries = pins.flatMap((pin): PinnedEntry[] => {
    if (pin.kind === 'term') {
      const term = terms?.find((t) => t.id === pin.id)
      return term && term.id !== current?.id ? [{ pin, term }] : []
    }
    const course = courses?.find((c) => c.id === pin.id)
    return course ? [{ pin, course }] : []
  })
  const shown = entries.map((e) => e.pin)
  const move = (from: number, to: number) => setPins(movePin(pins, shown, from, to))
  const dropped = (event: DragEndEvent) => {
    // The click that ends a drag must not open the row's link.
    const stop = (e: Event) => e.preventDefault()
    window.addEventListener('click', stop, { capture: true })
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 50)
    const from = shown.findIndex((p) => `${p.kind}:${p.id}` === event.active.id)
    const to = shown.findIndex((p) => `${p.kind}:${p.id}` === event.over?.id)
    if (from >= 0 && to >= 0 && from !== to) move(from, to)
  }

  if (entries.length === 0) return null
  return (
    <SidebarGroup>
      <SidebarGroupLabel className={GROUP_LABEL}>{m.academics_pinned()}</SidebarGroupLabel>
      <SidebarGroupContent>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dropped}>
          <SortableContext
            items={entries.map((e) => `${e.pin.kind}:${e.pin.id}`)}
            strategy={verticalListSortingStrategy}
          >
            <SidebarMenu>
              {entries.map((entry, index) => (
                <SortablePin
                  key={`${entry.pin.kind}:${entry.pin.id}`}
                  entry={entry}
                  programId={programId}
                  pathname={pathname}
                  expanded={open.includes(entry.pin.id)}
                  onToggle={(next) => setOpen(entry.pin.id, next)}
                  menu={{
                    onMove: (delta) => move(index, index + delta),
                    canMoveUp: index > 0,
                    canMoveDown: index < entries.length - 1,
                    onUnpin: () => toggle(entry.pin),
                  }}
                />
              ))}
            </SidebarMenu>
          </SortableContext>
        </DndContext>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
