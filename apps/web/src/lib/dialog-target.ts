import { useState } from 'react'

/**
 * The thing a dialog is about (the row to delete, the item to edit) and whether it is open, kept
 * apart (M00 §4.8): closing only turns `open` off, and the target is forgotten once the closing
 * animation has finished, so the dialog keeps its form and text while it fades out. Spread `props`
 * on the `Dialog`, `AlertDialog` or `ConfirmDialog`.
 */
export function useDialogTarget<T>() {
  const [state, setState] = useState<{ target: T | null; open: boolean }>({
    target: null,
    open: false,
  })
  const close = () => setState((current) => ({ ...current, open: false }))
  return {
    target: state.target,
    open: state.open,
    show: (target: T) => setState({ target, open: true }),
    close,
    props: {
      open: state.open,
      onOpenChange: (open: boolean) => {
        if (!open) close()
      },
      onOpenChangeComplete: (open: boolean) => {
        if (!open) setState((current) => (current.open ? current : { target: null, open: false }))
      },
    },
  }
}

/** What `useDialogTarget().props` spreads, for a dialog component that takes them through. */
export type DialogTargetProps = ReturnType<typeof useDialogTarget>['props']
