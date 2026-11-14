import { agentMcpChangeListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { SettingsGroup } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/ui/item'
import { capabilityTitle } from '../labels'

function Changes({ tokenId }: { tokenId: string }) {
  // No event covers a client's changes: read them again each time the dialog opens (the row
  // menu starts the read, so what was there shows at once).
  const changes = useQuery({
    ...agentMcpChangeListOptions({ path: { token_id: tokenId } }),
    refetchOnMount: 'always',
  })
  return (
    <AsyncBoundary
      query={changes}
      isEmpty={(page) => page.items.length === 0}
      empty={
        <Empty className="rounded-2xl border border-solid border-border p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <History aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.assistant_mcp_changes_empty()}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      }
    >
      {(page) => (
        <SettingsGroup>
          {page.items.map((change) => (
            <Item key={change.id} size="sm">
              <ItemContent className="min-w-0">
                <ItemTitle className="w-full truncate">
                  {capabilityTitle(change.capability)}
                </ItemTitle>
                {change.target.length > 0 ? (
                  <ItemDescription className="truncate text-xs">
                    {change.target.join(' · ')}
                  </ItemDescription>
                ) : null}
              </ItemContent>
              <ItemActions className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatDateTime(change.created_at)}
              </ItemActions>
            </Item>
          ))}
        </SettingsGroup>
      )}
    </AsyncBoundary>
  )
}

/** A connection's "Recent changes" (M12 §5): what the client changed, newest first. */
export function ChangesDialog({
  target,
  ...props
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenChangeComplete: (open: boolean) => void
  target: { id: string; name: string } | null
}) {
  return (
    <Dialog {...props}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{m.assistant_mcp_changes_title({ name: target?.name ?? '' })}</DialogTitle>
          <DialogDescription>{m.assistant_mcp_changes_description()}</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6">
          {target ? <Changes tokenId={target.id} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
