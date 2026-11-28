import { MobileSection } from '@/app/mobile/MobilePage'
import { m } from '@/paraglide/messages'
import { Skeleton } from '@/ui/skeleton'
import { GpaValue, HideGrades } from '../components/GradeValue'
import { useProgramGrades, useTermGrades } from '../queries'

/**
 * The grade summary over the phone's course list (M17 §4.1): the cumulative GPA and the term's,
 * hidden like everywhere else while the Program hides grades. No charts.
 */
export default function GradeSummarySection({
  programId,
  termId,
}: {
  programId: string
  termId: string | undefined
}) {
  const program = useProgramGrades(programId).data
  const term = useTermGrades(termId ?? '')
  const termData = termId ? term.data : undefined
  return (
    <MobileSection title={m.mobile_grades_summary()}>
      {program ? (
        <HideGrades hidden={program.hide_grades}>
          <dl className="grid grid-cols-2 divide-x overflow-hidden rounded-2xl border bg-card">
            <Figure label={m.grading_cumulative_gpa()}>
              <GpaValue value={program.gpa} />
            </Figure>
            <Figure label={m.grading_term_gpa()}>
              {termData ? <GpaValue value={termData.gpa} /> : '—'}
            </Figure>
          </dl>
        </HideGrades>
      ) : (
        <Skeleton className="h-20 rounded-2xl" />
      )}
    </MobileSection>
  )
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-heading text-2xl font-semibold tabular-nums">{children}</dd>
    </div>
  )
}
