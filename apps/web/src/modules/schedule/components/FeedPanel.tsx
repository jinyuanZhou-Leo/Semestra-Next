import type { Feed } from '@semestra/api-client'
import {
  scheduleFeedCreateMutation,
  scheduleFeedGetQueryKey,
  scheduleFeedResetMutation,
  scheduleFeedRevokeMutation,
  scheduleFeedUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, Check, Copy, RefreshCw, Unlink } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ActionRow, SettingRow, SettingsBlock, SettingsGroup } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/ui/input-group'
import { Skeleton } from '@/ui/skeleton'
import { Switch } from '@/ui/switch'
import { useFeed } from '../queries'

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

/** The same feed as a `webcal:` link, which calendar apps open as "subscribe". */
function webcal(url: string): string {
  return url.replace(/^https?:/, 'webcal:')
}

function googleSubscribe(url: string): string {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal(url))}`
}

/**
 * The Program's ICS subscription link (M04 §5.4), like Google Calendar's secret address: one
 * link, shown whenever needed, what it contains switched in place, reset when it leaks.
 */
export function FeedPanel({ programId }: { programId: string }) {
  const queryClient = useQueryClient()
  const query = useFeed(programId)
  const key = scheduleFeedGetQueryKey({ path: { program_id: programId } })
  const store = (feed: Feed | null) => queryClient.setQueryData(key, { feed })
  const [confirm, setConfirm] = useState<'reset' | 'revoke' | null>(null)
  const [copied, setCopied] = useState(false)
  const create = useMutation({
    ...scheduleFeedCreateMutation(),
    onError: toastError,
    onSuccess: store,
  })
  const update = useMutation({
    ...scheduleFeedUpdateMutation(),
    onError: toastError,
    onSuccess: store,
  })
  const reset = useMutation({
    ...scheduleFeedResetMutation(),
    onError: toastError,
    onSuccess: (feed) => {
      store(feed)
      setCopied(false)
      setConfirm(null)
    },
  })
  const revoke = useMutation({
    ...scheduleFeedRevokeMutation(),
    onError: toastError,
    onSuccess: () => {
      store(null)
      setConfirm(null)
    },
  })

  if (query.isPending) return <Skeleton className="h-40 rounded-2xl" />
  const feed = query.data?.feed ?? null
  if (!feed) {
    return (
      <SettingsGroup>
        <SettingRow label={m.schedule_feeds()} description={m.schedule_feed_off_description()}>
          <Button
            size="sm"
            disabled={create.isPending}
            onClick={() => create.mutate({ path: { program_id: programId }, body: {} })}
          >
            {m.schedule_feed_enable()}
          </Button>
        </SettingRow>
      </SettingsGroup>
    )
  }

  // While a change is saving, the switches show it already.
  const sources = update.isPending ? (update.variables.body.sources ?? feed.sources) : feed.sources
  const setSource = (source: FeedSource, on: boolean) =>
    update.mutate({
      path: { feed_id: feed.id },
      body: { sources: FEED_SOURCES.filter((s) => (s === source ? on : sources.includes(s))) },
    })
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true)
        toast.success(m.schedule_feed_copied())
      },
      () => toastError(new Error('clipboard')),
    )

  return (
    <div className="flex flex-col gap-5">
      {feed.url ? (
        <div className="flex flex-col gap-2">
          <InputGroup>
            <InputGroupInput
              readOnly
              value={feed.url}
              aria-label={m.schedule_feed_url()}
              onFocus={(e) => e.target.select()}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label={m.schedule_feed_copy()}
                size="icon-xs"
                onClick={() => feed.url && void copy(feed.url)}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              nativeButton={false}
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
              render={<a href={webcal(feed.url)} />}
            >
              <CalendarPlus aria-hidden />
              {m.schedule_feed_open_app()}
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
              render={<a href={googleSubscribe(feed.url)} target="_blank" rel="noreferrer" />}
            >
              {m.schedule_feed_open_google()}
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              {feed.last_fetched_at
                ? m.schedule_feed_last_fetched({ when: formatDateTime(feed.last_fetched_at) })
                : m.schedule_feed_never_fetched()}
            </span>
          </div>
        </div>
      ) : (
        <SettingsGroup>
          <SettingRow label={m.schedule_feeds()} description={m.schedule_feed_legacy()}>
            <Button size="sm" onClick={() => setConfirm('reset')}>
              {m.schedule_feed_reset()}
            </Button>
          </SettingRow>
        </SettingsGroup>
      )}
      <SettingsBlock title={m.schedule_export_content()}>
        <SettingsGroup>
          {FEED_SOURCES.map((source) => {
            const on = sources.includes(source)
            return (
              <SettingRow key={source} size="sm" label={sourceLabel(source)}>
                {(labelId) => (
                  <Switch
                    aria-labelledby={labelId}
                    checked={on}
                    // At least one thing stays in the feed; turn the link off instead.
                    disabled={on && sources.length === 1}
                    onCheckedChange={(next) => setSource(source, next)}
                  />
                )}
              </SettingRow>
            )
          })}
        </SettingsGroup>
      </SettingsBlock>
      <SettingsGroup>
        {feed.url ? (
          <ActionRow icon={RefreshCw} onClick={() => setConfirm('reset')}>
            {m.schedule_feed_reset()}
          </ActionRow>
        ) : null}
        <ActionRow icon={Unlink} destructive onClick={() => setConfirm('revoke')}>
          {m.schedule_feed_revoke()}
        </ActionRow>
      </SettingsGroup>
      <ConfirmDialog
        open={confirm === 'reset'}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={m.schedule_feed_reset_title()}
        description={m.schedule_feed_reset_description()}
        confirmLabel={m.schedule_feed_reset()}
        pending={reset.isPending}
        onConfirm={() => reset.mutate({ path: { feed_id: feed.id } })}
      />
      <ConfirmDialog
        open={confirm === 'revoke'}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={m.schedule_feed_revoke_title()}
        description={m.schedule_feed_revoke_description()}
        confirmLabel={m.schedule_feed_revoke()}
        pending={revoke.isPending}
        onConfirm={() => revoke.mutate({ path: { feed_id: feed.id } })}
      />
    </div>
  )
}
