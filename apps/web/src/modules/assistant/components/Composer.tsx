import type { AgentScope, AgentSkillInfo, ContextUsage } from '@semestra/api-client'
import { agentSkillListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/core'
import { ArrowUp, FileText, Plus, Square, X } from 'lucide-react'
import { type ReactNode, useDeferredValue, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@/ui/attachment'
import { InputGroup, InputGroupAddon, InputGroupButton } from '@/ui/input-group'
import { Spinner } from '@/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { EMPTY_PROMPT, type MessageReference, type PromptValue, readPrompt } from '../prompt'
import { ContextMeter } from './ContextMeter'
import { PROMPT_CLASS, PromptEditor, type PromptEditorHandle } from './PromptEditor'

export type PendingAttachment = {
  key: string
  name: string
  kind: 'image' | 'file'
  /** Set once uploaded. */
  id: string | null
  preview: string | null
  error: string | null
}

export type ComposerSubmit = {
  text: string
  skill: AgentSkillInfo | null
  references: MessageReference[]
}

function IconButton({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & Omit<
  Parameters<typeof InputGroupButton>[0],
  'children'
>) {
  return (
    <Tooltip>
      <TooltipTrigger render={<InputGroupButton aria-label={label} {...props} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Where the user writes (M12 §6.1): Enter sends and Shift+Enter breaks the line, `/` picks a
 * skill, `@` refers to a course or term (its term becomes where the assistant works), both as
 * chips in the text; files can be attached, pasted or dropped, and a running answer can be
 * stopped.
 */
export function Composer({
  programId,
  generating,
  disabled,
  attachments,
  onFiles,
  onRemoveAttachment,
  onSubmit,
  onStop,
  onScope,
  focusInput,
  initialContent = null,
  onContentChange,
  context,
  canCompact = false,
  compacting: compactingNow = false,
  onCompact,
}: {
  programId: string | undefined
  generating: boolean
  disabled: boolean
  attachments: readonly PendingAttachment[]
  onFiles: (files: File[]) => void
  onRemoveAttachment: (key: string) => void
  /** Resolves false when the message could not be sent; the text is kept. */
  onSubmit: (input: ComposerSubmit) => Promise<boolean>
  onStop: () => void
  onScope: (scope: AgentScope) => void
  focusInput?: boolean
  /** What the input starts with (a draft carried over from the other view). */
  initialContent?: JSONContent | null
  /** Reports what is being written. */
  onContentChange?: (doc: JSONContent) => void
  /** How full the conversation's context is, once a request measured it. */
  context?: ContextUsage | null
  /** There are turns before the last message to compact. */
  canCompact?: boolean
  /** Earlier turns are being compacted now (sending waits: `generating` is set too). */
  compacting?: boolean
  /** Compacts the conversation now (`/compact` or the context card's button), keeping `focus`. */
  onCompact?: (focus: string) => Promise<boolean>
}) {
  const [value, setValue] = useState<PromptValue>(() =>
    initialContent ? readPrompt(initialContent) : EMPTY_PROMPT,
  )
  const editor = useRef<PromptEditorHandle>(null)
  // What is written, to put back when sending fails.
  const editorDoc = useRef<JSONContent | null>(initialContent)
  const fileInput = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)
  const skills = useQuery({ ...agentSkillListOptions(), staleTime: 5 * 60_000 }).data?.items ?? []

  // Creating and focusing the editor (ProseMirror) is a long task: the conversation draws first,
  // with a stand-in of the same size, and the editor takes its place in the next render.
  const editorReady = useDeferredValue(true, false)

  // Opening the assistant means typing.
  useEffect(() => {
    if (focusInput && editorReady) editor.current?.focus()
  }, [focusInput, editorReady])

  const compacting = value.compact && Boolean(onCompact)
  const skill = value.skill ? (skills.find((s) => s.name === value.skill) ?? null) : null
  const uploading = attachments.some((a) => a.id === null && a.error === null)
  const ready = attachments.filter((a) => a.id !== null)
  const canSend =
    !disabled &&
    !generating &&
    !uploading &&
    (compacting || value.text.trim() !== '' || ready.length > 0 || skill !== null)

  async function submit() {
    // `canSend` is from the last render: a second Enter before it re-renders would send twice.
    if (!canSend || submitting.current) return
    submitting.current = true
    const sent: ComposerSubmit = { text: value.text, skill, references: value.references }
    const compact = compacting && onCompact
    const doc = editorDoc.current
    editor.current?.setContent(null)
    const ok = await (compact ? compact(value.text.trim()) : onSubmit(sent)).finally(() => {
      submitting.current = false
    })
    if (!ok) editor.current?.setContent(doc)
  }

  return (
    <div className="relative">
      <InputGroup className="rounded-2xl">
        {attachments.length > 0 ? (
          <InputGroupAddon align="block-start" className="flex-wrap justify-start gap-1.5">
            <AttachmentGroup className="w-full">
              {attachments.map((att) => (
                <Attachment
                  key={att.key}
                  size="xs"
                  state={att.error ? 'error' : att.id ? 'done' : 'uploading'}
                >
                  <AttachmentMedia variant={att.preview ? 'image' : 'icon'}>
                    {att.id === null && att.error === null ? (
                      <Spinner />
                    ) : att.preview ? (
                      <img src={att.preview} alt="" />
                    ) : (
                      <FileText />
                    )}
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{att.error ?? att.name}</AttachmentTitle>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      aria-label={m.assistant_attachment_remove({ name: att.name })}
                      onClick={() => onRemoveAttachment(att.key)}
                    >
                      <X />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ))}
            </AttachmentGroup>
          </InputGroupAddon>
        ) : null}
        {editorReady ? (
          <PromptEditor
            ref={editor}
            label={m.assistant_input_label()}
            placeholder={m.assistant_input_placeholder()}
            programId={programId}
            slash
            canCompact={Boolean(onCompact) && canCompact}
            disabled={disabled}
            initialContent={initialContent}
            className="w-full"
            onChange={(next, doc) => {
              setValue(next)
              editorDoc.current = doc
              onContentChange?.(doc)
            }}
            onEnter={() => void submit()}
            onFiles={onFiles}
            onScope={onScope}
          />
        ) : (
          <div aria-hidden className="w-full">
            <div className={cn(PROMPT_CLASS, !value.text && 'text-muted-foreground')}>
              {value.text || m.assistant_input_placeholder()}
            </div>
          </div>
        )}
        <InputGroupAddon align="block-end" className="justify-between">
          <div className="flex items-center gap-1.5">
            <IconButton
              label={m.assistant_attach()}
              size="icon-sm"
              variant="outline"
              className="rounded-full"
              disabled={disabled}
              onClick={() => fileInput.current?.click()}
            >
              <Plus />
            </IconButton>
            {context && context.window > 0 && onCompact ? (
              <ContextMeter
                used={context.used}
                window={context.window}
                parts={context.parts ?? null}
                canCompact={canCompact && !generating && !disabled}
                compacting={compactingNow}
                onCompact={() => {
                  // Like `/compact`: what to keep is typed here, and sending compacts.
                  editor.current?.startCompact()
                }}
              />
            ) : null}
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/*,.md,.csv,.json,.ics,.html,.docx,.pptx,.xlsx"
            onChange={(event) => {
              onFiles([...(event.target.files ?? [])])
              event.target.value = ''
            }}
          />
          {generating ? (
            <IconButton
              label={m.assistant_stop()}
              size="icon-sm"
              variant="secondary"
              className="rounded-full"
              onClick={onStop}
            >
              <Square className="fill-current" />
            </IconButton>
          ) : (
            <IconButton
              label={m.assistant_send()}
              size="icon-sm"
              variant="default"
              className="rounded-full"
              disabled={!canSend}
              onClick={() => void submit()}
            >
              <ArrowUp />
            </IconButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}
