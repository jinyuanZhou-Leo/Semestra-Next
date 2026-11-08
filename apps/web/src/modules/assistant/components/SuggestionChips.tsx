import type { AgentScope, Course, Suggestion } from '@semestra/api-client'
import { agentSuggestionListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { courseLabel } from '@/modules/academics/color'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import type { MessageReference } from '../prompt'

/** The question in the small model's words, or the template for its fact. */
function wording(s: Suggestion): string {
  if (s.text) return s.text
  const title = s.params?.title ?? ''
  const course = s.params?.course ?? ''
  switch (s.code) {
    case 'overdue':
      return m.assistant_suggestion_overdue({ title })
    case 'due_today':
      return m.assistant_suggestion_due_today({ title })
    case 'due_tomorrow':
      return m.assistant_suggestion_due_tomorrow({ title })
    case 'due_soon':
      return m.assistant_suggestion_due_soon({ title })
    case 'classes_today':
      return m.assistant_suggestion_classes_today()
    case 'import_syllabus':
      return m.assistant_suggestion_import_syllabus({ course })
    case 'grade_target':
      return m.assistant_suggestion_grade_target({ course })
    case 'term_gpa':
      return m.assistant_suggest_term_gpa()
    case 'gpa':
      return m.assistant_suggest_gpa()
    default:
      return m.assistant_suggest_week_deadlines()
  }
}

/** The course the question names becomes an `@` reference, so Sem need not guess which. */
function asPrompt(
  text: string,
  course: Course | undefined,
): { text: string; references: MessageReference[] } {
  const label = course ? courseLabel(course) : ''
  const at = label ? text.indexOf(label) : -1
  if (!course || at < 0) return { text, references: [] }
  return {
    text: `${text.slice(0, at)}@${text.slice(at)}`,
    references: [{ kind: 'course', id: course.id, label }],
  }
}

/**
 * Starting points above the input of a new conversation (M12 §6.1): from what is due, today's
 * classes and the gradebook, in the light-task model's words when the account allows it.
 */
export function SuggestionChips({
  scope,
  courses,
  disabled,
  onPick,
}: {
  scope: AgentScope
  courses: Course[]
  disabled: boolean
  onPick: (prompt: { text: string; references: MessageReference[] }) => void
}) {
  const { data } = useQuery({
    ...agentSuggestionListOptions({
      query: { program_id: scope.program_id, term_id: scope.term_id },
    }),
    // Deadlines and grades change without an event for this list.
    refetchOnMount: 'always',
  })
  // Holds the row's height while loading, so the input does not jump.
  if (!data) return <div className="h-8" aria-hidden />
  return (
    <div className="flex scroll-fade-x scrollbar-none gap-2 overflow-x-auto overscroll-x-contain">
      {data.items.map((s) => {
        const text = wording(s)
        return (
          <Button
            key={s.key}
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={disabled}
            onClick={() =>
              onPick(
                asPrompt(
                  text,
                  courses.find((c) => c.id === s.course_id),
                ),
              )
            }
          >
            {text}
          </Button>
        )
      })}
    </div>
  )
}
