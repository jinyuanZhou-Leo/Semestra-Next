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
  CalendarPlus,
  ChevronRight,
  MoreHorizontal,
  PinOff,
  Plus,
  Repeat,
  Trash2,
} from 'lucide-react'
import { type CSSProperties, type MouseEvent, useState } from 'react'
import { useUiPref } from '@/app/ui-pref'
import { HistoryLink } from '@/components/HistoryLink'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { courseColor, courseLabel } from '../color'
import { DeleteTermDialog } from '../components/DeleteTermDialog'
import { useCurrentTerm } from '../current-term'
import { newTermPath, coursePath, termPath } from '../paths'
import { movePin, type Pin as PinRef, samePin, usePins } from '../pins'
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

/** The remembered folding of terms (ids that are open); the current term starts open. */
function useOpenTerms(programId: string, currentId: string | undefined) {
  const [expanded, setExpanded] = useUiPref<string[] | null>('academics.sidebar_expanded', null, {
    scope: programId,
  })
  const open = expanded ?? (currentId ? [currentId] : [])
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
  const { isMobile } = useSidebar()
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
      <DropdownMenuContent side={isMobile ? 'bottom' : 'right'} align={isMobile ? 'end' : 'start'}>
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
  onNavigate,
  menu,
  dragging,
}: {
  programId: string
  term: Term
  expanded: boolean
  onToggle: (next: boolean) => void
  pathname: string
  onNavigate: () => void
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

/** A pinned course: one flat row with its colour, and the pin menu. */
function CourseEntry({
  programId,
  course,
  pathname,
  onNavigate,
  menu,
  dragging,
}: {
  programId: string
  course: Course
  pathname: string
  onNavigate: () => void
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
        render={
          <HistoryLink
            href={href}
            onClick={onNavigate}
            aria-current={pathname === href ? 'page' : undefined}
          />
        }
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
  onNavigate: () => void
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
        onNavigate={props.onNavigate}
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
      onNavigate={props.onNavigate}
      menu={props.menu}
      dragging={dragging}
    />
  ) : null
}

/** Terms that are not in the sidebar yet; choosing one pins it (same data as the pin button). */
function AddTermPicker({
  terms,
  onPick,
}: {
  terms: readonly Term[]
  onPick: (term: Term) => void
}) {
  const { isMobile } = useSidebar()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={<SidebarGroupAction aria-label={m.academics_sidebar_add_term()} />}
            />
          }
        >
          <Plus aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.academics_sidebar_add_term()}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-64 p-0" align="start" side={isMobile ? 'bottom' : 'right'}>
        <Command>
          <CommandInput placeholder={m.academics_sidebar_add_term_search()} />
          <CommandList>
            <CommandEmpty>{m.academics_sidebar_add_term_empty()}</CommandEmpty>
            {terms.map((term) => (
              <CommandItem
                key={term.id}
                value={term.id}
                keywords={[term.name]}
                onSelect={() => {
                  onPick(term)
                  setOpen(false)
                }}
              >
                <span className="min-w-0 flex-1 truncate">{term.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(`${term.start_date}T00:00`)}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The part of the sidebar below the Program pages (M02 §5.1): the current term with its
 * courses, then the pinned terms and courses in the user's order. Other terms are reached
 * from the Terms & courses page, the breadcrumbs or the palette, or added here with "+".
 */
export function SidebarTerms({
  programId,
  pathname,
  onNavigate,
}: {
  programId: string
  pathname: string
  onNavigate: () => void
}) {
  const { isMobile } = useSidebar()
  const terms = useTerms(programId).data?.items
  const courses = useCourses(programId).data?.items
  const { term: current } = useCurrentTerm(programId)
  const { pins, setPins, toggle } = usePins(programId)
  const { open, setOpen } = useOpenTerms(programId, current?.id)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  // The current term is shown above, so a pin of it waits (hidden) until it is not current any more.
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
  const addable = (terms ?? []).filter(
    (t) => t.id !== current?.id && !pins.some((p) => samePin(p, { kind: 'term', id: t.id })),
  )

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>{m.academics_sidebar_current_term()}</SidebarGroupLabel>
        {isMobile || !terms || terms.length === 0 ? null : (
          <AddTermPicker terms={addable} onPick={(term) => toggle({ kind: 'term', id: term.id })} />
        )}
        <SidebarGroupContent>
          <SidebarMenu>
            {current ? (
              <TermEntry
                programId={programId}
                term={current}
                expanded={open.includes(current.id)}
                onToggle={(next) => setOpen(current.id, next)}
                pathname={pathname}
                onNavigate={onNavigate}
              />
            ) : null}
            {terms && terms.length === 0 ? (
              <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
                <span className="block px-3 py-1.5 text-xs text-muted-foreground">
                  {m.academics_terms_empty()}
                </span>
                {isMobile ? null : (
                  <SidebarMenuButton
                    size="sm"
                    render={<HistoryLink href={newTermPath(programId)} onClick={onNavigate} />}
                  >
                    <CalendarPlus aria-hidden />
                    <span className="truncate">{m.academics_term_new()}</span>
                  </SidebarMenuButton>
                )}
              </SidebarMenuItem>
            ) : null}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {entries.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>{m.academics_pinned()}</SidebarGroupLabel>
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
                      onNavigate={onNavigate}
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
      ) : null}
    </>
  )
}
