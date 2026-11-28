import type { Assessment } from '@semestra/api-client'
import { ChevronRight, ClipboardList } from 'lucide-react'
import type { ReactNode } from 'react'
import type { PageProps } from '@/app/extensions'
import { MobileList, MobileSection } from '@/app/mobile/MobilePage'
import { useExtensions } from '@/app/registry'
import { formatCredits } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Skeleton } from '@/ui/skeleton'
import { Concealed, HideGrades, PercentValue } from '../components/GradeValue'
import { categoryName, dueText } from '../display'
import { useGradebook } from '../queries'
import { MOBILE_ASSESSMENT_OPENERS, type MobileAssessmentOpener } from '../types'
import { phoneGrade } from './headline'

/**
 * A course's grades on a phone (M17 §4.1), read only: the grade so far, then each category's
 * assessments with their scores. A row with something to open (the platform assignment's
 * submission and feedback) opens it. Editing and planning stay on the desktop.
 */
export default function CourseGradesMobile({ scope }: PageProps) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const data = useGradebook(courseId).data
  const openers = useExtensions<MobileAssessmentOpener>(MOBILE_ASSESSMENT_OPENERS)
  if (!data) {
    return (
      <MobileSection title={m.grading_current_grade()}>
        <Skeleton className="h-24 rounded-2xl" />
      </MobileSection>
    )
  }
  const { summary: s, scale, categories, assessments } = data
  const grade = phoneGrade(data)
  if (grade.gradebook && assessments.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClipboardList aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.mobile_grades_empty()}</EmptyTitle>
          <EmptyDescription>{m.mobile_grades_empty_description()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  const groups = [
    ...categories
      .filter((c) => !c.archived)
      .map((c) => ({
        id: c.id,
        title: categoryName(c),
        items: assessments.filter((a) => a.category_id === c.id),
      })),
    {
      id: 'none',
      title: m.grading_category_none(),
      items: assessments.filter(
        (a) => a.category_id === null || !categories.some((c) => c.id === a.category_id),
      ),
    },
  ].filter((g) => g.items.length > 0)
  return (
    <HideGrades hidden={scale.hide_grades}>
      <MobileSection title={grade.label}>
        <div className="flex items-end justify-between gap-3 rounded-2xl border bg-card px-4 py-3">
          <div>
            <div className="font-heading text-3xl font-semibold tabular-nums">{grade.value}</div>
            {grade.gpa ? (
              <div className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                {m.grading_gpa()} {grade.gpa}
              </div>
            ) : null}
          </div>
          {grade.gradebook ? (
            <div className="text-right text-xs text-muted-foreground tabular-nums">
              {m.mobile_grades_graded_weight({
                graded: formatCredits(s.graded_weight),
                total: formatCredits(s.weight_total),
              })}
            </div>
          ) : null}
        </div>
      </MobileSection>
      {(grade.gradebook ? groups : []).map((group) => (
        <MobileSection key={group.id} title={group.title}>
          <MobileList label={group.title}>
            {group.items.map((a) => (
              <li key={a.id}>
                <Opened openers={openers} assessment={a} programId={scope.programId}>
                  {(open) =>
                    open ? (
                      <button type="button" className="w-full text-left" onClick={open}>
                        <AssessmentRow assessment={a} chevron />
                      </button>
                    ) : (
                      <AssessmentRow assessment={a} chevron={false} />
                    )
                  }
                </Opened>
              </li>
            ))}
          </MobileList>
        </MobileSection>
      ))}
    </HideGrades>
  )
}

/** Asks each contribution in turn what the assessment opens; the first that has something wins. */
function Opened({
  openers,
  assessment,
  programId,
  children,
}: {
  openers: MobileAssessmentOpener[]
  assessment: Assessment
  programId: string
  children: (open: (() => void) | null) => ReactNode
}) {
  const [first, ...rest] = openers
  if (!first) return children(null)
  return (
    <first.Opener assessment={assessment} programId={programId}>
      {(open) =>
        open ? (
          children(open)
        ) : (
          <Opened openers={rest} assessment={assessment} programId={programId}>
            {children}
          </Opened>
        )
      }
    </first.Opener>
  )
}

function AssessmentRow({ assessment: a, chevron }: { assessment: Assessment; chevron: boolean }) {
  const graded = a.status === 'graded'
  return (
    <div className={cn('flex min-h-14 items-center gap-3 px-4 py-2.5', a.dropped && 'opacity-55')}>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate font-medium', a.dropped && 'line-through')}>{a.title}</div>
        <div className="truncate text-xs text-muted-foreground tabular-nums">
          {[
            m.grading_task_weight({ weight: formatCredits(a.weight) }),
            a.due_date ? dueText(a) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      <div className="shrink-0 text-right tabular-nums">
        {graded ? (
          <>
            <div className="font-medium">
              <PercentValue value={a.score_percentage} />
            </div>
            {a.points_earned != null && a.points_possible ? (
              <div className="text-xs text-muted-foreground">
                <Concealed>
                  {formatCredits(a.points_earned)} / {formatCredits(a.points_possible)}
                </Concealed>
              </div>
            ) : null}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{m.grading_task_ungraded()}</span>
        )}
      </div>
      {chevron ? (
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      ) : null}
    </div>
  )
}
