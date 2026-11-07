import type { Course, TaskCreateInputBody } from '@semestra/api-client'
import { useState } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/ui/drawer'
import { Input } from '@/ui/input'
import { Textarea } from '@/ui/textarea'
import { type ChipValues, TaskChips } from '../components/TaskChips'
import { type NewTaskPlace, newTaskBody } from '../new-task'

/**
 * A new task on a phone (M17), in a drawer from the bottom: the title, the notes and the same
 * chips as on a computer (date, priority, course, flag), starting from the list it is added to.
 * The keyboard's return adds it and keeps the drawer open for the next one; Add adds and closes.
 */
export function NewTaskSheet({
  open,
  onClose,
  place,
  courses,
  today,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  place: NewTaskPlace
  courses: readonly Course[]
  today: string
  onAdd: (body: TaskCreateInputBody) => Promise<unknown>
}) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [values, setValues] = useState<ChipValues>(place.initial)
  const reset = () => {
    setTitle('')
    setNotes('')
    setValues(place.initial)
  }
  const add = () => {
    const next = title.trim()
    if (!next) return false
    const body = newTaskBody(place, { title: next, notes, values })
    reset()
    void onAdd(body).catch(() => setTitle((current) => current || next))
    return true
  }
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (next) return
        // Closed without adding: what was typed is dropped, so it opens empty next time.
        reset()
        onClose()
      }}
      showSwipeHandle
    >
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="sr-only">{m.tasks_new_row()}</DrawerTitle>
        </DrawerHeader>
        <form
          className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
          onSubmit={(event) => {
            event.preventDefault()
            if (add()) onClose()
          }}
        >
          <div className="flex flex-col gap-1">
            <Input
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the drawer opens to type a task
              autoFocus
              value={title}
              maxLength={300}
              enterKeyHint="next"
              placeholder={m.tasks_new_row()}
              aria-label={m.tasks_new_row()}
              className="h-11 border-0 bg-transparent px-0 text-lg font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                event.preventDefault()
                add()
              }}
            />
            <Textarea
              value={notes}
              maxLength={20000}
              placeholder={m.tasks_notes_label()}
              aria-label={m.tasks_notes_label()}
              className="min-h-0 resize-none border-0 bg-transparent px-0 py-0 text-base text-muted-foreground shadow-none focus-visible:ring-0 dark:bg-transparent"
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          <TaskChips
            task={values}
            courses={courses}
            today={today}
            overdue={values.due_date !== null && values.due_date < today}
            onChange={(body) => setValues((current) => ({ ...current, ...body }) as ChipValues)}
          />
          <Button type="submit" className="h-11" disabled={!title.trim()}>
            {m.mobile_task_add()}
          </Button>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
