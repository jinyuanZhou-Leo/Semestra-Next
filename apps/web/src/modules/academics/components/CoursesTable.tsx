import type { Course } from '@semestra/api-client'
import {
  academicsCourseDeleteMutation,
  academicsCourseUpdateMutation,
} from '@semestra/api-client/react-query'
import {
  type CellContext,
  FlexRender,
  type Row,
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
  ExternalLink,
  Pin,
  PinOff,
  Search,
  SearchX,
  Settings,
  Trash2,
} from 'lucide-react'
import { createContext, memo, use, useState } from 'react'
import { useExtensions } from '@/app/registry'
import { RowMenu, useSettingsDialog } from '@/app/settings'
import { useUiPref } from '@/app/ui-pref'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { HistoryLink } from '@/components/HistoryLink'
import {
  RowSelectionContext,
  SelectAllCheckbox,
  SelectCheckbox,
  useRowSelection,
} from '@/components/row-selection'
import { useDialogTarget } from '@/lib/dialog-target'
import { toastError } from '@/lib/errors'
import { formatCredits } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { SelectionToolbar } from '@/components/SelectionToolbar'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
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
import { AddCoursesMenu } from './AddCoursesMenu'
import { DeleteCourseDialog } from './DeleteCourseDialog'
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
  isPinned: (pin: PinRef) => boolean
  togglePin: (pin: PinRef) => void
  openCourse: (course: Course) => void
  openSettings: (course: Course) => void
  askDelete: (course: Course) => void
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
  return <SelectAllCheckbox label={m.academics_select_all()} />
}

function SelectCell({ row }: CellProps) {
  return (
    <SelectCheckbox
      ids={[row.original.id]}
      label={m.academics_select_course({ name: row.original.code || row.original.title })}
    />
  )
}

function CodeCell({ row }: CellProps) {
  const { isPinned } = useTableState()
  return (
    <span className="flex items-center gap-2 font-medium whitespace-nowrap">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: courseColor(row.original) }}
      />
      {row.original.code || '—'}
      {isPinned({ kind: 'course', id: row.original.id }) ? (
        <Tooltip>
          <TooltipTrigger render={<span className="shrink-0 text-muted-foreground" />}>
            <Pin aria-hidden className="size-3" />
            <span className="sr-only">{m.academics_pinned()}</span>
          </TooltipTrigger>
          <TooltipContent>{m.academics_pinned()}</TooltipContent>
        </Tooltip>
      ) : null}
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

function ExtensionCell({ row, column: col }: CellProps) {
  const { extensions, columnData } = useTableState()
  const extensionId = col.id.slice('ext:'.length)
  return extensions.get(extensionId)?.cell(row.original, columnData.get(extensionId))
}

const ActionsHeader = () => <span className="sr-only">{m.common_actions()}</span>

function ActionsCell({ row }: CellProps) {
  const { isPinned, togglePin, openCourse, openSettings, askDelete } = useTableState()
  const course = row.original
  const pin: PinRef = { kind: 'course', id: course.id }
  const pinned = isPinned(pin)
  return (
    <RowMenu label={m.terms_courses_course_actions({ name: course.code || course.title })}>
      <DropdownMenuItem onClick={() => openCourse(course)}>
        <ExternalLink aria-hidden />
        {m.academics_course_open()}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => togglePin(pin)}>
        {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
        {pinned ? m.academics_unpin() : m.academics_pin()}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => openSettings(course)}>
        <Settings aria-hidden />
        {m.academics_course_settings()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => askDelete(course)}>
        <Trash2 aria-hidden />
        {m.academics_course_delete()}
      </DropdownMenuItem>
    </RowMenu>
  )
}

const ALL = '__all__'

/**
 * The actions column sticks to the right edge, so it needs an opaque background that matches what
 * it covers: the header's and a hovered row's `bg-muted/50` over the page background (blended
 * in sRGB, like the browser composites), and a selected row's `bg-muted`, which wins over hover.
 * A 1px shadow on its left separates it from the columns scrolling under it without changing
 * its width. Written out in full so Tailwind sees the class names.
 */
const STICKY_END_HEAD =
  'sticky right-0 bg-[color-mix(in_srgb,var(--color-muted)_50%,var(--color-background))] shadow-[-1px_0_0_var(--color-border)]'
const STICKY_END_CELL =
  'sticky right-0 bg-background shadow-[-1px_0_0_var(--color-border)] [tr:hover:not([data-state=selected])>&]:bg-[color-mix(in_srgb,var(--color-muted)_50%,var(--color-background))] [tr[data-state=selected]>&]:bg-muted'

/**
 * One course's row. Memoized: checking a row renders that row again and the checkboxes (they read
 * `RowSelectionContext`), not every cell of every course, which made checking rows stutter.
 */
const CourseRow = memo(function CourseRow({
  row,
  selected,
}: {
  row: Row<typeof features, Course>
  selected: boolean
}) {
  const { openCourse } = useTableState()
  return (
    <TableRow
      data-state={selected ? 'selected' : undefined}
      onClick={(event) => {
        // Menus render in a portal, but their clicks still bubble through React to here.
        const target = event.target as HTMLElement
        if (!event.currentTarget.contains(target)) return
        if (target.closest('button,a,input,[role=checkbox]')) return
        openCourse(row.original)
      }}
      className="cursor-pointer"
    >
      {row.getAllCells().map((cell) => (
        // The row's click is a mouse shortcut; the title link is the accessible way in.
        // oxlint-disable-next-line jsx-a11y/control-has-associated-label
        <TableCell
          key={cell.id}
          className={cn('py-2 whitespace-normal', cell.column.id === 'actions' && STICKY_END_CELL)}
        >
          <FlexRender cell={cell} />
        </TableCell>
      ))}
    </TableRow>
  )
})

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
  canAdd = false,
}: {
  programId: string
  courses: Course[]
  termId?: string
  onTermChange?: (termId: string | undefined) => void
  lockTerm?: boolean
  /** With `lockTerm`: "Add course" for that term, in the empty state and the table's foot. */
  canAdd?: boolean
}) {
  const router = useRouter()
  const settings = useSettingsDialog()
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
  const [deleting, setDeleting] = useState(false)
  const deletingCourse = useDialogTarget<Course>()
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
  const selection = useRowSelection(visible.map((c) => c.id))
  const selectedVisible = selection.ids
  const tableState: TableState = {
    programId,
    isPinned,
    togglePin,
    openCourse: (course) => router.history.push(coursePath(programId, course.id)),
    openSettings: (course) => settings.open({ level: 'course', scope: course.id }),
    askDelete: deletingCourse.show,
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
    column.display({
      id: 'actions',
      header: ActionsHeader,
      cell: ActionsCell,
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
        {canAdd && termId ? (
          <EmptyContent>
            <AddCoursesMenu
              programId={programId}
              termId={termId}
              align="center"
              trigger={
                <Button>
                  {m.academics_course_add()}
                  <ChevronDown aria-hidden data-icon="inline-end" />
                </Button>
              }
            />
          </EmptyContent>
        ) : null}
      </Empty>
    )
  }

  return (
    <TableContext value={tableState}>
      <RowSelectionContext value={selection}>
        <div className="space-y-3">
          <SelectionToolbar
            count={selectedVisible.length}
            countLabel={m.academics_selected_count({ count: selectedVisible.length })}
            label={m.academics_batch_actions()}
            onClear={selection.clear}
            actions={
              <>
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
              </>
            }
          >
            <InputGroup className="w-64">
              <InputGroupInput
                type="search"
                aria-label={m.academics_courses_search()}
                placeholder={m.academics_courses_search()}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <InputGroupAddon>
                <Search aria-hidden />
              </InputGroupAddon>
            </InputGroup>
            <div className="ml-auto flex items-center justify-end gap-2">
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
          </SelectionToolbar>

          {/*
          The rounded box only clips; the table scrolls inside it (the `Table` container). When
          the columns do not fit, the actions column stays at the right edge so a row still visibly
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
                            h.column.id === 'actions' && STICKY_END_HEAD,
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
                  <CourseRow key={row.id} row={row} selected={selection.has(row.original.id)} />
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

          {deletingCourse.target ? (
            <DeleteCourseDialog course={deletingCourse.target} {...deletingCourse.props} />
          ) : null}
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
                selection.clear()
              })
            }
          />
        </div>
      </RowSelectionContext>
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
