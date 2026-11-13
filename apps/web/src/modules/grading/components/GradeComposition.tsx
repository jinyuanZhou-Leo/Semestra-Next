import type { Gradebook } from '@semestra/api-client'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { type ReactNode, createContext, useContext, useId, useState } from 'react'
import { formatCredits } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { type CompositionSlice, composition } from '../composition'
import { GRADE_MASK, categoryColor, categoryName, headline, percentText } from '../display'
import { CompositionRing, type RingSlice } from './CompositionRing'
import { Concealed, GpaValue, PercentValue, useHideGrades } from './GradeValue'

type Datum = CompositionSlice & RingSlice & { name: string }

const sliceKey = (id: string | null) => id ?? '__none__'

/** A category's figures: the ring's tooltip, the legend row's tooltip and its screen reader text. */
function sliceRows(datum: Datum, hidden = false): [string, string][] {
  return [
    [m.grading_slice_weight(), `${formatCredits(datum.weight)}%`],
    [m.grading_slice_graded(), `${formatCredits(datum.graded)}%`],
    [m.grading_average(), hidden ? GRADE_MASK : percentText(datum.average)],
    [
      m.grading_slice_contribution(),
      hidden ? GRADE_MASK : `${formatCredits(Math.round(datum.contribution * 100) / 100)}%`,
    ],
  ]
}

function SliceDetails({ datum, mutedClassName }: { datum: Datum; mutedClassName: string }) {
  return (
    <div className="grid min-w-40 gap-1.5">
      <div className="flex items-center gap-1.5 font-medium">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: datum.color }}
        />
        {datum.name}
      </div>
      {sliceRows(datum).map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <span className={mutedClassName}>{label}</span>
          <span className="font-medium tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  )
}

/** What the legend's cells need from the card (column definitions live outside it). */
const LegendContext = createContext({ idPrefix: '' })

const detailsIdOf = (idPrefix: string, datum: Datum) => `${idPrefix}-${datum.key}`

function LegendName({ datum }: { datum: Datum }) {
  const hidden = useHideGrades()
  const { idPrefix } = useContext(LegendContext)
  return (
    <>
      <span
        aria-hidden
        className="mr-2 inline-block size-2.5 rounded-full align-[-0.0625rem]"
        style={{ backgroundColor: datum.color }}
      />
      {datum.name}
      <span id={detailsIdOf(idPrefix, datum)} className="sr-only">
        {sliceRows(datum, hidden)
          .map(([label, value]) => `${label}: ${value}`)
          .join(', ')}
      </span>
    </>
  )
}

function LegendAverage({ average }: { average: number | null }) {
  return <Concealed>{percentText(average)}</Concealed>
}

const legendFeatures = tableFeatures({})
const legendColumn = createColumnHelper<typeof legendFeatures, Datum>()

const legendColumns = legendColumn.columns([
  legendColumn.accessor((d) => d.name, {
    id: 'name',
    header: () => m.grading_assessment_category(),
    cell: ({ row }) => <LegendName datum={row.original} />,
  }),
  legendColumn.accessor((d) => d.graded, {
    id: 'graded',
    header: () => m.grading_slice_graded_of_weight(),
    cell: ({ row }) =>
      `${formatCredits(row.original.graded)}/${formatCredits(row.original.weight)}%`,
  }),
  legendColumn.display({
    id: 'average',
    header: () => m.grading_average(),
    cell: ({ row }) => <LegendAverage average={row.original.average} />,
  }),
])

const HEAD_CLASS: Record<string, string> = {
  name: 'pl-1.5',
  graded: 'pr-0 pl-2 text-right',
  average: 'pr-1.5 pl-3 text-right',
}
const CELL_CLASS: Record<string, string> = {
  graded: 'py-0 pr-0 pl-2 text-right text-xs text-muted-foreground tabular-nums',
  average: 'rounded-r-md py-0 pr-1.5 pl-3 text-right font-medium tabular-nums',
}

/**
 * One category of the legend. It is the ring's text equivalent: focusable, with the same
 * details as the ring's tooltip on hover or focus and as screen reader text.
 */
function LegendRow({
  datum,
  detailsId,
  active,
  onActiveChange,
  children,
}: {
  datum: Datum
  detailsId: string
  active: boolean
  onActiveChange: (active: boolean) => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <TableRow
            tabIndex={0}
            aria-describedby={detailsId}
            data-active={active ? true : undefined}
            onMouseEnter={() => onActiveChange(true)}
            onMouseLeave={() => onActiveChange(false)}
            onFocus={() => onActiveChange(true)}
            onBlur={() => onActiveChange(false)}
            className="h-8 border-0 outline-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset data-active:bg-muted/60"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="left">
        <SliceDetails datum={datum} mutedClassName="text-background/70" />
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * How the course grade is made up (M03 §5.1): a ring with each category's weight, graded part
 * solid, the grade in its middle, GPA beside it and a row per category below. It shows real
 * grades only; plan results live in other cards.
 */
export function GradeComposition({ gradebook }: { gradebook: Gradebook }) {
  const [hovered, setHovered] = useState<string | null>(null)
  const idPrefix = useId()
  const { summary: s } = gradebook
  const data: Datum[] = composition(s, gradebook.categories).map((slice) => ({
    ...slice,
    key: sliceKey(slice.id),
    name: slice.category ? categoryName(slice.category) : m.grading_category_none(),
    color: categoryColor(slice.category?.color ?? 'slate'),
  }))

  const legend = useTable({
    features: legendFeatures,
    columns: legendColumns,
    data,
    getRowId: (d) => d.key,
  })

  const shown = headline(s)
  const actual = s.weights_ok || s.overridden ? shown.percentage : null

  return (
    <section aria-label={m.grading_composition()} className="rounded-2xl border border-border p-4">
      <div className="flex items-center gap-4">
        <CompositionRing
          data={data}
          hovered={hovered}
          onHoveredChange={setHovered}
          renderDetails={(datum) => (
            <SliceDetails datum={datum} mutedClassName="text-muted-foreground" />
          )}
        >
          <span className="text-xl font-semibold tabular-nums">
            <PercentValue value={actual} animated />
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {s.overridden ? (
              <Badge variant="secondary">{m.grading_overridden()}</Badge>
            ) : shown.final ? (
              m.grading_final()
            ) : (
              m.grading_current()
            )}
          </span>
        </CompositionRing>
        <dl className="grid min-w-0 gap-3">
          <div>
            <dt className="text-xs text-muted-foreground">{m.grading_gpa()}</dt>
            <dd className="flex items-baseline gap-1.5 text-2xl font-semibold tabular-nums">
              <GpaValue
                value={shown.points}

                letter={shown.letter}
                letterClassName="text-sm font-semibold"
                animated
              />
            </dd>
          </div>
        </dl>
      </div>
      {data.length > 0 ? (
        <LegendContext value={{ idPrefix }}>
          <Table className="mt-3 border-t border-border">
            <TableHeader className="[&_tr]:border-0">
              {legend.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map((h) => (
                    <TableHead
                      key={h.id}
                      scope="col"
                      className={cn(
                        'h-8 text-xs font-normal text-muted-foreground',
                        HEAD_CLASS[h.column.id],
                      )}
                    >
                      <legend.FlexRender header={h} />
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {legend.getRowModel().rows.map((row) => (
                <LegendRow
                  key={row.id}
                  datum={row.original}
                  detailsId={detailsIdOf(idPrefix, row.original)}
                  active={hovered === row.id}
                  onActiveChange={(on) => setHovered(on ? row.id : null)}
                >
                  {row.getAllCells().map((cell) =>
                    cell.column.id === 'name' ? (
                      <TableHead
                        key={cell.id}
                        scope="row"
                        className="h-8 w-full max-w-0 truncate rounded-l-md pr-0 pl-1.5 font-normal"
                      >
                        <legend.FlexRender cell={cell} />
                      </TableHead>
                    ) : (
                      <TableCell key={cell.id} className={CELL_CLASS[cell.column.id]}>
                        <legend.FlexRender cell={cell} />
                      </TableCell>
                    ),
                  )}
                </LegendRow>
              ))}
            </TableBody>
          </Table>
        </LegendContext>
      ) : null}
    </section>
  )
}
