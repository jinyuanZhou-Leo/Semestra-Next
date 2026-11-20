import { useQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useExtensions } from '@/app/registry'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/button'
import { DropdownMenuItem } from '@/ui/dropdown-menu'
import { type LinkedTask, TASK_LINKS, type TaskLink } from '../types'

type Shape = 'pill' | 'button' | 'item'

function Link({
  link,
  task,
  shape,
  className,
  onOpen,
}: {
  link: TaskLink
  task: LinkedTask
  shape: Shape
  className?: string
  onOpen?: () => void
}) {
  const router = useRouter()
  const { data } = useQuery(link.query({ programId: task.program_id }))
  const open = data === undefined ? null : link.open(task, data, router)
  if (!open) return null
  const run = () => {
    onOpen?.()
    open()
  }
  if (shape === 'item') {
    return (
      <DropdownMenuItem onClick={run}>
        <link.icon aria-hidden />
        {link.action()}
      </DropdownMenuItem>
    )
  }
  if (shape === 'button') {
    return (
      <Button type="button" variant="outline" className={className} onClick={run}>
        <link.icon aria-hidden />
        {link.action()}
      </Button>
    )
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className={cn('shrink-0 rounded-full font-normal text-foreground', className)}
      onClick={(event) => {
        // The row under it opens its own details on a click.
        event.stopPropagation()
        run()
      }}
    >
      <link.icon aria-hidden className="text-muted-foreground" />
      {link.label()}
    </Button>
  )
}

/**
 * A to-do's ways to what it came from (`tasks.links`), in one of the shapes the to-dos show
 * them in: a labelled pill that is always there (not an icon that shows on hover), a button
 * that says what it does, or an item of the ⋯ menu. `onOpen` runs as one opens (what holds it
 * closes for it). Nothing for a to-do without any.
 */
export function TaskLinks({
  task,
  shape,
  className,
  onOpen,
}: {
  task: LinkedTask
  shape: Shape
  className?: string
  onOpen?: () => void
}) {
  const links = useExtensions<TaskLink>(TASK_LINKS)
  return links.map((link) => (
    <Link
      key={link.id}
      link={link}
      task={task}
      shape={shape}
      className={className}
      onOpen={onOpen}
    />
  ))
}
