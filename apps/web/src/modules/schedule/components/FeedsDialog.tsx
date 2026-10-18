import type { Feed } from '@semestra/api-client'
import {
  scheduleFeedCreateMutation,
  scheduleFeedRevokeMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Link2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { invalidateSchedule, useFeeds } from '../queries'
import { Field } from './Field'

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
      <DialogContent closeLabel={m.common_close()} className="sm:max-w-lg">
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
          <Field label={m.schedule_feed_name()}>
            <Input
              placeholder={m.schedule_feed_default_name()}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-4">
            {FEED_SOURCES.map((source) => (
              <label key={source} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={sources.includes(source)}
                  onCheckedChange={(on) =>
                    setSources(on ? [...sources, source] : sources.filter((s) => s !== source))
                  }
                />
                {sourceLabel(source)}
              </label>
            ))}
          </div>
          <Button type="submit" disabled={create.isPending || sources.length === 0}>
            <Link2 aria-hidden />
            {m.schedule_feed_create()}
          </Button>
        </form>
        {feeds.length > 0 ? (
          <ul className="divide-y divide-border text-sm">
            {feeds.map((feed) => (
              <li key={feed.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {feed.name}{' '}
                    <span className="font-normal text-muted-foreground">{feed.prefix}…</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {feed.sources.map(sourceLabel).join(' · ')} ·{' '}
                    {feed.last_fetched_at
                      ? m.schedule_feed_last_fetched({ when: formatDateTime(feed.last_fetched_at) })
                      : m.schedule_feed_never_fetched()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setRevoking(feed)}
                >
                  {m.schedule_feed_revoke()}
                </Button>
              </li>
            ))}
          </ul>
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
