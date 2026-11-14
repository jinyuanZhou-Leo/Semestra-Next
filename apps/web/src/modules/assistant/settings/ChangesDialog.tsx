import type { McpChangeOut, TokenOut } from '@semestra/api-client'
import { agentMcpChangeListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { useState } from 'react'
import { SettingsGroup } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/ui/item'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { capabilityTitle } from '../labels'

const ALL = 'all'
const FRESH_MS = 5_000

/** What MCP clients changed, all connections or one (null = all). */
export function changesOptions(tokenId: string | null) {
  return agentMcpChangeListOptions(tokenId ? { query: { token_id: tokenId } } : undefined)
}

/** The connections the list can be narrowed to: today's write tokens, then revoked ones that
 * still have changes, named as they were. */
function connections(tokens: TokenOut[], changes: McpChangeOut[]) {
  const named = new Map(tokens.filter((t) => t.scopes.includes('write')).map((t) => [t.id, t.name]))
  for (const c of changes) {
    if (c.token_id && !named.has(c.token_id)) named.set(c.token_id, c.client)
  }
  return [...named].map(([value, label]) => ({ value, label }))
}

function Changes({ tokenId }: { tokenId: string | null }) {
  // No event covers a client's changes, so opening reads them again, unless the row menu just
  // started the read (pointing at it), so what was there shows at once and one request is made.
  const changes = useQuery({ ...changesOptions(tokenId), staleTime: FRESH_MS })
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
                <ItemDescription className="truncate text-xs">
                  {(tokenId ? change.target : [change.client, ...change.target]).join(' · ')}
                </ItemDescription>
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

function ConnectionFilter({ tokens, initial }: { tokens: TokenOut[]; initial: string | null }) {
  const [tokenId, setTokenId] = useState(initial)
  const all = useQuery({ ...changesOptions(null), staleTime: FRESH_MS }).data?.items ?? []
  const items = [{ value: ALL, label: m.assistant_mcp_changes_all() }, ...connections(tokens, all)]
  return (
    <>
      <Select
        value={tokenId ?? ALL}
        items={items}
        onValueChange={(next) => setTokenId(next === ALL || !next ? null : String(next))}
      >
        <SelectTrigger aria-label={m.assistant_mcp_changes_filter()} className="w-fit max-w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6">
        <Changes tokenId={tokenId} />
      </div>
    </>
  )
}

/** "Recent changes" (M12 §5): what MCP clients changed, newest first, for every connection or
 * one, revoked connections included. */
export function ChangesDialog({
  target,
  tokens,
  ...props
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenChangeComplete: (open: boolean) => void
  /** The connection to show first (null = all of them). */
  target: { tokenId: string | null } | null
  tokens: TokenOut[]
}) {
  return (
    <Dialog {...props}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{m.assistant_mcp_changes()}</DialogTitle>
          <DialogDescription>{m.assistant_mcp_changes_description()}</DialogDescription>
        </DialogHeader>
        {target ? (
          <ConnectionFilter key={target.tokenId ?? ALL} tokens={tokens} initial={target.tokenId} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
