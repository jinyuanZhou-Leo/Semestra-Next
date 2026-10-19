import type { Course } from '@semestra/api-client'
import {
  academicsCourseDeleteMutation,
  academicsCourseUpdateMutation,
} from '@semestra/api-client/react-query'
import {
  type SortingState,
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, BookOpen, Pin, PinOff, Search, SearchX, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useHotkey } from '@/app/hotkeys'
import { useExtensions } from '@/app/registry'
import { useUiPref } from '@/app/ui-pref'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { HistoryLink } from '@/components/HistoryLink'
import { toastError } from '@/lib/errors'
import { formatCredits } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
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
import { Input } from '@/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { courseColor } from '../color'
import { coursePath } from '../paths'
import { usePins } from '../pins'
import { invalidateAcademics, useColumnData, useTerms } from '../queries'
import { COURSE_COLUMNS, type CourseColumn } from '../types'

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })
const column = createColumnHelper<typeof features, Course>()

type SortValue = string | number | null

function compare(a: SortValue, b: SortValue): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

function sortBy(value: (course: Course) => SortValue) {
  return (a: { original: Course }, b: { original: Course }) =>
    compare(value(a.original), value(b.original))
}

const ALL = '__all__'

/** One after the other, stopping at the first failure. */
async function runInOrder(ids: readonly string[], action: (id: string) => Promise<unknown>) {
  for (const id of ids) await action(id)
}

/**
 * The Program's courses as a table (M02 §5.3): search, filters, sorting, pinning and batch changes.
 * `termId` is the term filter, shared with the page's terms tab through the URL; with `lockTerm`
 * the table shows that term only, without the term column and filter.
 */
export function CoursesTable({
  programId,
  courses,
  termId,
  onTermChange,
  lockTerm = false,
  onAddCourse,
}: {
  programId: string
  courses: Course[]
  termId?: string
  onTermChange?: (termId: string | undefined) => void
  lockTerm?: boolean
  /** Offered by the empty state of a term without courses. */
  onAddCourse?: () => void
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const terms = useTerms(programId).data?.items ?? []
  const extensions = useExtensions<CourseColumn>(COURSE_COLUMNS)
  const columnData = useColumnData(extensions, programId)
  const [sorting, setSorting] = useUiPref<SortingState>('academics.courses_sort', [])
  const termFilter = termId ?? ALL
  const { isPinned, toggle: togglePin } = usePins(programId)
  const [subjectFilter, setSubjectFilter] = useState(ALL)
  const [search, setSearch] = useState('')
  const [quick, setQuick] = useState<string[]>([])
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)

  const inScope = lockTerm ? courses.filter((c) => termId && c.term_ids.includes(termId)) : courses
  const termName = (id: string) => terms.find((t) => t.id === id)?.name ?? ''
  const termSpan = (course: Course) => {
    const first = termName(course.term_ids[0] ?? '')
    const last = termName(course.end_term_id)
    return course.term_ids.length > 1 ? `${first} – ${last}` : first
  }
  const subjects = [...new Set(inScope.map((c) => c.subject_code).filter(Boolean))].toSorted()
  const quickFilters = extensions
    .flatMap((col) => (col.filter ?? []).map((f) => ({ ...f, data: columnData.get(col.id) })))
    .filter((f) => f.available?.(f.data) ?? true)
  const needle = search.trim().toLowerCase().replaceAll(/\s+/g, '')

  const visible = inScope.filter((course) => {
    if (!lockTerm && termFilter !== ALL && !course.term_ids.includes(termFilter)) return false
    if (subjectFilter !== ALL && course.subject_code !== subjectFilter) return false
    if (needle) {
      const haystack = [course.code, course.alias, course.title]
        .map((t) => (t ?? '').toLowerCase().replaceAll(/\s+/g, ''))
        .join('\n')
      if (!haystack.includes(needle)) return false
    }
    return quickFilters.every((f) => !quick.includes(f.id) || f.test(course, f.data))
  })
  const visibleIds = visible.map((c) => c.id)
  const selectedVisible = visibleIds.filter((id) => selected.has(id))
  const allSelected = visible.length > 0 && selectedVisible.length === visible.length

  const toggleRow = (id: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    setSelected(next)
  }

  const header =
    (label: string): (() => ReactNode) =>
    () =>
      label
  const columns = column.columns([
    column.display({
      id: 'select',
      header: () => (
        <Checkbox
          aria-label={m.academics_select_all()}
          checked={allSelected}
          indeterminate={!allSelected && selectedVisible.length > 0}
          onCheckedChange={(on) => setSelected(on ? new Set(visibleIds) : new Set())}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={m.academics_select_course({ name: row.original.code || row.original.title })}
          checked={selected.has(row.original.id)}
          onCheckedChange={(on) => toggleRow(row.original.id, on)}
        />
      ),
      enableSorting: false,
    }),
    column.accessor((c) => c.code ?? '', {
      id: 'code',
      header: header(m.academics_course_code()),
      sortFn: sortBy((c) => c.code || null),
      cell: ({ row }) => (
        <span className="flex items-center gap-2 font-medium whitespace-nowrap">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: courseColor(row.original) }}
          />
          {row.original.code || '—'}
        </span>
      ),
    }),
    column.accessor((c) => c.title, {
      id: 'title',
      header: header(m.academics_course_title()),
      sortFn: sortBy((c) => c.title),
      cell: ({ row }) => (
        <HistoryLink
          href={coursePath(programId, row.original.id)}
          onClick={(event) => event.stopPropagation()}
          className="hover:underline"
        >
          {row.original.title}
        </HistoryLink>
      ),
    }),
    column.accessor((c) => c.subject_code, {
      id: 'subject',
      header: header(m.academics_course_subject()),
      sortFn: sortBy((c) => c.subject_code || null),
      cell: ({ row }) => row.original.subject_code || '—',
    }),
    column.accessor((c) => c.credits, {
      id: 'credits',
      header: header(m.academics_course_credits()),
      sortFn: sortBy((c) => c.credits),
      cell: ({ row }) => (
        <span className="tabular-nums">{formatCredits(row.original.credits)}</span>
      ),
    }),
    ...(lockTerm
      ? []
      : [
          column.accessor((c) => termSpan(c), {
            id: 'terms',
            header: header(m.academics_course_terms()),
            sortFn: sortBy((c) => terms.findIndex((t) => t.id === c.term_ids[0])),
            cell: ({ row }) => <span className="whitespace-nowrap">{termSpan(row.original)}</span>,
          }),
        ]),
    column.accessor((c) => c.include_in_gpa, {
      id: 'gpa',
      header: header(m.academics_course_in_gpa()),
      sortFn: sortBy((c) => (c.include_in_gpa ? 1 : 0)),
      cell: ({ row }) => (row.original.include_in_gpa ? m.academics_yes() : m.academics_no()),
    }),
    ...extensions.map((ext) =>
      column.display({
        id: `ext:${ext.id}`,
        header: header(ext.header()),
        cell: ({ row }) => ext.cell(row.original, columnData.get(ext.id)),
        enableSorting: ext.sortValue !== undefined,
        sortFn: ext.sortValue
          ? sortBy((course) => ext.sortValue?.(course, columnData.get(ext.id)) ?? null)
          : undefined,
      }),
    ),
    column.display({
      id: 'pin',
      header: () => <span className="sr-only">{m.terms_courses_pin_column()}</span>,
      cell: ({ row }) => {
        const pin = { kind: 'course', id: row.original.id } as const
        const pinned = isPinned(pin)
        const label = pinned ? m.terms_courses_unpin() : m.terms_courses_pin()
        return (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-pressed={pinned}
                  aria-label={label}
                  onClick={() => togglePin(pin)}
                />
              }
            >
              {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        )
      },
      enableSorting: false,
    }),
  ])

  const table = useTable({
    features,
    columns,
    data: visible,
    getRowId: (course) => course.id,
    state: { sorting },
    onSortingChange: (updater) =>
      setSorting(typeof updater === 'function' ? updater(sorting) : updater),
  })

  const update = useMutation({ ...academicsCourseUpdateMutation() })
  const remove = useMutation({ ...academicsCourseDeleteMutation() })
  const runBatch = async (action: (id: string) => Promise<unknown>) => {
    setBusy(true)
    await runInOrder(selectedVisible, action).catch(toastError)
    setBusy(false)
    await invalidateAcademics(queryClient)
  }
  const setGpa = (include: boolean) =>
    runBatch((id) =>
      update.mutateAsync({ path: { course_id: id }, body: { include_in_gpa: include } }),
    )

  const clearSelection = () => setSelected(new Set())
  useHotkey('escape', clearSelection, { enabled: selectedVisible.length > 0 && !deleting })

  if (lockTerm && inScope.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpen aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.terms_courses_term_empty()}</EmptyTitle>
          <EmptyDescription>{m.terms_courses_term_empty_description()}</EmptyDescription>
        </EmptyHeader>
        {onAddCourse ? (
          <EmptyContent>
            <Button onClick={onAddCourse}>{m.academics_course_add()}</Button>
          </EmptyContent>
        ) : null}
      </Empty>
    )
  }

  return (
    <div className="space-y-3">
      {/* The filters and the batch actions share one cell, so selecting rows never moves the table. */}
      <div className="grid">
        <div
          inert={selectedVisible.length > 0}
          className={cn(
            'col-start-1 row-start-1 flex min-h-9 flex-wrap items-center gap-2',
            selectedVisible.length > 0 && 'invisible',
          )}
        >
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              aria-label={m.academics_courses_search()}
              placeholder={m.academics_courses_search()}
              className="w-64 pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {lockTerm ? null : (
            <FilterSelect
              label={m.academics_filter_term()}
              value={termFilter}
              onChange={(next) => onTermChange?.(next === ALL ? undefined : next)}
              options={terms.map((t) => ({ value: t.id, label: t.name }))}
              allLabel={m.academics_filter_all_terms()}
            />
          )}
          <FilterSelect
            label={m.academics_filter_subject()}
            value={subjectFilter}
            onChange={setSubjectFilter}
            options={subjects.map((s) => ({ value: s, label: s }))}
            allLabel={m.academics_filter_all_subjects()}
          />
          {quickFilters.map((filter) => {
            const on = quick.includes(filter.id)
            return (
              <Button
                key={filter.id}
                size="sm"
                variant={on ? 'default' : 'outline'}
                aria-pressed={on}
                onClick={() =>
                  setQuick(on ? quick.filter((id) => id !== filter.id) : [...quick, filter.id])
                }
              >
                {filter.label()}
              </Button>
            )
          })}
        </div>

        <div
          role="toolbar"
          aria-label={m.academics_batch_actions()}
          inert={selectedVisible.length === 0}
          className={cn(
            'col-start-1 row-start-1 flex min-h-9 flex-wrap items-center gap-2 text-sm',
            selectedVisible.length === 0 && 'invisible',
          )}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={m.academics_clear_selection()}
                  onClick={clearSelection}
                />
              }
            >
              <X aria-hidden />
            </TooltipTrigger>
            <TooltipContent>{m.academics_clear_selection()}</TooltipContent>
          </Tooltip>
          <span className="mr-2">
            {m.academics_selected_count({ count: selectedVisible.length })}
          </span>
          <CreditsPopover
            disabled={busy}
            onApply={(credits) =>
              runBatch((id) => update.mutateAsync({ path: { course_id: id }, body: { credits } }))
            }
          />
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={busy} />}>
              {m.academics_course_in_gpa()}
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => void setGpa(true)}>
                {m.academics_batch_include_gpa()}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void setGpa(false)}>
                {m.academics_batch_exclude_gpa()}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => setDeleting(true)}>
            {m.academics_batch_delete()}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <Table>
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((h) => {
                  const sorted = h.column.getIsSorted()
                  const canSort = h.column.getCanSort()
                  return (
                    <TableHead
                      key={h.id}
                      scope="col"
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : undefined
                      }
                      className={cn(
                        'h-auto py-2 text-muted-foreground',
                        h.column.id === 'select' && 'w-10',
                      )}
                    >
                      {canSort ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={h.column.getToggleSortingHandler()}
                          className="-ml-2 h-auto px-2 text-muted-foreground hover:text-foreground"
                        >
                          <table.FlexRender header={h} />
                          {sorted === 'asc' ? (
                            <ArrowUp aria-hidden className="size-3" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown aria-hidden className="size-3" />
                          ) : null}
                        </Button>
                      ) : (
                        <table.FlexRender header={h} />
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('button,a,input,[role=checkbox]'))
                    return
                  router.history.push(coursePath(programId, row.original.id))
                }}
                className="cursor-pointer"
              >
                {row.getAllCells().map((cell) => (
                  // The row's click is a mouse shortcut; the title link is the accessible way in.
                  // oxlint-disable-next-line jsx-a11y/control-has-associated-label
                  <TableCell key={cell.id} className="py-2 whitespace-normal">
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {visible.length === 0 ? (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.academics_courses_no_match()}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => {
                  if (!lockTerm) onTermChange?.(undefined)
                  setSubjectFilter(ALL)
                  setSearch('')
                  setQuick([])
                }}
              >
                {m.common_clear_filters()}
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={m.academics_batch_delete_title({ count: selectedVisible.length })}
        description={`${m.academics_course_delete_description()} ${m.academics_cannot_undo()}`}
        confirmLabel={m.academics_batch_delete()}
        pending={busy}
        onConfirm={() =>
          void runBatch((id) => remove.mutateAsync({ path: { course_id: id } })).then(() => {
            setDeleting(false)
            setSelected(new Set())
          })
        }
      />
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  allLabel: string
}) {
  const items = [{ value: ALL, label: allLabel }, ...options]
  return (
    <Select value={value} items={items} onValueChange={(next) => onChange(String(next ?? ALL))}>
      <SelectTrigger aria-label={label} className="w-44">
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
  )
}

function CreditsPopover({
  disabled,
  onApply,
}: {
  disabled: boolean
  onApply: (credits: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const n = Number(value)
  const valid = value.trim() !== '' && n >= 0 && n <= 100
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="sm" variant="outline" disabled={disabled} />}>
        {m.academics_batch_set_credits()}
      </PopoverTrigger>
      <PopoverContent className="w-56">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!valid) return
            onApply(n)
            setOpen(false)
          }}
        >
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            aria-label={m.academics_course_credits()}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={!valid}>
            {m.academics_apply()}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
