import type { ItemOut } from '@semestra/api-client'
import { useExtensions } from '@/app/registry'
import { Button } from '@/ui/button'
import { FILE_ITEM_ACTIONS, type FileItemAction } from '../types'

/** The entries other modules add for this file (`files.itemActions`, M07 §6.1). */
export function useItemActions(item: ItemOut): FileItemAction[] {
  return useExtensions<FileItemAction>(FILE_ITEM_ACTIONS).filter((a) => a.accepts(item))
}

/** One of them as a button: in the preview's title bar, or in place of a preview. */
export function ItemActionButton({
  action,
  item,
  programId,
  variant = 'outline',
}: {
  action: FileItemAction
  item: ItemOut
  programId: string
  variant?: 'default' | 'outline'
}) {
  return (
    <Button size="sm" variant={variant} onClick={() => void action.run({ programId, item })}>
      <action.icon aria-hidden />
      <action.Label programId={programId} item={item} />
    </Button>
  )
}
