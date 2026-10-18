import { m } from '@/paraglide/messages'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog'
import { Button } from '@/ui/button'

/**
 * Asked after a class is dragged to a new time (M04 §5.2): change only this class (an
 * exception) or the whole meeting. Closing it without a choice puts the class back.
 */
export function DragChoiceDialog({
  open,
  allowAll,
  pending,
  onOnlyThis,
  onAll,
  onCancel,
}: {
  open: boolean
  /** False for a class that was already moved: only that one can change. */
  allowAll: boolean
  pending: boolean
  onOnlyThis: () => void
  onAll: () => void
  onCancel: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && !pending && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.schedule_drag_title()}</AlertDialogTitle>
          <AlertDialogDescription>{m.schedule_drag_description()}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="ghost" disabled={pending} onClick={onCancel}>
            {m.common_cancel()}
          </Button>
          {allowAll ? (
            <Button variant="outline" disabled={pending} onClick={onAll}>
              {m.schedule_drag_all()}
            </Button>
          ) : null}
          <Button disabled={pending} onClick={onOnlyThis}>
            {m.schedule_drag_only_this()}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
