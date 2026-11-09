import { academicsProgramCreateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { newTermPath } from '../paths'
import { invalidateAcademics } from '../queries'
import { ProgramForm } from './ProgramForm'

/** "New Program" from the Program switcher or the account menu; opens its term wizard next. */
export function CreateProgramDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const create = useMutation({
    ...academicsProgramCreateMutation(),
    onError: toastError,
    onSuccess: async (program) => {
      await invalidateAcademics(queryClient)
      onOpenChange(false)
      router.history.push(newTermPath(program.id))
    },
  })
  return (
    <Dialog open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{m.academics_program_new()}</DialogTitle>
          <DialogDescription>{m.academics_program_new_description()}</DialogDescription>
        </DialogHeader>
        {open ? (
          <ProgramForm
            footer={
              <DialogFooter>
                <DialogClose
                  render={<Button type="button" variant="outline" disabled={create.isPending} />}
                >
                  {m.common_cancel()}
                </DialogClose>
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? m.common_saving() : m.academics_program_create()}
                </Button>
              </DialogFooter>
            }
            onSubmit={(body) => create.mutate({ body })}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
