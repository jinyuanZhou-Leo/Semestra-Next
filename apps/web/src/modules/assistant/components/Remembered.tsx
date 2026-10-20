import { agentMemoryDeleteMutation, agentMemoryListOptions } from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark } from 'lucide-react'
import { invalidateOperations } from '@/app/api'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { MEMORY_QUERIES } from '../memory'
import type { Step } from '../transcript'

/**
 * Under an answer that saved memories: "Remembered: …" with an undo link, for each one that is
 * still saved (M12 记忆). Memory calls run without a card, so this is where the user sees them.
 */
export function Remembered({ steps }: { steps: Step[] }) {
  const saved = steps.flatMap((step) => (step.memory ? [step.memory] : []))
  const memories = useQuery({ ...agentMemoryListOptions(), enabled: saved.length > 0 })
  const queryClient = useQueryClient()
  const undo = useMutation({
    ...agentMemoryDeleteMutation(),
    onError: toastError,
    onSettled: () => invalidateOperations(queryClient, MEMORY_QUERIES),
  })
  const kept = new Set(memories.data?.items.map((memory) => memory.id) ?? [])
  const shown = saved.filter((memory) => kept.has(memory.id))
  if (shown.length === 0) return null
  return (
    <ul className="space-y-1">
      {shown.map((memory) => (
        <li
          key={memory.id}
          className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Bookmark aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            {m.assistant_memory_remembered({ content: memory.content })}
          </span>
          <span aria-hidden>·</span>
          <Button
            variant="link"
            size="xs"
            className="h-auto shrink-0 p-0 text-xs"
            disabled={undo.isPending}
            onClick={() => undo.mutate({ path: { id: memory.id } })}
          >
            {m.assistant_memory_undo()}
          </Button>
        </li>
      ))}
    </ul>
  )
}
