import {
  type AgentAttachmentOut,
  type AgentScope,
  type AgentSessionDetail,
  agentAttachmentDelete,
  agentAttachmentUpload,
  agentSessionUpdate,
} from '@semestra/api-client'
import { agentSessionGetQueryKey, settingsValueGetOptions } from '@semestra/api-client/react-query'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/core'
import { toast } from 'sonner'
import {
  Brain,
  Check,
  ChevronDown,
  Copy,
  FileText,
  FileUp,
  ImageIcon,
  MessageCircle,
  MessageCircleDashed,
  MessageSquareText,
  Minimize2,
  Pencil,
  Play,
  RotateCcw,
} from 'lucide-react'
import { type DragEvent, Suspense, useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { invalidateOperations } from '@/app/api'
import { useSettingsDialog } from '@/app/settings'
import { useAiStatus } from '@/hooks/use-ai-status'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { whenSettled } from '@/lib/when-settled'
import { m } from '@/paraglide/messages'
import { Alert, AlertAction, AlertDescription } from '@/ui/alert'
import {
  Attachment,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@/ui/attachment'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
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
import { InputGroup, InputGroupAddon, InputGroupButton } from '@/ui/input-group'
import { Message, MessageContent, MessageFooter } from '@/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '@/ui/message-scroller'
import { Label } from '@/ui/label'
import { Separator } from '@/ui/separator'
import { Skeleton } from '@/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { Switch } from '@/ui/switch'
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@/ui/trace'
import { skillTitle } from '../labels'
import { type Chip, type MessageReference, type PromptValue, promptDoc, segments } from '../prompt'
import { scopeKind, useProgramEntities } from '../scope'
import { buildItems, citationsOf, pausedReason, type ViewItem } from '../transcript'
import type { PauseReason } from '../stream'
import { type Decision, useChat } from '../use-chat'
import { AttachmentSaveMenu } from './AttachmentSaveMenu'
import { Composer, type ComposerSubmit, type PendingAttachment } from './Composer'
import { Markdown, preloadMarkdown } from './Markdown'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor'
import { ChipCourses, RefChip } from './RefChip'
import { ProposalCard } from './ProposalCard'
import { Remembered } from './Remembered'
import { ScopeChip } from './ScopeChip'
import { Thinking } from './Steps'

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
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
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

/** Shown on hover (or keyboard focus); `always` for the latest answer. */
const hoverActions =
  'opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100'

function UserMessage({
  item,
  programId,
  scope,
  savedFiles,
  canEdit,
  onEdit,
  onScope,
}: {
  item: Extract<ViewItem, { kind: 'user' }>
  programId: string | undefined
  /** Where the conversation works: the courses its attachments can be saved to. */
  scope: AgentScope | null
  /** Course file each attachment was saved as, by attachment id. */
  savedFiles: ReadonlyMap<string, string>
  canEdit: boolean
  /** Resolves false when the edit could not be sent; the editor stays open. */
  onEdit: (text: string, references: MessageReference[]) => Promise<boolean>
  /** Picking a course or term with `@` moves the conversation there, as in the input below. */
  onScope: (scope: AgentScope) => void
}) {
  // What the editor starts with while editing; the editor reports `draft` as it changes.
  const [opened, setOpened] = useState<JSONContent | null>(null)
  const [draft, setDraft] = useState<PromptValue | null>(null)
  const editing = opened !== null
  const editor = useRef<PromptEditorHandle>(null)
  const skill: Chip | null = item.skill
    ? { kind: 'skill', id: '', label: skillTitle(item.skill) }
    : null

  // The editor opens with the caret after the text.
  useEffect(() => {
    if (editing) editor.current?.focus()
  }, [editing])
  const canSave =
    draft !== null &&
    (draft.text.trim() !== item.text.trim() ||
      !sameReferences(draft.references, item.references)) &&
    (draft.text.trim() !== '' || item.skill !== null || item.attachments.length > 0)

  function open() {
    setDraft(null)
    setOpened(promptDoc(item.text, item.references))
  }

  async function save() {
    if (draft === null || opened === null || !canSave) return
    const sent = draft
    const reopen = promptDoc(sent.text, sent.references)
    // Closes at once: the transcript already shows the edit while the answer streams.
    setOpened(null)
    if (!(await onEdit(sent.text, sent.references))) {
      setDraft(sent)
      setOpened(reopen)
    }
  }

  return (
    <Message align="end">
      <MessageContent>
        {item.attachments.length > 0 ? (
          <AttachmentGroup className="justify-end">
            {item.attachments.map((att) => (
              <Attachment key={att.id} size="xs">
                <AttachmentMedia>
                  {att.kind === 'image' ? <ImageIcon /> : <FileText />}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{att.name}</AttachmentTitle>
                </AttachmentContent>
                <AttachmentSaveMenu
                  attachmentId={att.id}
                  name={att.name}
                  scope={scope}
                  fileItemId={savedFiles.get(att.id) ?? null}
                />
              </Attachment>
            ))}
          </AttachmentGroup>
        ) : null}
        {editing ? (
          <>
            {skill ? (
              <span className="self-end">
                <RefChip chip={skill} />
              </span>
            ) : null}
            <InputGroup className="relative w-full rounded-2xl">
              <PromptEditor
                ref={editor}
                label={m.assistant_edit_label()}
                programId={programId}
                initialContent={opened}
                menuSide="bottom"
                className="w-full"
                onChange={(value) => setDraft(value)}
                onEnter={() => void save()}
                onEscape={() => setOpened(null)}
                onScope={onScope}
              />
              <InputGroupAddon align="block-end" className="justify-end gap-1.5">
                <InputGroupButton variant="ghost" size="sm" onClick={() => setOpened(null)}>
                  {m.common_cancel()}
                </InputGroupButton>
                <InputGroupButton
                  variant="default"
                  size="sm"
                  disabled={!canSave || !canEdit}
                  onClick={() => void save()}
                >
                  {m.assistant_send()}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </>
        ) : item.text || skill ? (
          <Bubble align="end" variant="muted">
            <BubbleContent className="leading-6 whitespace-pre-wrap">
              {skill ? <RefChip chip={skill} /> : null}
              {skill && item.text ? ' ' : null}
              {segments(item.text, item.references).map((part, i) =>
                typeof part === 'string' ? part : <RefChip key={i} chip={part} />,
              )}
            </BubbleContent>
          </Bubble>
        ) : null}
        {editing ? null : (
          <div className={cn('flex justify-end gap-0.5', hoverActions)}>
            {item.text ? <CopyAction text={item.text} /> : null}
            <IconAction label={m.assistant_edit()} disabled={!canEdit} onClick={open}>
              <Pencil />
            </IconAction>
          </div>
        )}
      </MessageContent>
    </Message>
  )
}

const sameReferences = (a: readonly MessageReference[], b: readonly MessageReference[]) =>
  a.length === b.length && a.every((r, i) => r.kind === b[i]?.kind && r.id === b[i]?.id)

function AssistantMessage({
  item,
  citations,
  busy,
  active,
  compacting,
  showReasoning,
  onDecide,
  footer,
  latest,
}: {
  item: Extract<ViewItem, { kind: 'assistant' }>
  citations: ReturnType<typeof citationsOf>
  busy: boolean
  /** This answer is being written now. */
  active: boolean
  /** Its request is being compacted first. */
  compacting: boolean
  showReasoning: boolean
  onDecide: (decisions: Decision[]) => void
  /** Copy and regenerate under the answer; `null` while there is nothing to act on. */
  footer: React.ReactNode
  /** The latest answer shows its actions without hovering. */
  latest: boolean
}) {
  const pending = item.proposals.filter((p) => p.status === 'pending')
  return (
    <Message>
      <MessageContent className="gap-3">
        <Thinking
          item={item}
          active={active}
          compacting={compacting}
          showReasoning={showReasoning}
        />
        {item.answer ? (
          <Markdown text={item.answer} citations={citations} streaming={active} />
        ) : null}
        <Remembered steps={item.steps} />
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
        {pending.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            disabled={busy}
            onDecide={(decision) => onDecide([decision])}
          />
        ))}
        {footer ? (
          <MessageFooter className={cn('-mt-1 gap-0.5 px-0', latest ? null : hoverActions)}>
            {footer}
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  )
}

/** Under an answer that stopped at a limit: why, and a button to go on. */
function PausedNotice({ reason, onContinue }: { reason: PauseReason; onContinue: () => void }) {
  return (
    <div className="ml-1 flex items-center gap-2">
      <span className="text-xs text-muted-foreground">
        {reason === 'loop' ? m.assistant_paused_loop() : m.assistant_paused_tool_limit()}
      </span>
      <Button variant="outline" size="xs" onClick={onContinue}>
        <Play data-icon="inline-start" />
        {m.assistant_continue()}
      </Button>
    </div>
  )
}

function AiSetupNeeded() {
  const settings = useSettingsDialog()
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageCircle aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{m.assistant_ai_missing_title()}</EmptyTitle>
        <EmptyDescription>{m.assistant_ai_missing_description()}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          onClick={() =>
            settings.open({ level: 'account', group: 'ai-providers', section: 'ai-providers' })
          }
        >
          {m.assistant_ai_missing_action()}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

/** The account setting `assistant.show_reasoning` (on unless turned off). */
function useShowReasoning(): boolean {
  const values = useQuery({
    ...settingsValueGetOptions({ path: { namespace: 'assistant' } }),
    staleTime: 60_000,
  }).data?.values as { show_reasoning?: boolean } | undefined
  return values?.show_reasoning ?? true
}

/**
 * Follows the newest message after the user sends one, even when they had scrolled up; while
 * the answer streams the scroller keeps to the bottom until the user scrolls away.
 */
function ScrollToEndOnSend({ sent }: { sent: number }) {
  const scroller = useMessageScroller()
  // Only a new message scrolls; the scroller's functions are not stable.
  const toEnd = useEffectEvent(() => scroller.scrollToEnd())
  useEffect(() => {
    if (sent > 0) toEnd()
  }, [sent])
  return null
}

/** The line shown between sending and the first word of the answer. */
function ThinkingPlaceholder() {
  return (
    <Trace aria-live="polite">
      <TraceLine status="running">
        <TraceIcon>
          <Brain />
        </TraceIcon>
        <TraceTitle>{m.assistant_thinking()}</TraceTitle>
      </TraceLine>
    </Trace>
  )
}

function CompactingNotice() {
  return (
    <Trace aria-live="polite">
      <TraceLine status="running">
        <TraceIcon>
          <Minimize2 />
        </TraceIcon>
        <TraceTitle>{m.assistant_compacting()}</TraceTitle>
      </TraceLine>
    </Trace>
  )
}

/** Where earlier turns were compacted; opened, what Sem keeps of them (M12 §3.4). */
function CompactedDivider({ summary }: { summary: string }) {
  return (
    <Collapsible className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              className="group/trigger text-muted-foreground data-[panel-open]:text-foreground"
            />
          }
        >
          <Minimize2 aria-hidden />
          {m.assistant_compacted()}
          <ChevronDown
            aria-hidden
            className="transition-transform group-data-[panel-open]/trigger:rotate-180"
          />
        </CollapsibleTrigger>
        <Separator className="flex-1" />
      </div>
      <CollapsibleContent className="rounded-2xl bg-muted/60 px-4 py-3 text-sm">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          {m.assistant_compacted_summary()}
        </p>
        <p className="whitespace-pre-wrap">{summary}</p>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * One conversation with the assistant: the transcript, confirmation cards and the input.
 * Shared by the side panel and the full page. `sessionId` null is a new conversation, created
 * when the first message (or file) is sent.
 */
function ConversationSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="ml-auto h-9 w-2/3 rounded-3xl" />
      <Skeleton className="h-16 w-full rounded-2xl" />
    </div>
  )
}

export function Conversation({
  sessionId,
  pageScope,
  onCreated,
  question,
  onQuestionTaken,
  focusInput,
  className,
  contentClassName,
  initialTemporary = false,
  onTemporaryChange,
  initialContent,
  onContentChange,
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
  /** Applied to the message column and the input area, so the scrollbar can sit at the edge. */
  contentClassName?: string
  /** A new conversation starts as a temporary chat (the full page's choice carried over). */
  initialTemporary?: boolean
  /** Reports whether the conversation shown is temporary, when it changes. */
  onTemporaryChange?: (temporary: boolean) => void
  /** The input starts with this, and reports what is written (the hand-over keeps drafts). */
  initialContent?: JSONContent | null
  onContentChange?: (doc: JSONContent) => void
}) {
  const queryClient = useQueryClient()
  const temporaryId = useId()
  const ai = useAiStatus('chat')
  const chat = useChat(sessionId, onCreated)
  const showReasoning = useShowReasoning()
  // Counts the messages sent from here, so the transcript can follow each one.
  const [sent, setSent] = useState(0)
  // A new conversation works where the page is until the user picks another place.
  const [chosenScope, setChosenScope] = useState<AgentScope | null>(null)
  const newScope = chosenScope ?? pageScope
  const [temporaryChoice, setTemporaryChoice] = useState(initialTemporary)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [dragging, setDragging] = useState(false)
  // Keys removed from the composer, so an upload that finishes later is deleted, not kept.
  const removed = useRef(new Set<string>())
  const detail = chat.detail
  const scope = sessionId ? (detail?.session.scope ?? null) : newScope
  const temporary = sessionId ? (detail?.session.temporary ?? false) : temporaryChoice
  const programId = scope?.program_id ?? pageScope?.program_id
  const { courses } = useProgramEntities(programId)
  // Answers need the Markdown renderer. Evaluating it is a long task, so a new conversation
  // loads it once the panel has settled, or when the first message is sent (`useChat`); a
  // conversation with answers loads it as they render.
  useEffect(() => whenSettled(() => void preloadMarkdown()), [])
  const reportTemporary = useEffectEvent((value: boolean) => onTemporaryChange?.(value))
  useEffect(() => {
    reportTemporary(temporary)
  }, [temporary])
  const items = detail ? buildItems(detail, chat.generating) : []
  const citations = detail ? citationsOf(detail) : new Map()
  const savedFiles = new Map(
    (detail?.attachments ?? []).flatMap((a) => (a.file_item_id ? [[a.id, a.file_item_id]] : [])),
  )
  const regenerateId = detail && !chat.generating ? (detail.regenerable ?? null) : null
  const paused = detail && !chat.generating ? pausedReason(detail) : null
  const canCompact = detail?.compactable ?? false

  async function compact(focus: string): Promise<boolean> {
    setSent((n) => n + 1)
    const result = await chat.compact(focus)
    if (result === 'skipped') toast(m.assistant_compact_nothing())
    return result !== 'failed'
  }

  const questionKey = question?.key
  useEffect(() => {
    if (!question || !ai.available) return
    onQuestionTaken?.()
    void chat.send({ text: question.text, scope: sessionId ? null : newScope, temporary })
    // Only a new question is sent; the rest of the state is read as it is now.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [questionKey, ai.available])

  async function changeScope(next: AgentScope) {
    if (!sessionId) {
      setChosenScope(next)
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
      id = await chat.ensureSession(newScope, temporary)
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
          if (removed.current.has(entry.key)) {
            // Removed while it was uploading: nothing will send it.
            void agentAttachmentDelete({ path: { id: data.id } })
            return
          }
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
    removed.current.add(key)
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
    setSent((n) => n + 1)
    const ok = await chat.send({
      text: input.text,
      references: input.references,
      skill: input.skill ? { name: input.skill.name, title: input.skill.title } : null,
      attachmentIds: ready.map((a) => a.id as string),
      scope: sessionId ? null : newScope,
      temporary,
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
        <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/50 bg-background/80 text-sm font-medium">
          <FileUp aria-hidden className="size-6 text-muted-foreground" />
          {m.assistant_drop_files()}
        </div>
      ) : null}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <ScrollToEndOnSend sent={sent} />
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport aria-label={m.assistant_messages_label()}>
            <MessageScrollerContent className={cn('gap-6 px-4 py-4', contentClassName)}>
              {chat.loading ? (
                <ConversationSkeleton />
              ) : items.length === 0 ? (
                <Empty className="my-auto border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      {temporary ? (
                        <MessageCircleDashed aria-hidden />
                      ) : (
                        <MessageSquareText aria-hidden />
                      )}
                    </EmptyMedia>
                    <EmptyTitle>
                      {temporary ? m.assistant_temporary_empty_title() : m.assistant_empty_title()}
                    </EmptyTitle>
                    <EmptyDescription>
                      {temporary
                        ? m.assistant_temporary_empty_description()
                        : m.assistant_empty_description()}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                // Answers wait for their renderer together (see `Markdown`).
                <Suspense fallback={<ConversationSkeleton />}>
                  <ChipCourses value={courses}>
                    {items.map((item) => (
                      <MessageScrollerItem key={item.id} messageId={item.id}>
                        {item.kind === 'compacted' ? (
                          <CompactedDivider summary={item.summary} />
                        ) : item.kind === 'user' ? (
                          <UserMessage
                            item={item}
                            programId={programId}
                            scope={scope}
                            savedFiles={savedFiles}
                            canEdit={!chat.generating && !item.id.startsWith('pending-')}
                            onEdit={(text, references) => {
                              setSent((n) => n + 1)
                              return chat.edit(item.id, text, references)
                            }}
                            onScope={(next) => void changeScope(next)}
                          />
                        ) : (
                          <AssistantMessage
                            item={item}
                            citations={citations}
                            busy={chat.generating}
                            active={item === lastAssistant && chat.generating}
                            compacting={
                              item === lastAssistant && chat.generating && chat.compacting
                            }
                            showReasoning={showReasoning}
                            onDecide={(decisions) => void chat.decide(decisions)}
                            latest={item === lastAssistant}
                            footer={
                              item.answer ||
                              regenerateId === item.id ||
                              (paused && item === lastAssistant) ? (
                                // Kept in the layout while the answer streams, so nothing jumps.
                                <div
                                  className={cn(
                                    'flex gap-0.5',
                                    item === lastAssistant && chat.generating && 'invisible',
                                  )}
                                >
                                  {item.answer ? <CopyAction text={item.answer} /> : null}
                                  {regenerateId === item.id ? (
                                    <IconAction
                                      label={m.assistant_regenerate()}
                                      onClick={() => void chat.regenerate(item.id)}
                                    >
                                      <RotateCcw />
                                    </IconAction>
                                  ) : null}
                                  {paused && item === lastAssistant ? (
                                    <PausedNotice
                                      reason={paused}
                                      onContinue={() => {
                                        setSent((n) => n + 1)
                                        void chat.resume()
                                      }}
                                    />
                                  ) : null}
                                </div>
                              ) : null
                            }
                          />
                        )}
                      </MessageScrollerItem>
                    ))}
                  </ChipCourses>
                </Suspense>
              )}
              {/* Compacting before an answer shows on that answer's line, so one line runs. */}
              {chat.compacting && !(chat.generating && items.at(-1)?.kind === 'assistant') ? (
                <CompactingNotice />
              ) : chat.generating && items.at(-1)?.kind === 'user' ? (
                <ThinkingPlaceholder />
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <div className={cn('w-full shrink-0 space-y-2 px-3 pb-3', contentClassName)}>
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
        {!chat.loading && items.length === 0 ? (
          <div className="flex scroll-fade-x scrollbar-none gap-2 overflow-x-auto overscroll-x-contain">
            {suggestions(scope).map((suggest) => (
              <Button
                key={suggest()}
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={chat.generating || !ai.available}
                onClick={() => {
                  setSent((n) => n + 1)
                  void chat.send({ text: suggest(), scope: sessionId ? null : newScope, temporary })
                }}
              >
                {suggest()}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <ScopeChip
            scope={scope}
            programId={pageScope?.program_id}
            onChange={(next) => void changeScope(next)}
          />
          {!sessionId || temporary ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Label
                    htmlFor={temporaryId}
                    className="shrink-0 gap-2 text-xs font-normal text-muted-foreground"
                  />
                }
              >
                {m.assistant_temporary_chat()}
                <Switch
                  id={temporaryId}
                  size="sm"
                  checked={temporary}
                  disabled={sessionId !== null}
                  onCheckedChange={setTemporaryChoice}
                />
              </TooltipTrigger>
              <TooltipContent>{m.assistant_temporary_chat_hint()}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <Composer
          programId={programId}
          generating={chat.generating}
          disabled={!ai.available}
          attachments={attachments}
          onFiles={(files) => void addFiles(files)}
          onRemoveAttachment={removeAttachment}
          onSubmit={submit}
          onStop={() => void chat.stop()}
          onScope={(next) => void changeScope(next)}
          focusInput={focusInput}
          initialContent={initialContent}
          onContentChange={onContentChange}
          context={sessionId ? (detail?.context ?? null) : null}
          canCompact={canCompact}
          onCompact={compact}
        />
      </div>
    </section>
  )
}
