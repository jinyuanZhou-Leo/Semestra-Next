import { createContext, use, useState } from 'react'
import { Checkbox } from '@/ui/checkbox'

/**
 * The rows of a table checked for a batch action (M00 §4.8). Only rows on screen count: a row
 * that a filter or a collapsed group hides stays out of the batch, and comes back checked when it
 * shows again.
 */
export type RowSelection = {
  /** The checked rows on screen, in the order they are shown. */
  ids: readonly string[]
  has: (id: string) => boolean
  /** Whether all of `ids` are checked; `'some'` when only part of them are. */
  state: (ids: readonly string[]) => boolean | 'some'
  /** Checks them all, or unchecks them all when they already are. */
  toggle: (ids: readonly string[]) => void
  clear: () => void
  /** The ids of every row on screen: the header checkbox's rows. */
  shown: readonly string[]
}

/** The selection of a table whose rows on screen are `shown`. */
export function useRowSelection(shown: readonly string[]): RowSelection {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  return {
    ids: shown.filter((id) => checked.has(id)),
    has: (id) => checked.has(id),
    state: (ids) => {
      const count = ids.filter((id) => checked.has(id)).length
      return count === 0 ? false : count === ids.length ? true : 'some'
    },
    toggle: (ids) =>
      setChecked((prev) => {
        const next = new Set(prev)
        const all = ids.every((id) => prev.has(id))
        for (const id of ids) {
          if (all) next.delete(id)
          else next.add(id)
        }
        return next
      }),
    clear: () => setChecked(new Set()),
    shown,
  }
}

/**
 * The selection, for the checkboxes alone. It is a context of its own, apart from whatever else
 * the table's cells read: checking a row then renders the checkboxes and that row (a memoized row
 * component given `selected`) again, not every cell of every row, which makes checking rows of a
 * long table stutter.
 */
export const RowSelectionContext = createContext<RowSelection | null>(null)

/** A checkbox for a set of rows: one row, a group's rows, or every row shown. */
export function SelectCheckbox({ ids, label }: { ids: readonly string[]; label: string }) {
  const selection = use(RowSelectionContext)
  if (!selection) throw new Error('SelectCheckbox renders inside RowSelectionContext')
  const state = selection.state(ids)
  return (
    <Checkbox
      aria-label={label}
      className="align-middle"
      checked={state === true}
      indeterminate={state === 'some'}
      disabled={ids.length === 0}
      onCheckedChange={() => selection.toggle(ids)}
    />
  )
}

/** The header's checkbox: every row on screen. */
export function SelectAllCheckbox({ label }: { label: string }) {
  const selection = use(RowSelectionContext)
  if (!selection) throw new Error('SelectAllCheckbox renders inside RowSelectionContext')
  return <SelectCheckbox ids={selection.shown} label={label} />
}
