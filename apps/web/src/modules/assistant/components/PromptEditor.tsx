import type { AgentScope, AgentSkillInfo, Course, Term } from '@semestra/api-client'
import { agentSkillListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Extension, type JSONContent, type Range } from '@tiptap/core'
import { Document } from '@tiptap/extension-document'
import { HardBreak } from '@tiptap/extension-hard-break'
import { Mention } from '@tiptap/extension-mention'
import { Paragraph } from '@tiptap/extension-paragraph'
import { Text } from '@tiptap/extension-text'
import { Placeholder, UndoRedo } from '@tiptap/extensions'
import type { Node as PmNode } from '@tiptap/pm/model'
import { type EditorState, Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  EditorContent,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
} from '@tiptap/react'
import { BookOpen, CalendarRange, Minimize2, Sparkles } from 'lucide-react'
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useState,
} from 'react'
import { courseLabel } from '@/modules/academics/color'
import { courseTermId } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Command, CommandGroup, CommandItem, CommandList } from '@/ui/command'
import { skillTitle } from '../labels'
import { type Chip, chipNode, chipOf, type PromptValue, readPrompt } from '../prompt'
import { termScope, useProgramEntities } from '../scope'
import { ChipCourses, RefChip } from './RefChip'

/** `/compact`: what the `/` menu offers besides skills. */
const COMPACT = '/compact'

type Option =
  | { id: string; kind: 'compact' }
  | { id: string; kind: 'skill'; skill: AgentSkillInfo }
  | { id: string; kind: 'course'; course: Course }
  | { id: string; kind: 'term'; term: Term }

type OpenMenu = { char: '/' | '@'; query: string; range: Range }

export type PromptEditorHandle = {
  focus: () => void
  /** Replaces what is written; null empties the input. */
  setContent: (doc: JSONContent | null) => void
  /** Puts `/compact` first in place of a skill, keeping the text. */
  startCompact: () => void
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

function ChipView({ node }: NodeViewProps) {
  const chip = chipOf(node.attrs)
  return <NodeViewWrapper as="span">{chip ? <RefChip chip={chip} /> : null}</NodeViewWrapper>
}

const chipOfOption = (option: Option): Chip =>
  option.kind === 'compact'
    ? { kind: 'command', id: 'compact', label: m.assistant_compact() }
    : option.kind === 'skill'
      ? {
          kind: 'skill',
          id: option.skill.name,
          label: skillTitle(option.skill.title, option.skill.name),
        }
      : option.kind === 'course'
        ? { kind: 'course', id: option.course.id, label: courseLabel(option.course) }
        : { kind: 'term', id: option.term.id, label: option.term.name }

/** The skill or `/compact` chip that starts the input. */
function leadNode(doc: PmNode): PmNode | null {
  const first = doc.firstChild?.firstChild
  const kind = first?.type.name === 'mention' ? chipOf(first.attrs)?.kind : null
  return first && (kind === 'skill' || kind === 'command') ? first : null
}

/** After `/compact` with nothing else written: what the text is for. */
const CompactHint = Extension.create({
  name: 'compactHint',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const first = state.doc.firstChild
            if (state.doc.childCount !== 1 || !first) return null
            let compact = false
            let written = false
            first.forEach((node) => {
              if (node.type.name === 'mention' && chipOf(node.attrs)?.kind === 'command') {
                compact = true
              } else if (node.type.name !== 'text' || node.text?.trim()) {
                written = true
              }
            })
            if (!compact || written) return null
            const hint = () => {
              const span = document.createElement('span')
              span.className = 'pointer-events-none text-muted-foreground'
              span.textContent = m.assistant_compact_placeholder()
              return span
            }
            return DecorationSet.create(state.doc, [
              Decoration.widget(1 + first.content.size, hint, { side: 1 }),
            ])
          },
        },
      }),
    ]
  },
})

/**
 * The text input of the assistant (M12 §6.1), written with chips: `/` picks a skill or
 * `/compact` (first in the input), `@` a course or term (its term becomes where the assistant
 * works). Chips go as a whole with Backspace and copy as `/name` or `@name`. Enter sends and
 * Shift+Enter breaks the line; input methods keep their own Enter. Files pasted go to `onFiles`.
 */
export function PromptEditor({
  ref,
  label,
  placeholder,
  programId,
  slash = false,
  canCompact = false,
  disabled = false,
  initialContent,
  className,
  onChange,
  onEnter,
  onEscape,
  onFiles,
  onScope,
}: {
  ref?: Ref<PromptEditorHandle>
  label: string
  placeholder?: string
  programId: string | undefined
  /** Offers skills (and `/compact` when `canCompact`) with `/`. */
  slash?: boolean
  canCompact?: boolean
  disabled?: boolean
  /** What the input starts with. */
  initialContent?: JSONContent | null
  className?: string
  onChange: (value: PromptValue, doc: JSONContent) => void
  onEnter: () => void
  onEscape?: () => void
  onFiles?: (files: File[]) => void
  onScope?: (scope: AgentScope) => void
}) {
  const id = useId()
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [active, setActive] = useState(0)
  const skills =
    useQuery({ ...agentSkillListOptions(), staleTime: 5 * 60_000, enabled: slash }).data?.items ??
    []
  const { terms, courses } = useProgramEntities(programId)

  const trigger = (char: '/' | '@') => ({
    char,
    items: () => [],
    // A skill or `/compact` starts the input, and there is one at most.
    allow: ({ state, range }: { state: EditorState; range: Range }) =>
      char === '@' || (slash && range.from === 1 && leadNode(state.doc) === null),
    render: () => ({
      onStart: (props: { query: string; range: Range }) => {
        setMenu({ char, query: props.query, range: props.range })
        setActive(0)
      },
      onUpdate: (props: { query: string; range: Range }) => {
        setMenu({ char, query: props.query, range: props.range })
        setActive(0)
      },
      onExit: () => setMenu(null),
    }),
  })

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      UndoRedo,
      CompactHint,
      ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
      Mention.extend({
        addNodeView: () => ReactNodeViewRenderer(ChipView, { as: 'span' }),
      }).configure({
        deleteTriggerWithBackspace: true,
        renderText: ({ node }) => `${node.attrs.mentionSuggestionChar}${node.attrs.label}`,
        suggestions: [trigger('/'), trigger('@')],
      }),
    ],
    content: initialContent ?? undefined,
    editable: !disabled,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        'data-slot': 'input-group-control',
        class:
          'max-h-48 min-h-12 w-full overflow-y-auto px-3 py-2.5 text-base leading-6 wrap-break-word whitespace-pre-wrap outline-none md:text-sm [&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:float-left [&_.is-editor-empty:first-child]:before:h-0 [&_.is-editor-empty:first-child]:before:text-muted-foreground [&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
      },
    },
    onUpdate: ({ editor: e }) => {
      const doc = e.getJSON()
      onChange(readPrompt(doc), doc)
    },
  })

  const options: Option[] = []
  if (menu?.char === '/') {
    if (canCompact && matches(menu.query, COMPACT.slice(1), m.assistant_compact())) {
      options.push({ id: 'compact', kind: 'compact' })
    }
    for (const s of skills) {
      if (s.command && matches(menu.query, s.command.slice(1), skillTitle(s.title))) {
        options.push({ id: `skill-${s.name}`, kind: 'skill', skill: s })
      }
    }
  } else if (menu) {
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
  const shown = options.slice(0, 8)
  const current = shown[Math.min(active, shown.length - 1)]

  // Tiptap keeps the editable state it was created with.
  useEffect(() => {
    if (editor && editor.isEditable === disabled) editor.setEditable(!disabled, false)
  }, [editor, disabled])

  // The menu is announced from the input while it is open.
  useEffect(() => {
    const dom = editor?.view.dom
    if (!dom) return
    if (shown.length > 0) dom.setAttribute('aria-controls', `${id}-menu`)
    else dom.removeAttribute('aria-controls')
  }, [editor, id, shown.length])

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus('end'),
    setContent: (doc) => editor?.commands.setContent(doc ?? '', { emitUpdate: true }),
    startCompact: () => {
      if (!editor) return
      const compact = chipNode({ kind: 'command', id: 'compact', label: m.assistant_compact() })
      const lead = leadNode(editor.state.doc)
      const chain = editor.chain()
      if (lead) chain.insertContentAt({ from: 1, to: 1 + lead.nodeSize }, compact)
      else chain.insertContentAt(1, [compact, { type: 'text', text: ' ' }])
      chain.focus('end').run()
    },
  }))

  /** Replaces the `/…` or `@…` being typed with the choice. */
  function pick(option: Option) {
    if (!menu || !editor) return
    editor
      .chain()
      .focus()
      .insertContentAt(menu.range, [chipNode(chipOfOption(option)), { type: 'text', text: ' ' }])
      .run()
    if (programId && option.kind === 'course') {
      // The assistant works in a term at most: a course brings its term.
      onScope?.(termScope(programId, courseTermId(option.course, terms, undefined)))
    } else if (programId && option.kind === 'term') {
      onScope?.(termScope(programId, option.term.id))
    }
  }

  function onKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    // Chinese and Japanese input methods confirm a candidate with Enter.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    const handled = () => {
      event.preventDefault()
      event.stopPropagation()
    }
    if (shown.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        handled()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActive((i) => (Math.min(i, shown.length - 1) + step + shown.length) % shown.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        handled()
        if (current) pick(current)
        return
      }
      // Escape closes the menu in the editor.
      if (event.key === 'Escape') return
    }
    if (event.key === 'Escape' && onEscape) {
      handled()
      onEscape()
    } else if (event.key === 'Enter' && !event.shiftKey) {
      handled()
      onEnter()
    }
  }

  function onPasteCapture(event: ClipboardEvent<HTMLDivElement>) {
    const files = [...event.clipboardData.files]
    if (files.length > 0 && onFiles) {
      event.preventDefault()
      event.stopPropagation()
      onFiles(files)
    }
  }

  return (
    <ChipCourses value={courses}>
      {shown.length > 0 ? (
        <Command
          shouldFilter={false}
          value={current?.id ?? ''}
          className="absolute inset-x-0 bottom-full z-20 mb-2 h-auto rounded-2xl border shadow-md"
        >
          <CommandList
            id={`${id}-menu`}
            aria-label={
              menu?.char === '/' ? m.assistant_skills_menu() : m.assistant_references_menu()
            }
          >
            {menu?.char === '/' ? (
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
      <EditorContent
        editor={editor}
        className={className}
        onKeyDownCapture={onKeyDownCapture}
        onPasteCapture={onPasteCapture}
      />
    </ChipCourses>
  )
}
