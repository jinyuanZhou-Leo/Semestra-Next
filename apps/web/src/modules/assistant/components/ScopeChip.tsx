import type { AgentScope } from '@semestra/api-client'
import { ChevronDown, FolderOpen } from 'lucide-react'
import { courseTermId } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { programScope, termScope, termsForScope, useProgramEntities, useScopeLabel } from '../scope'

const PROGRAM = 'program'

/**
 * Where the assistant works (M12 §6.1): the whole Program or one of its terms, like the project
 * it is working in. The button shows the place's name, e.g. "Fall 2026".
 */
export function ScopeChip({
  scope,
  programId,
  onChange,
}: {
  scope: AgentScope | null
  /** The Program to offer when the conversation has no scope yet. */
  programId: string | undefined
  onChange: (scope: AgentScope) => void
}) {
  const program = scope?.program_id ?? programId
  const label = useScopeLabel(scope)
  const { terms, courses } = useProgramEntities(program)
  const name = scope ? (label ?? '…') : m.assistant_scope_none()
  const oldCourse = scope?.course_id ? courses.find((c) => c.id === scope.course_id) : undefined
  // Older conversations may name a course (some without its term): they check its term.
  const value =
    scope?.term_id ??
    (oldCourse
      ? courseTermId(oldCourse, terms, undefined)
      : scope && !scope.course_id
        ? PROGRAM
        : '')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="max-w-full min-w-0 text-muted-foreground"
            aria-label={m.assistant_scope_label({ scope: name })}
            disabled={!program}
          />
        }
      >
        <FolderOpen aria-hidden />
        <span className="truncate">{name}</span>
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{m.assistant_scope_menu()}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next: string) => {
              if (!program) return
              onChange(next === PROGRAM ? programScope(program) : termScope(program, next))
            }}
          >
            <DropdownMenuRadioItem value={PROGRAM}>
              {m.assistant_scope_program()}
            </DropdownMenuRadioItem>
            {termsForScope(terms).map((term) => (
              <DropdownMenuRadioItem key={term.id} value={term.id}>
                <span className="truncate">{term.name}</span>
                {term.is_current ? (
                  <Badge variant="secondary">{m.assistant_scope_current()}</Badge>
                ) : null}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
