import { agentMemoryDeleteMutation, agentMemoryListOptions } from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, BookmarkX } from 'lucide-react'
import { invalidateOperations } from '@/app/api'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { MEMORY_QUERIES } from '../memory'
import type { RememberedMemory } from '../stream'
import type { Step } from '../transcript'

/**
 * Under an answer that changed memories (M12 记忆): "Remembered: …" with an undo link, for each
 * memory it saved that is still saved (in its current wording), and "Forgot: …" for each one it
 * deleted. Memory calls run without a card, so this is where the user sees them.
 */
export function Remembered({ steps }: { steps: Step[] }) {
  const changes = steps.flatMap((step) => (step.memory ? [step.memory] : []))
  const saved = changes.filter((change) => change.action !== 'forgot')
  const memories = useQuery({ ...agentMemoryListOptions(), enabled: saved.length > 0 })
  const queryClient = useQueryClient()
  const undo = useMutation({
    ...agentMemoryDeleteMutation(),
    onError: toastError,
    onSettled: () => invalidateOperations(queryClient, MEMORY_QUERIES),
  })
  const current = new Map(memories.data?.items.map((memory) => [memory.id, memory]) ?? [])
  const shown = changes.flatMap((change): RememberedMemory[] => {
    if (change.action === 'forgot') return [change]
    const row = current.get(change.id)
    return row ? [{ ...change, content: row.content }] : []
  })
  if (shown.length === 0) return null
  return (
    <ul className="space-y-1">
      {shown.map((change) => (
        <li
          key={`${change.action ?? 'remembered'}-${change.id}`}
          className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
        >
          {change.action === 'forgot' ? (
            <>
              <BookmarkX aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">
                {m.assistant_memory_forgot({ content: change.content })}
              </span>
            </>
          ) : (
            <>
              <Bookmark aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">
                {m.assistant_memory_remembered({ content: change.content })}
              </span>
              <span aria-hidden>·</span>
              <Button
                variant="link"
                size="xs"
                className="h-auto shrink-0 p-0 text-xs"
                disabled={undo.isPending}
                onClick={() => undo.mutate({ path: { id: change.id } })}
              >
                {m.assistant_memory_undo()}
              </Button>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}
