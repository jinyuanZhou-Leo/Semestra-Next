import type { Course } from '@semestra/api-client'
import {
  academicsCourseDeleteMutation,
  academicsCourseUpdateMutation,
} from '@semestra/api-client/react-query'
import {
  type CellContext,
  type SortingState,
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  Pin,
  PinOff,
  Search,
  SearchX,
  X,
} from 'lucide-react'
import { createContext, use, useState } from 'react'
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
import { Kbd } from '@/ui/kbd'
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
import { type Pin as PinRef, usePins } from '../pins'
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

/**
 * The cells live at module level and read what they need from this context: a cell defined
 * inside the component would be a new function on every render, and `FlexRender` would remount
 * it, which drops keyboard focus from the checkbox or pin button that was just used.
 */
type CellProps = CellContext<typeof features, Course>

type TableState = {
  programId: string
  selected: ReadonlySet<string>
  allSelected: boolean
  someSelected: boolean
  selectAll: (on: boolean) => void
  toggleRow: (id: string, on: boolean) => void
  isPinned: (pin: PinRef) => boolean
  togglePin: (pin: PinRef) => void
  termSpan: (course: Course) => string
  extensions: ReadonlyMap<string, CourseColumn>
  columnData: ReadonlyMap<string, unknown>
}

const TableContext = createContext<TableState | null>(null)

function useTableState(): TableState {
  const state = use(TableContext)
  if (!state) throw new Error('CoursesTable cells must render inside CoursesTable')
  return state
}

function SelectAllHeader() {
  const { allSelected, someSelected, selectAll } = useTableState()
  return (
    <Checkbox
      aria-label={m.academics_select_all()}
      checked={allSelected}
      indeterminate={!allSelected && someSelected}
      onCheckedChange={selectAll}
    />
  )
}

function SelectCell({ row }: CellProps) {
  const { selected, toggleRow } = useTableState()
  return (
    <Checkbox
      aria-label={m.academics_select_course({ name: row.original.code || row.original.title })}
      checked={selected.has(row.original.id)}
      onCheckedChange={(on) => toggleRow(row.original.id, on)}
    />
  )
}

function CodeCell({ row }: CellProps) {
  return (
    <span className="flex items-center gap-2 font-medium whitespace-nowrap">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: courseColor(row.original) }}
      />
      {row.original.code || '—'}
    </span>
  )
}

function TitleCell({ row }: CellProps) {
  const { programId } = useTableState()
  return (
    <HistoryLink
      href={coursePath(programId, row.original.id)}
      onClick={(event) => event.stopPropagation()}
      className="hover:underline"
    >
      {row.original.title}
    </HistoryLink>
  )
}

const SubjectCell = ({ row }: CellProps) => row.original.subject_code || '—'

function CreditsCell({ row }: CellProps) {
  return <span className="tabular-nums">{formatCredits(row.original.credits)}</span>
}

function TermsCell({ row }: CellProps) {
  const { termSpan } = useTableState()
  return <span className="whitespace-nowrap">{termSpan(row.original)}</span>
}

const GpaCell = ({ row }: CellProps) =>
  row.original.include_in_gpa ? m.academics_yes() : m.academics_no()

function ExtensionCell({ row, column }: CellProps) {
  const { extensions, columnData } = useTableState()
  const extensionId = column.id.slice('ext:'.length)
  return extensions.get(extensionId)?.cell(row.original, columnData.get(extensionId))
}

const PinHeader = () => <span className="sr-only">{m.terms_courses_pin_column()}</span>

function PinCell({ row }: CellProps) {
  const { isPinned, togglePin } = useTableState()
  const pin: PinRef = { kind: 'course', id: row.original.id }
  const label = isPinned(pin) ? m.academics_unpin() : m.academics_pin()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            onClick={() => togglePin(pin)}
          />
        }
      >
        {isPinned(pin) ? <PinOff aria-hidden /> : <Pin aria-hidden />}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const ALL = '__all__'

/**
 * The pin column sticks to the right edge, so it needs an opaque background that matches what
 * it covers: the header's and a hovered row's `bg-muted/50` over the page background (blended
 * in sRGB, like the browser composites). Written out in full so Tailwind sees the class names.
 */
const STICKY_END_HEAD =
  'sticky right-0 bg-[color-mix(in_srgb,var(--color-muted)_50%,var(--color-background))]'
const STICKY_END_CELL =
  'sticky right-0 bg-background [tr:hover>&]:bg-[color-mix(in_srgb,var(--color-muted)_50%,var(--color-background))]'

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
  /** The chosen option of each column's filter dropdown, by column id. */
  const [columnFilters, setColumnFilters] = useState<Readonly<Record<string, string>>>({})
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
  // One dropdown per column that contributes filters; options that say they are unavailable
  // (e.g. GPA thresholds while GPA is hidden) are neither offered nor applied.
  const filterGroups = extensions
    .map((col) => {
      const data = columnData.get(col.id)
      const options = (col.filter ?? []).filter((f) => f.available?.(data) ?? true)
      return { id: col.id, label: col.header(), data, options }
    })
    .filter((group) => group.options.length > 0)
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
    return filterGroups.every((group) => {
      const option = group.options.find((f) => f.id === columnFilters[group.id])
      return !option || option.test(course, group.data)
    })
  })
  const visibleIds = visible.map((c) => c.id)
  const selectedVisible = visibleIds.filter((id) => selected.has(id))
  const allSelected = visible.length > 0 && selectedVisible.length === visible.length
  const selecting = selectedVisible.length > 0

  const toggleRow = (id: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    setSelected(next)
  }
  const tableState: TableState = {
    programId,
    selected,
    allSelected,
    someSelected: selecting,
    selectAll: (on) => setSelected(on ? new Set(visibleIds) : new Set()),
    toggleRow,
    isPinned,
    togglePin,
    termSpan,
    extensions: new Map(extensions.map((ext) => [ext.id, ext])),
    columnData,
  }

  const columns = column.columns([
    column.display({
      id: 'select',
      header: SelectAllHeader,
      cell: SelectCell,
      enableSorting: false,
    }),
    column.accessor((c) => c.code ?? '', {
      id: 'code',
      header: m.academics_course_code(),
      sortFn: sortBy((c) => c.code || null),
      cell: CodeCell,
    }),
    column.accessor((c) => c.title, {
      id: 'title',
      header: m.academics_course_title(),
      sortFn: sortBy((c) => c.title),
      cell: TitleCell,
    }),
    column.accessor((c) => c.subject_code, {
      id: 'subject',
      header: m.academics_course_subject(),
      sortFn: sortBy((c) => c.subject_code || null),
      cell: SubjectCell,
    }),
    column.accessor((c) => c.credits, {
      id: 'credits',
      header: m.academics_course_credits(),
      sortFn: sortBy((c) => c.credits),
      cell: CreditsCell,
    }),
    ...(lockTerm
      ? []
      : [
          column.accessor((c) => termSpan(c), {
            id: 'terms',
            header: m.academics_course_terms(),
            sortFn: sortBy((c) => terms.findIndex((t) => t.id === c.term_ids[0])),
            cell: TermsCell,
          }),
        ]),
    column.accessor((c) => c.include_in_gpa, {
      id: 'gpa',
      header: m.academics_course_in_gpa(),
      sortFn: sortBy((c) => (c.include_in_gpa ? 1 : 0)),
      cell: GpaCell,
    }),
    ...extensions.map((ext) =>
      column.display({
        id: `ext:${ext.id}`,
        header: ext.header(),
        cell: ExtensionCell,
        enableSorting: ext.sortValue !== undefined,
        sortFn: ext.sortValue
          ? sortBy((course) => ext.sortValue?.(course, columnData.get(ext.id)) ?? null)
          : undefined,
      }),
    ),
    column.display({ id: 'pin', header: PinHeader, cell: PinCell, enableSorting: false }),
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
  useHotkey('escape', clearSelection, { enabled: selecting && !deleting })

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
    <TableContext value={tableState}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
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
          {/*
            While rows are selected the batch actions take the filters' place on the right. Both
            sit in one grid cell, so the row keeps its height and the table never moves; the
            hidden one is `inert`. The search box stays as it is.
          */}
          <div className="ml-auto grid min-w-0">
            <div
              inert={selecting}
              className={cn(
                'col-start-1 row-start-1 flex min-h-9 flex-wrap items-center justify-end gap-2',
                selecting && 'invisible',
              )}
            >
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
              {filterGroups.map((group) => (
                <FilterSelect
                  key={group.id}
                  label={group.label}
                  value={columnFilters[group.id] ?? ALL}
                  onChange={(next) => setColumnFilters({ ...columnFilters, [group.id]: next })}
                  options={group.options.map((f) => ({ value: f.id, label: f.label() }))}
                  allLabel={m.academics_filter_any_column({ column: group.label })}
                />
              ))}
            </div>
            <div
              role="toolbar"
              aria-label={m.academics_batch_actions()}
              inert={!selecting}
              className={cn(
                'col-start-1 row-start-1 flex min-h-9 items-center justify-end gap-2 self-start text-sm whitespace-nowrap',
                !selecting && 'invisible',
              )}
            >
              <span className="mr-1 tabular-nums">
                {m.academics_selected_count({ count: selectedVisible.length })}
              </span>
              <CreditsPopover
                disabled={busy}
                onApply={(credits) =>
                  runBatch((id) =>
                    update.mutateAsync({ path: { course_id: id }, body: { credits } }),
                  )
                }
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button size="sm" variant="outline" disabled={busy} />}
                >
                  {m.academics_course_in_gpa()}
                  <ChevronDown aria-hidden data-icon="inline-end" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => void setGpa(true)}>
                    {m.academics_batch_include_gpa()}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void setGpa(false)}>
                    {m.academics_batch_exclude_gpa()}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => setDeleting(true)}
              >
                {m.academics_batch_delete()}
              </Button>
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
                <TooltipContent>
                  {m.academics_clear_selection()}
                  <Kbd>Esc</Kbd>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        {/*
          The rounded box only clips; the table scrolls inside it (the `Table` container). When
          the columns do not fit, the pin column stays at the right edge so a row still visibly
          ends at the border instead of being cut off mid-cell.
        */}
        <div className="overflow-hidden rounded-2xl border border-border">
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
                          h.column.id === 'pin' && STICKY_END_HEAD,
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
                    <TableCell
                      key={cell.id}
                      className={cn(
                        'py-2 whitespace-normal',
                        cell.column.id === 'pin' && STICKY_END_CELL,
                      )}
                    >
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
                    setColumnFilters({})
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
    </TableContext>
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
      <PopoverContent align="end" className="w-56">
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
