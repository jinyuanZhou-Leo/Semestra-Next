import type { TermGradePoint } from '@semestra/api-client'
import { ChartLine } from 'lucide-react'
import { useState } from 'react'
import type { CardProps } from '@/app/extensions'
import { formatCredits, formatGpa } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { GPA_MASK } from '../display'
import { useProgramGrades } from '../queries'

const W = 400
const H = 140
const PAD = { top: 10, right: 12, bottom: 6, left: 12 }

/** Points of one series as SVG path segments; a missing value breaks the line. */
function linePath(values: (number | null)[], x: (i: number) => number, y: (v: number) => number) {
  let path = ''
  let pen = false
  values.forEach((v, i) => {
    if (v === null) {
      pen = false
      return
    }
    path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `
    pen = true
  })
  return path.trim()
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

/** GPA and cumulative GPA by term, and credits per term (M03 §5.3). Colors are `--chart-*` tokens. */
export default function ProgramChartsCard({ scope }: CardProps) {
  const { data } = useProgramGrades(scope.programId)
  const [revealed, setRevealed] = useState(false)
  if (!data) return null
  const terms: TermGradePoint[] = data.terms
  if (terms.every((t) => t.gpa === null)) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ChartLine aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.grading_charts_empty()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  const x = (i: number) =>
    terms.length === 1 ? W / 2 : PAD.left + (i / (terms.length - 1)) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (1 - v / data.max_points) * (H - PAD.top - PAD.bottom)
  const maxCredits = Math.max(...terms.map((t) => t.credits_counted), 0.5)
  const masked = data.hide_gpa && !revealed
  const barWidth = Math.min(36, (W - PAD.left - PAD.right) / terms.length - 8)
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
        <>
          <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
            <Legend color="var(--chart-1)" label={m.grading_term_gpa()} />
            <Legend color="var(--chart-2)" label={m.grading_cumulative_gpa()} />
          </div>
          {/* An SVG chart is an image for assistive tech; the <title>s give each point's value. */}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an SVG chart has no <img> form
            role="img"
            aria-label={m.grading_chart_gpa_label()}
            className="w-full"
          >
            {[0, 0.5, 1].map((f) => (
              <line
                key={f}
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(f * data.max_points)}
                y2={y(f * data.max_points)}
                stroke="var(--border)"
                strokeDasharray="3 3"
              />
            ))}
            <path
              d={linePath(
                terms.map((t) => t.cumulative_gpa),
                x,
                y,
              )}
              fill="none"
              stroke="var(--chart-2)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={linePath(
                terms.map((t) => t.gpa),
                x,
                y,
              )}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {terms.map((t, i) =>
              t.gpa === null ? null : (
                <circle key={t.term_id} cx={x(i)} cy={y(t.gpa)} r={3} fill="var(--chart-1)">
                  <title>{`${t.name}: ${formatGpa(t.gpa)}`}</title>
                </circle>
              ),
            )}
          </svg>
        </>
      )}
      <svg
        viewBox={`0 0 ${W} 60`}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an SVG chart has no <img> form
        role="img"
        aria-label={m.grading_chart_credits_label()}
        className="w-full"
      >
        {terms.map((t, i) => {
          const h = (t.credits_counted / maxCredits) * 44
          return (
            <rect
              key={t.term_id}
              x={x(i) - barWidth / 2}
              y={52 - h}
              width={barWidth}
              height={h}
              rx={4}
              fill="var(--chart-3)"
            >
              <title>{`${t.name}: ${formatCredits(t.credits_counted)}`}</title>
            </rect>
          )
        })}
      </svg>
      <ul className="flex justify-between gap-1 text-[11px] text-muted-foreground">
        {terms.map((t) => (
          <li key={t.term_id} className="min-w-0 truncate">
            {t.name}
          </li>
        ))}
      </ul>
    </div>
  )
}
