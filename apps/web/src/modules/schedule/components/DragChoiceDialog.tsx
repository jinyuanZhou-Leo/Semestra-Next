import { m } from '@/paraglide/messages'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog'

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
          <AlertDialogCancel variant="ghost" disabled={pending}>
            {m.common_cancel()}
          </AlertDialogCancel>
          {allowAll ? (
            <AlertDialogAction variant="outline" disabled={pending} onClick={onAll}>
              {m.schedule_drag_all()}
            </AlertDialogAction>
          ) : null}
          <AlertDialogAction disabled={pending} onClick={onOnlyThis}>
            {m.schedule_drag_only_this()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
