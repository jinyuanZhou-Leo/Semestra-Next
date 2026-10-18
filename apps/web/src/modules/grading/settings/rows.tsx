import type { ReactNode } from 'react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/ui/item'
import { Label } from '@/ui/label'

/** One setting: label and help text on the left, the control on the right (wraps when narrow). */
export function SettingRow({
  label,
  labelId,
  description,
  children,
}: {
  label: string
  /** The control points `aria-labelledby` at this id. */
  labelId: string
  description?: string
  children: ReactNode
}) {
  return (
    <Item>
      <ItemContent className="min-w-0 basis-64">
        <ItemTitle>
          <Label id={labelId}>{label}</Label>
        </ItemTitle>
        {description ? <ItemDescription>{description}</ItemDescription> : null}
      </ItemContent>
      <ItemActions>{children}</ItemActions>
    </Item>
  )
}
