import { Plus } from 'lucide-react'
import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { openNewTask } from '../new-task'
import { parseSelection } from '../types'
import type { ListCardSettings } from './schema'

/** The card header's add button: opens the new row at the end of the card's tasks. */
export default function NewTaskButton({ instanceId, settings }: CardProps<unknown>) {
  // A list card showing finished tasks has nothing to add to.
  const source = (settings as Partial<ListCardSettings> | undefined)?.source
  const selection = parseSelection(source)
  if (selection.kind === 'smart' && selection.view === 'completed') return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={m.tasks_new_row()}
            className="text-muted-foreground"
            onClick={() => openNewTask(instanceId)}
          />
        }
      >
        <Plus aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{m.tasks_new_row()}</TooltipContent>
    </Tooltip>
  )
}
