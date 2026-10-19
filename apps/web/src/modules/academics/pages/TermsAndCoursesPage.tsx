import type { Term } from '@semestra/api-client'
import {
  BookOpen,
  CalendarCheck,
  CalendarPlus,
  Ellipsis,
  ExternalLink,
  Pin,
  PinOff,
  Plus,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { PageHeader } from '@/app/host/PageHeader'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { HistoryLink } from '@/components/HistoryLink'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { AddCourseDialog } from '../components/AddCourseDialog'
import { CoursesTable } from '../components/CoursesTable'
import { DeleteTermDialog } from '../components/DeleteTermDialog'
import { useCurrentTerm } from '../current-term'
import { newTermPath, termPath } from '../paths'
import { usePins } from '../pins'
import { useCourses, useTerms } from '../queries'
import { TermWeekLine } from '../shell/ScopeView'

type Tab = 'terms' | 'courses'

/**
 * Terms & courses (M02 §5.3): the same courses seen by time (a term and its courses) or as one
 * table. `termId` is shared by both tabs through the URL: the selected term on one, the term
 * filter on the other. The sidebar only shows the current term and what is pinned; everything
 * that manages terms and courses lives here.
 */
export function TermsAndCoursesPage({
  programId,
  tab,
  termId,
  onTabChange,
  onTermChange,
}: {
  programId: string
  tab: Tab
  termId: string | undefined
  onTabChange: (tab: Tab) => void
  onTermChange: (termId: string | undefined) => void
}) {
  const terms = useTerms(programId)
  const courses = useCourses(programId)
  const current = useCurrentTerm(programId)
  const [adding, setAdding] = useState(false)

  const list = terms.data?.items.toSorted((a, b) => b.start_date.localeCompare(a.start_date)) ?? []
  const picked = list.find((t) => t.id === termId)
  const selected = picked ?? current.term ?? list[0]
  // New courses go to the term being looked at: the selected one, or the filtered one.
  const addTarget = tab === 'terms' ? selected : (picked ?? current.term)

  return (
    <Tabs value={tab} onValueChange={(next) => onTabChange(next as Tab)} className="gap-0">
      <PageHeader
        title={m.academics_nav_all_courses()}
        subtitle={
          terms.data && courses.data
            ? [
                m.academics_term_count({ count: terms.data.items.length }),
                m.academics_course_count({ count: courses.data.items.length }),
              ].join(' · ')
            : undefined
        }
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={!addTarget}
              onClick={() => setAdding(true)}
            >
              <Plus aria-hidden data-icon="inline-start" />
              {m.academics_course_add()}
            </Button>
            <Button size="sm" render={<HistoryLink href={newTermPath(programId)} />}>
              <CalendarPlus aria-hidden data-icon="inline-start" />
              {m.academics_term_new()}
            </Button>
          </>
        }
      >
        <TabsList variant="line" className="h-9 w-full justify-start border-b border-border p-0">
          <TabsTrigger value="terms" className="flex-none rounded-none">
            {m.terms_courses_tab_terms()}
          </TabsTrigger>
          <TabsTrigger value="courses" className="flex-none rounded-none">
            {m.terms_courses_tab_courses()}
          </TabsTrigger>
        </TabsList>
      </PageHeader>
      <div className="p-6">
        <AsyncBoundary
          query={terms}
          isEmpty={(page) => page.items.length === 0}
          empty={
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarPlus aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{m.terms_courses_terms_empty()}</EmptyTitle>
                <EmptyDescription>{m.terms_courses_terms_empty_description()}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button render={<HistoryLink href={newTermPath(programId)} />}>
                  {m.academics_term_new()}
                </Button>
              </EmptyContent>
            </Empty>
          }
        >
          {() => (
            <AsyncBoundary query={courses}>
              {(page) => (
                <>
                  <TabsContent value="terms">
                    {selected ? (
                      <TermsTab
                        programId={programId}
                        terms={list}
                        selected={selected}
                        onSelect={onTermChange}
                        onAddCourse={() => setAdding(true)}
                        courses={page.items}
                      />
                    ) : null}
                  </TabsContent>
                  <TabsContent value="courses">
                    {page.items.length === 0 ? (
                      <Empty>
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <BookOpen aria-hidden />
                          </EmptyMedia>
                          <EmptyTitle>{m.academics_courses_empty()}</EmptyTitle>
                          <EmptyDescription>
                            {m.academics_courses_empty_description()}
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : (
                      <CoursesTable
                        programId={programId}
                        courses={page.items}
                        termId={picked?.id}
                        onTermChange={onTermChange}
                      />
                    )}
                  </TabsContent>
                </>
              )}
            </AsyncBoundary>
          )}
        </AsyncBoundary>
      </div>
      {addTarget ? (
        <AddCourseDialog
          programId={programId}
          termId={addTarget.id}
          open={adding}
          onOpenChange={setAdding}
        />
      ) : null}
    </Tabs>
  )
}

function TermsTab({
  programId,
  terms,
  selected,
  onSelect,
  onAddCourse,
  courses,
}: {
  programId: string
  terms: Term[]
  selected: Term
  onSelect: (termId: string) => void
  onAddCourse: () => void
  courses: Parameters<typeof CoursesTable>[0]['courses']
}) {
  const current = useCurrentTerm(programId)
  const pins = usePins(programId)
  const items = terms.map((t) => ({ value: t.id, label: t.name }))
  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="lg:hidden">
        <Select
          value={selected.id}
          items={items}
          onValueChange={(next) => next && onSelect(String(next))}
        >
          <SelectTrigger aria-label={m.terms_courses_choose_term()} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <ul aria-label={m.academics_terms()} className="hidden space-y-1 lg:block">
        {terms.map((term) => (
          <TermRow
            key={term.id}
            term={term}
            selected={term.id === selected.id}
            isCurrent={term.id === current.term?.id}
            pinned={pins.isPinned({ kind: 'term', id: term.id })}
            onSelect={() => onSelect(term.id)}
            onTogglePin={() => pins.toggle({ kind: 'term', id: term.id })}
            onSetCurrent={() => current.setCurrentTerm(term.id)}
          />
        ))}
      </ul>
      <TermPane
        key={selected.id}
        programId={programId}
        term={selected}
        courses={courses}
        isCurrent={selected.id === current.term?.id}
        isManual={current.isManual}
        pinned={pins.isPinned({ kind: 'term', id: selected.id })}
        onTogglePin={() => pins.toggle({ kind: 'term', id: selected.id })}
        onSetCurrent={() => current.setCurrentTerm(selected.id)}
        onFollowCalendar={() => current.setCurrentTerm(null)}
        onAddCourse={onAddCourse}
      />
    </div>
  )
}

function termDates(term: Term): string {
  return `${formatDate(`${term.start_date}T00:00`)} – ${formatDate(`${term.end_date}T00:00`)}`
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function TermRow({
  term,
  selected,
  isCurrent,
  pinned,
  onSelect,
  onTogglePin,
  onSetCurrent,
}: {
  term: Term
  selected: boolean
  isCurrent: boolean
  pinned: boolean
  onSelect: () => void
  onTogglePin: () => void
  onSetCurrent: () => void
}) {
  return (
    <li className="group/term relative">
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
        className={cn(
          'flex w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          selected ? 'bg-muted' : 'hover:bg-muted/50',
        )}
      >
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{term.name}</span>
          {isCurrent ? <Badge>{m.academics_term_current_badge()}</Badge> : null}
          {pinned ? <Pin aria-hidden className="size-3 shrink-0 text-muted-foreground" /> : null}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {termDates(term)} · {m.academics_course_count({ count: term.course_count })}
        </span>
      </button>
      <div className="absolute top-1.5 right-1.5 flex gap-0.5 rounded-lg bg-muted opacity-0 group-focus-within/term:opacity-100 group-hover/term:opacity-100">
        {isCurrent ? null : (
          <IconAction label={m.terms_courses_set_current()} onClick={onSetCurrent}>
            <CalendarCheck aria-hidden />
          </IconAction>
        )}
        <IconAction
          label={pinned ? m.terms_courses_unpin() : m.terms_courses_pin()}
          onClick={onTogglePin}
        >
          {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
        </IconAction>
      </div>
    </li>
  )
}

function TermPane({
  programId,
  term,
  courses,
  isCurrent,
  isManual,
  pinned,
  onTogglePin,
  onSetCurrent,
  onFollowCalendar,
  onAddCourse,
}: {
  programId: string
  term: Term
  courses: Parameters<typeof CoursesTable>[0]['courses']
  isCurrent: boolean
  isManual: boolean
  pinned: boolean
  onTogglePin: () => void
  onSetCurrent: () => void
  onFollowCalendar: () => void
  onAddCourse: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  return (
    <section aria-label={term.name} className="min-w-0 space-y-4">
      <div className="flex min-h-9 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 shrink-0 sm:shrink">
          <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
            <span className="truncate">{term.name}</span>
            {isCurrent ? <Badge>{m.academics_term_current_badge()}</Badge> : null}
          </h2>
          <p className="text-sm text-muted-foreground">
            {termDates(term)}
            {term.is_current ? <TermWeekLine termId={term.id} /> : null} ·{' '}
            {m.academics_course_count({ count: term.course_count })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isCurrent && isManual ? (
            <Button size="sm" variant="outline" onClick={onFollowCalendar}>
              {m.terms_courses_follow_calendar()}
            </Button>
          ) : null}
          {isCurrent ? null : (
            <Button size="sm" variant="outline" onClick={onSetCurrent}>
              <CalendarCheck aria-hidden data-icon="inline-start" />
              {m.terms_courses_set_current()}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            render={<HistoryLink href={termPath(programId, term.id)} />}
          >
            <ExternalLink aria-hidden data-icon="inline-start" />
            {m.terms_courses_open_term()}
          </Button>
          <IconAction
            label={pinned ? m.terms_courses_unpin() : m.terms_courses_pin()}
            onClick={onTogglePin}
          >
            {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
          </IconAction>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon-sm" aria-label={m.terms_courses_more()} />
                    }
                  />
                }
              >
                <Ellipsis aria-hidden />
              </TooltipTrigger>
              <TooltipContent>{m.terms_courses_more()}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                {m.academics_term_delete()}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <CoursesTable
        programId={programId}
        courses={courses}
        termId={term.id}
        lockTerm
        onAddCourse={onAddCourse}
      />
      <DeleteTermDialog term={term} open={deleting} onOpenChange={setDeleting} />
    </section>
  )
}
