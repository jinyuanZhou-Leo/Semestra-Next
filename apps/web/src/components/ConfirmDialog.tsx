import type { ReactNode } from 'react'
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

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  pending?: boolean
  /** Keeps the confirm button off, e.g. until what will be deleted is known. */
  confirmDisabled?: boolean
  /**
   * Controls that sit under the description. Kept out of `AlertDialogDescription`,
   * which renders a paragraph.
   */
  extra?: ReactNode
  onConfirm: () => void
}

/** Second confirmation for destructive actions (M00 §4.8). Locks while the action runs. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  confirmDisabled,
  extra,
  onConfirm,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {extra}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{m.common_cancel()}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
          >
            {pending ? m.common_loading() : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
