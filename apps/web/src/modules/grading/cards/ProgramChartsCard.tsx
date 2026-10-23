import type { TermGradePoint } from '@semestra/api-client'
import { ChartLine } from 'lucide-react'
import { type ComponentProps, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import type { CardProps } from '@/app/extensions'
import { formatCredits, formatGpa } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/ui/chart'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { GPA_MASK } from '../display'
import { useProgramGrades } from '../queries'

// jsdom and the first paint have no layout; the charts start at this size and then follow the card.
const GPA_SIZE = { width: 400, height: 140 }
const CREDITS_SIZE = { width: 400, height: 72 }

const gpaConfig = () =>
  ({
    gpa: { label: m.grading_term_gpa(), color: 'var(--chart-1)' },
    cumulative_gpa: { label: m.grading_cumulative_gpa(), color: 'var(--chart-2)' },
  }) satisfies ChartConfig

const creditsConfig = () =>
  ({
    credits_counted: { label: m.grading_credits_counted(), color: 'var(--chart-3)' },
  }) satisfies ChartConfig

/** The chart's figures as text, its caption for assistive tech. */
function ChartFigures({
  terms,
  value,
}: {
  terms: TermGradePoint[]
  value: (t: TermGradePoint) => string | null
}) {
  return (
    <figcaption className="sr-only">
      <ul>
        {terms.map((t) => {
          const text = value(t)
          return text === null ? null : <li key={t.term_id}>{`${t.name}: ${text}`}</li>
        })}
      </ul>
    </figcaption>
  )
}

type TooltipFormatter = NonNullable<ComponentProps<typeof ChartTooltipContent>['formatter']>

const gpaTooltip: TooltipFormatter = (value, name) => {
  const lines = gpaConfig()
  return (
    <span className="flex w-full justify-between gap-3">
      <span className="text-muted-foreground">{lines[name as keyof typeof lines]?.label}</span>
      <span className="font-medium tabular-nums">{formatGpa(Number(value))}</span>
    </span>
  )
}

const creditsTooltip: TooltipFormatter = (value) => formatCredits(Number(value))

/** GPA and cumulative GPA by term, and credits per term (M03 §5.3). Colors are `--chart-*` tokens. */
export default function ProgramChartsCard({ scope }: CardProps) {
  const { data } = useProgramGrades(scope.programId)
  const [revealed, setRevealed] = useState(false)
  if (!data) return null
  const terms: TermGradePoint[] = data.terms
  if (terms.every((t) => t.gpa === null)) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ChartLine aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.grading_charts_empty()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  const masked = data.hide_gpa && !revealed
  const lines = gpaConfig()
  return (
    <div className="flex h-full flex-col gap-3">
      {masked ? (
        <Button
          type="button"
          variant="outline"
          className="h-24 w-full rounded-xl border-dashed font-normal text-muted-foreground"
          aria-label={m.grading_gpa_show()}
          onClick={() => setRevealed(true)}
        >
          {GPA_MASK}
        </Button>
      ) : (
        <figure aria-label={m.grading_chart_gpa_label()}>
          <ChartFigures terms={terms} value={(t) => (t.gpa === null ? null : formatGpa(t.gpa))} />
          <ChartContainer
            config={lines}
            className="aspect-auto h-36 w-full"
            initialDimension={GPA_SIZE}
          >
            <LineChart data={terms} margin={{ left: 0, right: 8, top: 8 }} accessibilityLayer>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="name" hide />
              <YAxis
                width={32}
                domain={[0, data.max_points]}
                ticks={[0, data.max_points / 2, data.max_points]}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => formatGpa(value, 1)}
              />
              <ChartTooltip content={<ChartTooltipContent formatter={gpaTooltip} />} />
              <Line
                dataKey="cumulative_gpa"
                stroke="var(--color-cumulative_gpa)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="gpa"
                stroke="var(--color-gpa)"
                strokeWidth={2}
                dot={{ r: 3, fill: 'var(--color-gpa)' }}
                isAnimationActive={false}
              />
              <ChartLegend verticalAlign="top" content={<ChartLegendContent />} />
            </LineChart>
          </ChartContainer>
        </figure>
      )}
      <figure aria-label={m.grading_chart_credits_label()}>
        <ChartFigures terms={terms} value={(t) => formatCredits(t.credits_counted)} />
        <ChartContainer
          config={creditsConfig()}
          className="aspect-auto h-18 w-full"
          initialDimension={CREDITS_SIZE}
        >
          <BarChart data={terms} margin={{ left: 0, right: 8, top: 4 }} accessibilityLayer>
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              interval="preserveStartEnd"
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent formatter={creditsTooltip} hideIndicator />}
            />
            <Bar
              dataKey="credits_counted"
              fill="var(--color-credits_counted)"
              radius={4}
              maxBarSize={36}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>
      </figure>
    </div>
  )
}
