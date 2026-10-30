import { ArrowUp, CalendarDays, Plus, X } from 'lucide-react'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/ui/input-group'
import { PRIORITY_NAMES, PriorityMarks } from '../components/priority'
import { dueLabel } from '../due'
import { type NewTask, useQuickAdd } from '../quick-add'
import { shownPriority } from '../types'

/**
 * The phone's add line (M17), kept above the tab bar: the same reading of dates and `!` marks
 * as the desktop's quick add, with what was read shown as chips above the field.
 */
export function QuickAddBar({
  programId,
  defaultDue,
  onAdd,
}: {
  programId: string
  defaultDue?: string
  onAdd: (task: NewTask) => Promise<unknown>
}) {
  const add = useQuickAdd({ programId, defaultDue, onAdd })
  const { parsed, ignoreDate, ignorePriority } = add
  const level = shownPriority(add.readPriority ?? 'none')
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        void add.submit()
      }}
    >
      {parsed.dateText || parsed.priorityText ? (
        <div className="flex flex-wrap gap-1.5">
          {parsed.dateText ? (
            <Chip
              undone={ignoreDate}
              icon={<CalendarDays aria-hidden />}
              label={
                ignoreDate
                  ? parsed.dateText
                  : dueLabel({ due_date: parsed.dueDate, due_time: parsed.dueTime }, add.today)
              }
              undoLabel={m.tasks_quick_add_undo({ text: parsed.dateText })}
              onToggle={add.toggleDate}
            />
          ) : null}
          {parsed.priorityText ? (
            <Chip
              undone={ignorePriority}
              icon={<PriorityMarks level={ignorePriority ? 'none' : level} placeholder />}
              label={ignorePriority ? parsed.priorityText : PRIORITY_NAMES[level]()}
              undoLabel={m.tasks_quick_add_undo({ text: parsed.priorityText })}
              onToggle={add.togglePriority}
            />
          ) : null}
        </div>
      ) : null}
      <InputGroup className="h-11 rounded-full">
        <InputGroupAddon>
          <Plus aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          value={add.text}
          maxLength={400}
          enterKeyHint="done"
          placeholder={m.tasks_quick_add_placeholder()}
          aria-label={m.tasks_quick_add_label()}
          // Phones zoom into fields under 16px.
          className="text-base"
          onChange={(event) => add.setText(event.target.value)}
        />
        {parsed.title ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              className="rounded-full"
              aria-label={m.tasks_quick_add_label()}
            >
              <ArrowUp aria-hidden />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </form>
  )
}

function Chip({
  label,
  icon,
  undone,
  undoLabel,
  onToggle,
}: {
  label: string
  icon: React.ReactNode
  undone: boolean
  undoLabel: string
  onToggle: () => void
}) {
  return (
    <Badge variant={undone ? 'outline' : 'secondary'} className="h-7 gap-1 pr-1 pl-2.5">
      {icon}
      <span className={undone ? 'line-through' : undefined}>{label}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="size-5"
        aria-label={undoLabel}
        aria-pressed={undone}
        onClick={onToggle}
      >
        <X aria-hidden />
      </Button>
    </Badge>
  )
}
