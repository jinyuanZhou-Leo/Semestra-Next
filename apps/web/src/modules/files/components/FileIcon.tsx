import type { ItemOut } from '@semestra/api-client'
import type { LucideProps } from 'lucide-react'
import { createElement } from 'react'
import { fileIcon } from '../kinds'

/** A file's type icon as an element, so lists need no component made during render. */
export function FileIcon({
  item,
  ...props
}: { item: Pick<ItemOut, 'kind' | 'mime_type'> } & LucideProps) {
  return createElement(fileIcon(item), props)
}
