import type { AgentScope, AgentSkillInfo, Course, Term } from '@semestra/api-client'
import { agentSkillListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowUp,
  BookOpen,
  CalendarRange,
  FileText,
  Minimize2,
  Plus,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'
import { courseLabel } from '@/modules/academics/color'
import { courseTermId } from '@/modules/academics/queries'
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
import { Badge } from '@/ui/badge'
import { Command, CommandGroup, CommandItem, CommandList } from '@/ui/command'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/ui/input-group'
import { Spinner } from '@/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { skillTitle } from '../labels'
import { termScope, useProgramEntities } from '../scope'
import { ContextMeter } from './ContextMeter'

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
}

/** `/compact`: what the `/` menu offers besides skills. */
const COMPACT = '/compact'

type Option =
  | { id: string; kind: 'compact' }
  | { id: string; kind: 'skill'; skill: AgentSkillInfo }
  | { id: string; kind: 'course'; course: Course }
  | { id: string; kind: 'term'; term: Term }

/** The open `/` or `@` menu, from the text before the caret. */
function trigger(
  text: string,
  caret: number,
): { kind: '/' | '@'; query: string; start: number } | null {
  const before = text.slice(0, caret)
  const slash = /^\/(\S*)$/.exec(before)
  if (slash) return { kind: '/', query: slash[1] ?? '', start: 0 }
  const at = /(^|\s)@(\S*)$/.exec(before)
  if (at) return { kind: '@', query: at[2] ?? '', start: before.length - (at[2] ?? '').length - 1 }
  return null
}

function matches(query: string, ...texts: (string | null | undefined)[]) {
  const q = query.toLowerCase()
  return texts.some((t) => t?.toLowerCase().includes(q))
}

function OptionLabel({ option }: { option: Option }) {
  const [icon, label, hint] =
    option.kind === 'compact'
      ? [<Minimize2 key="i" aria-hidden />, m.assistant_compact(), COMPACT]
      : option.kind === 'skill'
        ? [
            <Sparkles key="i" aria-hidden />,
            skillTitle(option.skill.title, option.skill.name),
            option.skill.command,
          ]
        : option.kind === 'course'
          ? [<BookOpen key="i" aria-hidden />, courseLabel(option.course), option.course.title]
          : [<CalendarRange key="i" aria-hidden />, option.term.name, null]
  return (
    <>
      {icon}
      <span className="truncate">{label}</span>
      {hint ? <span className="ml-auto truncate text-xs text-muted-foreground">{hint}</span> : null}
    </>
  )
}

function MenuGroup({
  heading,
  options,
  onPick,
}: {
  heading: string
  options: Option[]
  onPick: (option: Option) => void
}) {
  if (options.length === 0) return null
  return (
    <CommandGroup heading={heading}>
      {options.map((option) => (
        <CommandItem
          key={option.id}
          value={option.id}
          onMouseDown={(event) => event.preventDefault()}
          onSelect={() => onPick(option)}
        >
          <OptionLabel option={option} />
        </CommandItem>
      ))}
    </CommandGroup>
  )
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
 * skill, `@` refers to a course or term (its term becomes where the assistant works), files can
 * be attached, pasted or dropped, and a running answer can be stopped.
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
  initialText = '',
  onTextChange,
  context,
  canCompact = false,
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
  /** Text the input starts with (a draft carried over from the other view). */
  initialText?: string
  /** Reports the text being typed. */
  onTextChange?: (text: string) => void
  /** How full the conversation's context is, once a request measured it. */
  context?: { used: number; window: number } | null
  /** There are turns before the last message to compact. */
  canCompact?: boolean
  /** Compacts the conversation now (`/compact` or the context ring), keeping `focus`. */
  onCompact?: (focus: string) => Promise<boolean>
}) {
  const id = useId()
  const [text, setText] = useState(initialText)
  const [caret, setCaret] = useState(0)
  const [skill, setSkill] = useState<AgentSkillInfo | null>(null)
  // `/compact` picked: the text is what to keep, and sending compacts.
  const [compacting, setCompacting] = useState(false)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)
  const skills = useQuery({ ...agentSkillListOptions(), staleTime: 5 * 60_000 }).data?.items ?? []
  const { terms, courses } = useProgramEntities(programId)

  // Opening the assistant means typing.
  useEffect(() => {
    if (focusInput) textarea.current?.focus()
  }, [focusInput])

  const reportText = useEffectEvent((value: string) => onTextChange?.(value))
  useEffect(() => {
    reportText(text)
  }, [text])

  const menu = trigger(text, caret)
  const menuKey = menu ? `${menu.kind}${menu.start}` : null
  const options: Option[] = []
  if (menu && menuKey !== dismissed) {
    if (menu.kind === '/') {
      if (onCompact && canCompact && matches(menu.query, COMPACT.slice(1), m.assistant_compact())) {
        options.push({ id: 'compact', kind: 'compact' })
      }
      for (const s of skills) {
        if (s.command && matches(menu.query, s.command.slice(1), skillTitle(s.title))) {
          options.push({ id: `skill-${s.name}`, kind: 'skill', skill: s })
        }
      }
    } else {
      for (const course of courses) {
        if (matches(menu.query, course.code, course.alias, course.title)) {
          options.push({ id: `course-${course.id}`, kind: 'course', course })
        }
      }
      for (const term of terms) {
        if (matches(menu.query, term.name))
          options.push({ id: `term-${term.id}`, kind: 'term', term })
      }
    }
  }
  const shown = options.slice(0, 8)
  const current = shown[Math.min(active, shown.length - 1)]

  /** Replaces the `/…` or `@…` being typed with the choice. */
  function pick(option: Option) {
    if (!menu) return
    const insert =
      option.kind === 'skill' || option.kind === 'compact'
        ? ''
        : `@${option.kind === 'course' ? courseLabel(option.course) : option.term.name} `
    const next = text.slice(0, menu.start) + insert + text.slice(caret)
    const position = menu.start + insert.length
    // Render the new text now so the caret lands before the user's next keystroke.
    flushSync(() => {
      setText(next)
      setCaret(position)
      setActive(0)
    })
    textarea.current?.focus()
    textarea.current?.setSelectionRange(position, position)
    if (option.kind === 'compact') {
      setCompacting(true)
      setSkill(null)
    } else if (option.kind === 'skill') {
      setSkill(option.skill)
      setCompacting(false)
    } else if (programId && option.kind === 'course') {
      // The assistant works in a term at most: a course brings its term.
      onScope(termScope(programId, courseTermId(option.course, terms, undefined)))
    } else if (programId && option.kind === 'term') {
      onScope(termScope(programId, option.term.id))
    }
  }

  const uploading = attachments.some((a) => a.id === null && a.error === null)
  const ready = attachments.filter((a) => a.id !== null)
  const canSend =
    !disabled &&
    !generating &&
    !uploading &&
    (compacting || text.trim() !== '' || ready.length > 0 || skill !== null)

  async function submit() {
    // `canSend` is from the last render: a second Enter before it re-renders would send twice.
    if (!canSend || submitting.current) return
    submitting.current = true
    const sent = { text, skill }
    const compact = compacting && onCompact
    setText('')
    setSkill(null)
    setCompacting(false)
    setCaret(0)
    const ok = await (compact ? compact(text.trim()) : onSubmit(sent)).finally(() => {
      submitting.current = false
    })
    if (!ok) {
      setText(sent.text)
      setSkill(sent.skill)
      setCompacting(Boolean(compact))
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Chinese and Japanese input methods confirm a candidate with Enter.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (shown.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActive((i) => (Math.min(i, shown.length - 1) + step + shown.length) % shown.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        if (current) pick(current)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissed(menuKey)
        return
      }
    }
    if (event.key === 'Backspace' && (skill || compacting) && text === '') {
      setSkill(null)
      setCompacting(false)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <div className="relative">
      {shown.length > 0 ? (
        <Command
          shouldFilter={false}
          value={current?.id ?? ''}
          className="absolute inset-x-0 bottom-full z-20 mb-2 h-auto rounded-2xl border shadow-md"
        >
          <CommandList
            id={`${id}-menu`}
            aria-label={
              menu?.kind === '/' ? m.assistant_skills_menu() : m.assistant_references_menu()
            }
          >
            {menu?.kind === '/' ? (
              <>
                <MenuGroup
                  heading={m.assistant_commands_menu()}
                  options={shown.filter((o) => o.kind === 'compact')}
                  onPick={pick}
                />
                <MenuGroup
                  heading={m.assistant_skills_menu()}
                  options={shown.filter((o) => o.kind === 'skill')}
                  onPick={pick}
                />
              </>
            ) : (
              <MenuGroup heading={m.assistant_references_menu()} options={shown} onPick={pick} />
            )}
          </CommandList>
        </Command>
      ) : null}
      <InputGroup className="rounded-2xl">
        {skill || compacting || attachments.length > 0 ? (
          <InputGroupAddon align="block-start" className="flex-wrap justify-start gap-1.5">
            {compacting ? (
              <Badge variant="secondary" className="gap-1">
                <Minimize2 aria-hidden />
                {m.assistant_compact()}
                <button
                  type="button"
                  aria-label={m.assistant_command_remove()}
                  className="-mr-1 rounded-full opacity-70 hover:opacity-100"
                  onClick={() => setCompacting(false)}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ) : null}
            {skill ? (
              <Badge variant="secondary" className="gap-1">
                <Sparkles aria-hidden />
                {skillTitle(skill.title, skill.name)}
                <button
                  type="button"
                  aria-label={m.assistant_skill_remove()}
                  className="-mr-1 rounded-full opacity-70 hover:opacity-100"
                  onClick={() => setSkill(null)}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ) : null}
            {attachments.length > 0 ? (
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
            ) : null}
          </InputGroupAddon>
        ) : null}
        <InputGroupTextarea
          ref={textarea}
          aria-label={m.assistant_input_label()}
          aria-controls={shown.length > 0 ? `${id}-menu` : undefined}
          placeholder={
            compacting ? m.assistant_compact_placeholder() : m.assistant_input_placeholder()
          }
          className="max-h-48 min-h-12"
          value={text}
          disabled={disabled}
          onChange={(event) => {
            setText(event.target.value)
            setCaret(event.target.selectionStart)
            setActive(0)
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const files = [...event.clipboardData.files]
            if (files.length > 0) {
              event.preventDefault()
              onFiles(files)
            }
          }}
        />
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
            {context && onCompact ? (
              <ContextMeter
                used={context.used}
                window={context.window}
                canCompact={canCompact && !generating && !disabled}
                onCompact={(focus) => void onCompact(focus)}
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
