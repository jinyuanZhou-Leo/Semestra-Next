import type { Task } from '@semestra/api-client'
import { NotebookPen } from 'lucide-react'
import { HistoryLink } from '@/components/HistoryLink'
import { formatCredits } from '@/lib/format'
import { coursePath } from '@/modules/academics/paths'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { categoryName, maskedPercentText } from '../display'
import { useGradebook } from '../queries'

/**
 * The assessment an assessment's to-do belongs to, in the to-do's details (contributed to
 * `tasks.detailSections`): its category and weight, its score, and a way to its gradebook row.
 */
export default function TaskGradebook({ task, onClose }: { task: Task; onClose: () => void }) {
  if (!task.assessment_id || !task.course_id) return null
  return (
    <Gradebook
      assessmentId={task.assessment_id}
      programId={task.program_id}
      courseId={task.course_id}
      onClose={onClose}
    />
  )
}

function Gradebook({
  assessmentId,
  programId,
  courseId,
  onClose,
}: {
  assessmentId: string
  programId: string
  courseId: string
  onClose: () => void
}) {
  const gradebook = useGradebook(courseId).data
  const assessment = gradebook?.assessments.find((a) => a.id === assessmentId)
  const category = gradebook?.categories.find((c) => c.id === assessment?.category_id)
  const details = assessment
    ? [
        category ? categoryName(category) : null,
        m.grading_task_weight({ weight: formatCredits(assessment.weight) }),
        assessment.dropped
          ? m.grading_assessment_drop()
          : assessment.score_percentage === null
            ? m.grading_task_ungraded()
            : maskedPercentText(assessment.score_percentage, gradebook?.scale.hide_gpa ?? false),
      ].filter((part) => part !== null)
    : []
  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">
        <NotebookPen aria-hidden />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{m.grading_task_gradebook()}</ItemTitle>
        {/* The line keeps its height while the gradebook loads, so the panel does not jump. */}
        <ItemDescription>{details.length ? details.join(' · ') : ' '}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <HistoryLink
              href={`${coursePath(programId, courseId, 'grades')}?assessment=${encodeURIComponent(assessmentId)}`}
              onClick={onClose}
            />
          }
        >
          {m.grading_task_open()}
        </Button>
      </ItemActions>
    </Item>
  )
}
