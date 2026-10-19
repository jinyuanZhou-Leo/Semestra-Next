import type { AgentScope } from '@semestra/api-client'
import { ChevronDown, MapPin } from 'lucide-react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { sameScope, scopeKind, useScopeLabel } from '../scope'

/**
 * The context the assistant works in (M12 §6.1), e.g. "APS105 · Fall 2026": switch to the page
 * on screen, widen to the Program, or drop it.
 */
export function ScopeChip({
  scope,
  pageScope,
  onChange,
}: {
  scope: AgentScope | null
  pageScope: AgentScope | null
  onChange: (scope: AgentScope | null) => void
}) {
  const label = useScopeLabel(scope)
  const pageLabel = useScopeLabel(pageScope)
  const offerPage = pageScope !== null && !sameScope(scope, pageScope)
  const offerProgram = scope !== null && scopeKind(scope) !== 'program'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="max-w-full min-w-0 text-muted-foreground"
            aria-label={m.assistant_context_label({ context: label ?? m.assistant_context_none() })}
          />
        }
      >
        <MapPin aria-hidden />
        <span className="truncate">{scope ? (label ?? '…') : m.assistant_context_none()}</span>
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-48">
        {offerPage ? (
          <DropdownMenuItem onClick={() => onChange(pageScope)}>
            {m.assistant_context_use_page({ context: pageLabel ?? '…' })}
          </DropdownMenuItem>
        ) : null}
        {offerProgram && scope ? (
          <DropdownMenuItem
            onClick={() =>
              onChange({ program_id: scope.program_id, term_id: null, course_id: null })
            }
          >
            {m.assistant_context_program()}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem disabled={scope === null} onClick={() => onChange(null)}>
          {m.assistant_context_remove()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
