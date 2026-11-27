import type { Connection } from '@semestra/api-client'
import { Link2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { useProviderName, useProviderUis } from '../providers'
import { LogoTile } from './ConnectionsSection'

/**
 * A connection as one row of a settings group, like its row in the connections table: the
 * platform's mark, the name, then "platform · address · account"; `children` on the right.
 */
export function ConnectionItem({
  connection,
  children,
}: {
  connection: Connection
  children?: ReactNode
}) {
  const ui = useProviderUis().get(connection.provider)
  const provider = useProviderName(connection.provider)
  const details = [provider, ui?.summary?.(connection.config) ?? null, connection.account_name]
  return (
    <Item>
      <ItemMedia>
        <LogoTile logo={ui?.logo ?? Link2} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full">
          <span className="truncate">{connection.display_name}</span>
        </ItemTitle>
        <ItemDescription className="truncate">
          {details.filter(Boolean).join(' · ')}
        </ItemDescription>
      </ItemContent>
      {children ? <ItemActions className="shrink-0 gap-3">{children}</ItemActions> : null}
    </Item>
  )
}
