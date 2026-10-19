import {
  type AgentAttachmentOut,
  type AgentScope,
  type AgentSessionDetail,
  agentAttachmentDelete,
  agentAttachmentUpload,
  agentSessionUpdate,
} from '@semestra/api-client'
import { agentSessionGetQueryKey } from '@semestra/api-client/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, FileText, MessageSquareText, RotateCcw, Sparkles } from 'lucide-react'
import { type DragEvent, useEffect, useState } from 'react'
import { invalidateOperations } from '@/app/api'
import { useSettingsDialog } from '@/app/settings'
import { useAiStatus } from '@/hooks/use-ai-status'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Alert, AlertAction, AlertDescription } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Bubble, BubbleContent } from '@/ui/bubble'
import { Button } from '@/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { Message, MessageContent, MessageFooter } from '@/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/ui/message-scroller'
import { Skeleton } from '@/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { skillTitle } from '../labels'
import { scopeKind } from '../scope'
import { buildItems, canRegenerate, citationsOf, type ViewItem } from '../transcript'
import { type Decision, useChat } from '../use-chat'
import { Composer, type ComposerSubmit, type PendingAttachment } from './Composer'
import { Markdown } from './Markdown'
import { ProposalCard } from './ProposalCard'
import { ScopeChip } from './ScopeChip'
import { Steps } from './Steps'

const MAX_ATTACHMENTS = 10
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** Static starting points for the page's scope (M12 §6.1). */
function suggestions(scope: AgentScope | null): (() => string)[] {
  const kind = scope ? scopeKind(scope) : null
  if (kind === 'course') {
    return [
      m.assistant_suggest_course_final,
      m.assistant_suggest_course_deadlines,
      m.assistant_suggest_course_syllabus,
    ]
  }
  if (kind === 'term') {
    return [
      m.assistant_suggest_week_deadlines,
      m.assistant_suggest_today_classes,
      m.assistant_suggest_term_gpa,
    ]
  }
  return [
    m.assistant_suggest_today_classes,
    m.assistant_suggest_week_deadlines,
    m.assistant_suggest_gpa,
  ]
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-xs" aria-label={label} onClick={onClick} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timeout = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timeout)
  }, [copied])
  return (
    <IconAction
      label={copied ? m.common_copied() : m.common_copy()}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
    >
      {copied ? <Check /> : <Copy />}
    </IconAction>
  )
}

function UserMessage({ item }: { item: Extract<ViewItem, { kind: 'user' }> }) {
  return (
    <Message align="end">
      <MessageContent>
        {item.skill ? (
          <Badge variant="secondary" className="gap-1 self-end">
            <Sparkles aria-hidden />
            {skillTitle(item.skill)}
          </Badge>
        ) : null}
        {item.attachments.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {item.attachments.map((att) => (
              <Badge key={att.id} variant="outline" className="gap-1">
                <FileText aria-hidden />
                {att.name}
              </Badge>
            ))}
          </div>
        ) : null}
        {item.text ? (
          <Bubble align="end" variant="muted">
            <BubbleContent className="whitespace-pre-wrap">{item.text}</BubbleContent>
          </Bubble>
        ) : null}
      </MessageContent>
    </Message>
  )
}

function AssistantMessage({
  item,
  citations,
  busy,
  onDecide,
  footer,
}: {
  item: Extract<ViewItem, { kind: 'assistant' }>
  citations: ReturnType<typeof citationsOf>
  busy: boolean
  onDecide: (decisions: Decision[]) => void
  footer: React.ReactNode
}) {
  const pending = item.proposals.filter((p) => p.status === 'pending')
  return (
    <Message>
      <MessageContent>
        {item.text ? <Markdown text={item.text} citations={citations} /> : null}
        <Steps steps={item.steps} />
        {pending.length > 1 ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                onDecide(pending.map((p) => ({ proposalId: p.id, decision: 'approve' as const })))
              }
            >
              {m.assistant_proposal_approve_all({ count: pending.length })}
            </Button>
          </div>
        ) : null}
        {item.proposals.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            disabled={busy}
            onDecide={(decision) => onDecide([decision])}
          />
        ))}
      </MessageContent>
      {footer ? <MessageFooter className="gap-0.5 px-0">{footer}</MessageFooter> : null}
    </Message>
  )
}

function AiSetupNeeded() {
  const settings = useSettingsDialog()
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Sparkles aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{m.assistant_ai_missing_title()}</EmptyTitle>
        <EmptyDescription>{m.assistant_ai_missing_description()}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          onClick={() => settings.open({ level: 'account', group: 'ai', section: 'ai-providers' })}
        >
          {m.assistant_ai_missing_action()}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

/**
 * One conversation with the assistant: the transcript, confirmation cards and the input.
 * Shared by the side panel and the full page. `sessionId` null is a new conversation, created
 * when the first message (or file) is sent.
 */
export function Conversation({
  sessionId,
  pageScope,
  onCreated,
  question,
  onQuestionTaken,
  focusInput,
  className,
}: {
  sessionId: string | null
  pageScope: AgentScope | null
  onCreated: (id: string) => void
  /** Sent once as soon as the conversation shows (the palette's "Ask AI"). */
  question?: { text: string; key: number } | null
  onQuestionTaken?: () => void
  /** Puts the caret in the input when the conversation shows. */
  focusInput?: boolean
  className?: string
}) {
  const queryClient = useQueryClient()
  const ai = useAiStatus('chat')
  const chat = useChat(sessionId, onCreated)
  const [newScope, setNewScope] = useState<AgentScope | null>(pageScope)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [dragging, setDragging] = useState(false)
  const detail = chat.detail
  const scope = sessionId ? (detail?.session.scope ?? null) : newScope
  const items = detail ? buildItems(detail, chat.generating) : []
  const citations = detail ? citationsOf(detail) : new Map()
  const regenerateId = detail && !chat.generating ? canRegenerate(detail, items) : null

  const questionKey = question?.key
  useEffect(() => {
    if (!question || !ai.available) return
    onQuestionTaken?.()
    void chat.send({ text: question.text, scope: newScope })
    // Only a new question is sent; the rest of the state is read as it is now.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [questionKey, ai.available])

  async function changeScope(next: AgentScope | null) {
    if (!sessionId) {
      setNewScope(next)
      return
    }
    await agentSessionUpdate({ path: { id: sessionId }, body: { scope: next } })
    await queryClient.invalidateQueries({
      queryKey: agentSessionGetQueryKey({ path: { id: sessionId } }),
    })
    await invalidateOperations(queryClient, ['agentSessionList'])
  }

  async function addFiles(files: File[]) {
    const room = MAX_ATTACHMENTS - attachments.length
    const accepted = files.slice(0, Math.max(0, room))
    if (accepted.length === 0) return
    const pending = accepted.map((file) => ({
      key: `${file.name}-${file.size}-${Math.random()}`,
      name: file.name,
      kind: file.type.startsWith('image/') ? ('image' as const) : ('file' as const),
      id: null,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      error: file.size > MAX_ATTACHMENT_BYTES ? m.error_agent_attachment_too_large() : null,
    }))
    setAttachments((current) => [...current, ...pending])
    let id: string
    try {
      id = await chat.ensureSession(newScope)
    } catch (err) {
      const message = errorMessage(err)
      setAttachments((current) =>
        current.map((a) => (pending.some((p) => p.key === a.key) ? { ...a, error: message } : a)),
      )
      return
    }
    await Promise.all(
      accepted.map(async (file, index) => {
        const entry = pending[index]
        if (!entry || entry.error) return
        try {
          const { data } = await agentAttachmentUpload({
            body: { session_id: id, file },
            throwOnError: true,
          })
          queryClient.setQueryData<AgentSessionDetail>(
            agentSessionGetQueryKey({ path: { id } }),
            (current) =>
              current
                ? { ...current, attachments: [...current.attachments, data as AgentAttachmentOut] }
                : current,
          )
          setAttachments((current) =>
            current.map((a) => (a.key === entry.key ? { ...a, id: data.id } : a)),
          )
        } catch (err) {
          const message = errorMessage(err)
          setAttachments((current) =>
            current.map((a) => (a.key === entry.key ? { ...a, error: message } : a)),
          )
        }
      }),
    )
  }

  function removeAttachment(key: string) {
    const gone = attachments.find((a) => a.key === key)
    if (gone?.preview) URL.revokeObjectURL(gone.preview)
    setAttachments((current) => current.filter((a) => a.key !== key))
    const id = gone?.id
    const session = detail?.session.id
    if (!id || !session) return
    // Unsent uploads count against storage until they are deleted (M12 §4).
    void agentAttachmentDelete({ path: { id } })
    queryClient.setQueryData<AgentSessionDetail>(
      agentSessionGetQueryKey({ path: { id: session } }),
      (current) =>
        current
          ? { ...current, attachments: current.attachments.filter((a) => a.id !== id) }
          : current,
    )
  }

  async function submit(input: ComposerSubmit): Promise<boolean> {
    const ready = attachments.filter((a) => a.id !== null)
    const ok = await chat.send({
      text: input.text,
      skill: input.skill ? { name: input.skill.name, title: input.skill.title } : null,
      attachmentIds: ready.map((a) => a.id as string),
      scope: sessionId ? null : newScope,
    })
    if (ok) {
      for (const a of attachments) if (a.preview) URL.revokeObjectURL(a.preview)
      setAttachments([])
    }
    return ok
  }

  const dropProps = {
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      setDragging(true)
    },
    onDragLeave: (event: DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      setDragging(false)
    },
    onDrop: (event: DragEvent) => {
      if (event.dataTransfer.files.length === 0) return
      event.preventDefault()
      setDragging(false)
      void addFiles([...event.dataTransfer.files])
    },
  }

  if (!ai.available && !ai.pending && items.length === 0) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col justify-center p-4', className)}>
        <AiSetupNeeded />
      </div>
    )
  }

  const lastAssistant = items.findLast((item) => item.kind === 'assistant')

  return (
    <section
      aria-label={m.assistant_conversation_label()}
      className={cn('relative flex min-h-0 flex-1 flex-col', className)}
      {...dropProps}
    >
      {dragging ? (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-background/80 text-sm font-medium">
          {m.assistant_drop_files()}
        </div>
      ) : null}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport aria-label={m.assistant_messages_label()}>
            <MessageScrollerContent className="gap-6 px-4 py-4">
              {chat.loading ? (
                <div className="space-y-3">
                  <Skeleton className="ml-auto h-9 w-2/3 rounded-3xl" />
                  <Skeleton className="h-16 w-full rounded-2xl" />
                </div>
              ) : items.length === 0 ? (
                <Empty className="my-auto border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MessageSquareText aria-hidden />
                    </EmptyMedia>
                    <EmptyTitle>{m.assistant_empty_title()}</EmptyTitle>
                    <EmptyDescription>{m.assistant_empty_description()}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent className="items-stretch">
                    {suggestions(scope).map((suggest) => (
                      <Button
                        key={suggest()}
                        variant="outline"
                        className="h-auto justify-start py-2 text-left whitespace-normal"
                        disabled={chat.generating || !ai.available}
                        onClick={() => void chat.send({ text: suggest(), scope: newScope })}
                      >
                        {suggest()}
                      </Button>
                    ))}
                  </EmptyContent>
                </Empty>
              ) : (
                items.map((item) => (
                  <MessageScrollerItem
                    key={item.id}
                    messageId={item.id}
                    scrollAnchor={item.kind === 'user'}
                  >
                    {item.kind === 'user' ? (
                      <UserMessage item={item} />
                    ) : (
                      <AssistantMessage
                        item={item}
                        citations={citations}
                        busy={chat.generating}
                        onDecide={(decisions) => void chat.decide(decisions)}
                        footer={
                          item === lastAssistant && !chat.generating ? (
                            <>
                              {item.text ? <CopyAction text={item.text} /> : null}
                              {regenerateId === item.id ? (
                                <IconAction
                                  label={m.assistant_regenerate()}
                                  onClick={() => void chat.regenerate(item.id)}
                                >
                                  <RotateCcw />
                                </IconAction>
                              ) : null}
                            </>
                          ) : null
                        }
                      />
                    )}
                  </MessageScrollerItem>
                ))
              )}
              {chat.generating && items.at(-1)?.kind === 'user' ? (
                <p className="shimmer text-sm text-muted-foreground" aria-live="polite">
                  {m.assistant_thinking()}
                </p>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="shrink-0 space-y-2 px-3 pb-3">
        {chat.error ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage({ error: chat.error })}</AlertDescription>
            <AlertAction>
              <Button variant="ghost" size="xs" onClick={chat.clearError}>
                {m.common_close()}
              </Button>
            </AlertAction>
          </Alert>
        ) : null}
        <Composer
          programId={scope?.program_id ?? pageScope?.program_id}
          generating={chat.generating}
          disabled={!ai.available}
          attachments={attachments}
          onFiles={(files) => void addFiles(files)}
          onRemoveAttachment={removeAttachment}
          onSubmit={submit}
          onStop={() => void chat.stop()}
          onScope={(next) => void changeScope(next)}
          focusInput={focusInput}
          header={
            <ScopeChip
              scope={scope}
              pageScope={pageScope}
              onChange={(next) => void changeScope(next)}
            />
          }
        />
      </div>
    </section>
  )
}
