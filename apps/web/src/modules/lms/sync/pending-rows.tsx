import type { SyncItem } from '@semestra/api-client'
import { ClipboardPlus, type LucideIcon, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatDate } from '@/lib/format'
import { m } from '@/paraglide/messages'
import type { SyncAnswers } from './answers'
import { fieldLabel } from './labels'
import { fieldIcon, Values } from './rows'

/**
 * What the sync asks of the user, one row per question (M09 §4.1), for the desktop panel and the
 * phone's sheet alike: each lays the rows out its own way, the rows themselves (what they say and
 * the answers they offer) are decided here once.
 */

/** One answer of a row. `main` is the answer the row suggests; `danger` asks first. */
export type RowAction = {
  id: string
  label: string
  tone: 'quiet' | 'main' | 'danger'
  disabled: boolean
  run: () => void
}

export type SyncRow = {
  key: string
  item: SyncItem
  icon: LucideIcon
  title: string
  detail: ReactNode
  actions: RowAction[]
}

type RowContext = {
  provider: string
  answers: SyncAnswers
  /** The connection is broken: nothing can be imported. */
  broken: boolean
  /** Imports these new items; without it (a phone: imports are reviewed on a computer) no import is offered. */
  onImport?: (items: SyncItem[]) => void
  /** Asks before deleting an item deleted on the platform. */
  onDelete: (item: SyncItem) => void
}

function importAction(
  item: SyncItem,
  { broken, onImport }: Omit<RowContext, 'onDelete'>,
): RowAction[] {
  return onImport
    ? [
        {
          id: 'import',
          label: m.lms_sync_import(),
          tone: 'main',
          disabled: broken,
          run: () => onImport([item]),
        },
      ]
    : []
}

const newDetail = (item: SyncItem) =>
  item.due_at
    ? m.lms_sync_panel_new_due({ due: formatDate(item.due_at, { short: true }) })
    : m.lms_sync_kind_new()

/**
 * What waits for the user: new assignments to import or ignore, assignments deleted on the
 * platform to keep or delete, and each field both sides changed.
 */
export function pendingRows(pending: readonly SyncItem[], context: RowContext): SyncRow[] {
  const { provider, answers, onDelete } = context
  const { busy } = answers
  return pending.flatMap((item): SyncRow[] => {
    if (item.kind === 'new')
      return [
        {
          key: item.id,
          item,
          icon: ClipboardPlus,
          title: item.title,
          detail: newDetail(item),
          actions: [
            {
              id: 'ignore',
              label: m.lms_sync_ignore(),
              tone: 'quiet',
              disabled: busy,
              run: () => answers.setDismissed([item], true),
            },
            ...importAction(item, context),
          ],
        },
      ]
    if (item.kind === 'removed')
      return [
        {
          key: item.id,
          item,
          icon: Trash2,
          title: item.title,
          detail: m.lms_sync_removed({ provider }),
          actions: [
            {
              id: 'keep',
              label: m.lms_sync_keep(),
              tone: 'quiet',
              disabled: busy,
              run: () => answers.settle(item, 'keep'),
            },
            {
              id: 'delete',
              label: m.lms_sync_delete(),
              tone: 'danger',
              disabled: busy,
              run: () => onDelete(item),
            },
          ],
        },
      ]
    return (item.conflicts ?? []).map((conflict) => ({
      key: `${item.id}:${conflict.field}`,
      item,
      icon: fieldIcon(conflict.field),
      title: m.lms_sync_change({ title: item.title, field: fieldLabel(conflict.field) }),
      detail: (
        <>
          <Values field={conflict.field} from={conflict.mine} to={conflict.platform} />
          {conflict.edited ? ` · ${m.lms_sync_yours_changed()}` : null}
        </>
      ),
      actions: [
        {
          id: 'keep',
          label: m.lms_sync_keep(),
          tone: 'quiet',
          disabled: busy,
          run: () => answers.resolveField(item.id, conflict.field, 'mine'),
        },
        {
          id: 'update',
          label: m.lms_sync_update(),
          tone: 'main',
          disabled: busy,
          run: () => answers.resolveField(item.id, conflict.field, 'platform'),
        },
      ],
    }))
  })
}

/** New items the user ignored: each can be asked about again, or imported. */
export function ignoredRows(
  ignored: readonly SyncItem[],
  context: Omit<RowContext, 'onDelete'>,
): SyncRow[] {
  const { answers } = context
  return ignored.map((item) => ({
    key: item.id,
    item,
    icon: ClipboardPlus,
    title: item.title,
    detail: m.lms_sync_kind_new(),
    actions: [
      {
        id: 'remind',
        label: m.lms_sync_remind(),
        tone: 'quiet',
        disabled: answers.busy,
        run: () => answers.setDismissed([item], false),
      },
      ...importAction(item, context),
    ],
  }))
}
