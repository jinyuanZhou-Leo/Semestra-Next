import type { ReactNode } from 'react'
import { Pie, PieChart, Sector, type PieSectorShapeProps } from 'recharts'
import { ChartContainer, ChartTooltip } from '@/ui/chart'

const RING = 132
const INNER = 48
const OUTER = 62

/**
 * One part of a grade (a course's category, a term's course): its share of the whole, how much
 * of it has a real grade and how much plan mode assumed one for.
 */
export type RingSlice = {
  key: string
  color: string
  weight: number
  graded: number
  assumed: number
}

/**
 * One slice of the ring: its whole weight lightly tinted, the assumed part darker, the graded
 * part solid. Recharts clones this element with each sector's geometry.
 */
function SliceShape({
  planning,
  hovered,
  ...props
}: Partial<PieSectorShapeProps> & { planning: boolean; hovered: string | null }) {
  const datum = props.payload as RingSlice | undefined
  const startAngle = props.startAngle ?? 0
  const endAngle = props.endAngle ?? 0
  const base = { cx: props.cx, cy: props.cy, innerRadius: props.innerRadius }
  if (!datum?.color)
    return (
      <Sector
        {...base}
        outerRadius={props.outerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill="var(--muted)"
      />
    )
  const span = endAngle - startAngle
  const share = (part: number) => (datum.weight === 0 ? 0 : part / datum.weight)
  const common = {
    ...base,
    outerRadius: (props.outerRadius ?? 0) + (datum.key === hovered ? 3 : 0),
  }
  const assumedEnd = startAngle + span * share(datum.graded + (planning ? datum.assumed : 0))
  return (
    <g>
      <Sector
        {...common}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={datum.color}
        fillOpacity={0.2}
      />
      {planning && datum.assumed > 0 ? (
        <Sector
          {...common}
          startAngle={startAngle}
          endAngle={assumedEnd}
          fill={datum.color}
          fillOpacity={0.55}
        />
      ) : null}
      {datum.graded > 0 ? (
        <Sector
          {...common}
          startAngle={startAngle}
          endAngle={startAngle + span * share(datum.graded)}
          fill={datum.color}
        />
      ) : null}
    </g>
  )
}

function SliceTooltip<T extends RingSlice>({
  active,
  payload,
  renderDetails,
}: {
  active?: boolean
  payload?: readonly { payload?: unknown }[]
  renderDetails: (slice: T) => ReactNode
}) {
  const datum = payload?.[0]?.payload as T | undefined
  if (!active || !datum?.color) return null
  return (
    <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      {renderDetails(datum)}
    </div>
  )
}

/**
 * The ring of a grade breakdown card, with `children` in its middle. A slice is hovered (and
 * grows a little) while the pointer is on it or on its row elsewhere in the card.
 */
export function CompositionRing<T extends RingSlice>({
  data,
  planning,
  hovered,
  onHoveredChange,
  renderDetails,
  children,
}: {
  data: readonly T[]
  planning: boolean
  hovered: string | null
  onHoveredChange: (key: string | null) => void
  /** A slice's figures for its tooltip. */
  renderDetails: (slice: T) => ReactNode
  /** What the middle of the ring shows. */
  children: ReactNode
}) {
  return (
    <div className="relative shrink-0" style={{ width: RING, height: RING }}>
      <ChartContainer
        config={{}}
        className="aspect-square size-full"
        initialDimension={{ width: RING, height: RING }}
      >
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={<SliceTooltip renderDetails={renderDetails} />}
            wrapperStyle={{ zIndex: 10 }}
          />
          <Pie
            data={data.length > 0 ? [...data] : [{ key: 'empty', weight: 1 }]}
            dataKey="weight"
            nameKey="name"
            innerRadius={INNER}
            outerRadius={OUTER}
            startAngle={90}
            endAngle={-270}
            paddingAngle={data.length > 1 ? 2 : 0}
            stroke="none"
            isAnimationActive={false}
            onMouseEnter={(_, index) => onHoveredChange(data[index]?.key ?? null)}
            onMouseLeave={() => onHoveredChange(null)}
            shape={<SliceShape planning={planning} hovered={hovered} />}
          />
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  )
}
