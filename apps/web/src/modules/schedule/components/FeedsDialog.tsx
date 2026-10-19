import type { Feed } from '@semestra/api-client'
import {
  scheduleFeedCreateMutation,
  scheduleFeedRevokeMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Link2 } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Field, FieldLabel } from '@/ui/field'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/ui/item'
import { Input } from '@/ui/input'
import { invalidateSchedule, useFeeds } from '../queries'

type FeedSource = Feed['sources'][number]
const FEED_SOURCES: readonly FeedSource[] = ['schedule', 'assessments', 'tasks', 'lms']

function sourceLabel(source: FeedSource): string {
  switch (source) {
    case 'schedule':
      return m.schedule_feed_source_schedule()
    case 'assessments':
      return m.schedule_feed_source_assessments()
    case 'tasks':
      return m.schedule_feed_source_tasks()
    case 'lms':
      return m.schedule_feed_source_lms()
  }
}

/**
 * ICS subscription links (M04 §5.4): create one (the URL is shown once), copy it, revoke it.
 * Anyone with the link can read the calendar, so it is not meant to be shared.
 */
export function FeedsDialog({
  programId,
  open,
  onOpenChange,
}: {
  programId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fid = useId()
  const queryClient = useQueryClient()
  const feeds = (useFeeds(programId).data?.items ?? []).filter((f) => !f.revoked_at)
  const [name, setName] = useState('')
  const [sources, setSources] = useState<FeedSource[]>(['schedule', 'assessments', 'tasks'])
  const [url, setUrl] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<Feed | null>(null)
  const create = useMutation({
    ...scheduleFeedCreateMutation(),
    onError: toastError,
    onSuccess: async (created) => {
      setUrl(created.url)
      setName('')
      await invalidateSchedule(queryClient)
    },
  })
  const revoke = useMutation({
    ...scheduleFeedRevokeMutation(),
    onError: toastError,
    onSuccess: async () => {
      setRevoking(null)
      await invalidateSchedule(queryClient)
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (sources.length === 0) return
    create.mutate({
      path: { program_id: programId },
      body: { name: name.trim() || m.schedule_feed_default_name(), sources },
    })
  }
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success(m.schedule_feed_copied()),
      () => toastError(new Error('clipboard')),
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{m.schedule_feeds()}</DialogTitle>
          <DialogDescription>{m.schedule_feeds_warning()}</DialogDescription>
        </DialogHeader>
        {url ? (
          <div className="space-y-2 rounded-2xl bg-muted p-3">
            <p className="text-sm font-medium">{m.schedule_feed_created()}</p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={url}
                aria-label={m.schedule_feed_url()}
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label={m.schedule_feed_copy()}
                onClick={() => void copy(url)}
              >
                <Copy aria-hidden />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{m.schedule_feed_shown_once()}</p>
          </div>
        ) : null}
        <form onSubmit={submit} className="space-y-3">
          <Field>
            <FieldLabel htmlFor={`${fid}-1`}>{m.schedule_feed_name()}</FieldLabel>
            <Input
              id={`${fid}-1`}
              placeholder={m.schedule_feed_default_name()}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {FEED_SOURCES.map((source) => (
              <Field key={source} orientation="horizontal" className="w-auto">
                <Checkbox
                  id={`${fid}-${source}`}
                  checked={sources.includes(source)}
                  onCheckedChange={(on) =>
                    setSources(on ? [...sources, source] : sources.filter((s) => s !== source))
                  }
                />
                <FieldLabel htmlFor={`${fid}-${source}`} className="font-normal">
                  {sourceLabel(source)}
                </FieldLabel>
              </Field>
            ))}
          </div>
          <Button type="submit" disabled={create.isPending || sources.length === 0}>
            <Link2 aria-hidden />
            {m.schedule_feed_create()}
          </Button>
        </form>
        {feeds.length > 0 ? (
          <ItemGroup className="gap-0">
            {feeds.map((feed) => (
              <Item key={feed.id} size="sm" className="px-0">
                <ItemContent className="min-w-0">
                  <ItemTitle>
                    {feed.name}{' '}
                    <span className="font-normal text-muted-foreground">{feed.prefix}…</span>
                  </ItemTitle>
                  <ItemDescription>
                    {feed.sources.map(sourceLabel).join(' · ')} ·{' '}
                    {feed.last_fetched_at
                      ? m.schedule_feed_last_fetched({ when: formatDateTime(feed.last_fetched_at) })
                      : m.schedule_feed_never_fetched()}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button variant="destructive" size="sm" onClick={() => setRevoking(feed)}>
                    {m.schedule_feed_revoke()}
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        ) : null}
        <ConfirmDialog
          open={revoking !== null}
          onOpenChange={(next) => !next && setRevoking(null)}
          title={m.schedule_feed_revoke_title()}
          description={m.schedule_feed_revoke_description()}
          confirmLabel={m.schedule_feed_revoke()}
          pending={revoke.isPending}
          onConfirm={() => revoking && revoke.mutate({ path: { feed_id: revoking.id } })}
        />
      </DialogContent>
    </Dialog>
  )
}
