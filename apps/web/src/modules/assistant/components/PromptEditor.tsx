import type { AgentScope, AgentSkillInfo, Course, Term } from '@semestra/api-client'
import { agentSkillListOptions } from '@semestra/api-client/react-query'
import { Popover } from '@base-ui/react/popover'
import { useQuery } from '@tanstack/react-query'
import { Extension, type JSONContent, type Range } from '@tiptap/core'
import { Document } from '@tiptap/extension-document'
import { HardBreak } from '@tiptap/extension-hard-break'
import { Mention } from '@tiptap/extension-mention'
import { Paragraph } from '@tiptap/extension-paragraph'
import { Text } from '@tiptap/extension-text'
import { Placeholder, UndoRedo } from '@tiptap/extensions'
import { Fragment, type Node as PmNode, type Schema, Slice } from '@tiptap/pm/model'
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
import { rank } from '@/app/commands/rank'
import { courseLabel } from '@/modules/academics/color'
import { courseTermId } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Command, CommandGroup, CommandItem, CommandList, CommandShortcut } from '@/ui/command'
import { skillTitle } from '../labels'
import { type Chip, chipNode, chipOf, type PromptValue, readPrompt } from '../prompt'
import { termScope, useProgramEntities } from '../scope'
import { ChipCourses, RefChip } from './RefChip'

/** The editable area's look, shared with the composer's stand-in while the editor is created. */
export const PROMPT_CLASS =
  'max-h-48 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 min-h-12 w-full overflow-y-auto px-3 py-2.5 text-base leading-6 wrap-break-word whitespace-pre-wrap outline-none md:text-sm [&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:float-left [&_.is-editor-empty:first-child]:before:h-0 [&_.is-editor-empty:first-child]:before:text-muted-foreground [&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]'

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
  /** What is written now, before `onChange` has re-rendered the caller (null before it exists). */
  read: () => PromptValue | null
  /** Puts `/compact` first in place of a skill, keeping the text. */
  startCompact: () => void
}

/**
 * `@` also works right after Chinese or Japanese text and full-width punctuation, where no space
 * comes before it; `a@b` still does not open the menu.
 */
const AFTER_CJK = [' ', '\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef']

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
      {hint ? <CommandShortcut className="truncate tracking-normal">{hint}</CommandShortcut> : null}
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

const isLead = (chip: Chip | null) => chip?.kind === 'skill' || chip?.kind === 'command'

/**
 * Pasted skills and `/compact` become text: they come from the `/` menu, first in the input. The
 * rest of a paste only holds what the input does (paragraphs, line breaks, text and chips).
 */
function leadsAsText(content: Fragment, schema: Schema): Fragment {
  const nodes: PmNode[] = []
  content.forEach((node) => {
    const chip = node.type.name === 'mention' ? chipOf(node.attrs) : null
    if (chip && isLead(chip)) nodes.push(schema.text(`/${chip.label}`))
    else nodes.push(node.isLeaf ? node : node.copy(leadsAsText(node.content, schema)))
  })
  return Fragment.fromArray(nodes)
}

/** The skill or `/compact` chip that starts the input. */
function leadNode(doc: PmNode): PmNode | null {
  const first = doc.firstChild?.firstChild
  return first?.type.name === 'mention' && isLead(chipOf(first.attrs)) ? first : null
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
              Decoration.widget(1 + first.content.size, hint, { side: 1, key: 'compact-hint' }),
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
  menuSide = 'top',
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
  /** Where the menu opens when there is room: above the input, or below it. */
  menuSide?: 'top' | 'bottom'
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

  // Chinese input methods type `、` for `/` and `＠` for `@` in their punctuation modes.
  const trigger = (char: string, menuChar: '/' | '@') => ({
    char,
    items: () => [],
    allowedPrefixes: menuChar === '@' ? AFTER_CJK : undefined,
    // A skill or `/compact` starts the input, and there is one at most.
    allow: ({ state, range }: { state: EditorState; range: Range }) =>
      menuChar === '@' || (slash && range.from === 1 && leadNode(state.doc) === null),
    render: () => ({
      onStart: (props: { query: string; range: Range }) => {
        setMenu({ char: menuChar, query: props.query, range: props.range })
        setActive(0)
      },
      onUpdate: (props: { query: string; range: Range }) => {
        setMenu({ char: menuChar, query: props.query, range: props.range })
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
        // Mentions copied from other apps stay their text: only this input's chips are chips.
        parseHTML: () => [
          {
            tag: 'span[data-type="mention"]',
            getAttrs: (element) =>
              chipOf({ id: element.dataset.id, label: element.dataset.label }) ? null : false,
          },
        ],
      }).configure({
        deleteTriggerWithBackspace: true,
        renderText: ({ node }) => `${node.attrs.mentionSuggestionChar}${node.attrs.label}`,
        suggestions: [trigger('/', '/'), trigger('、', '/'), trigger('@', '@'), trigger('＠', '@')],
      }),
    ],
    content: initialContent ?? undefined,
    editable: !disabled,
    editorProps: {
      transformPasted: (slice, view) =>
        new Slice(leadsAsText(slice.content, view.state.schema), slice.openStart, slice.openEnd),
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-autocomplete': 'list',
        'aria-label': label,
        'data-slot': 'input-group-control',
        class: PROMPT_CLASS,
      },
    },
    onUpdate: ({ editor: e }) => {
      const doc = e.getJSON()
      onChange(readPrompt(doc), doc)
    },
  })

  // Matched like the command palette: prefixes first, then substrings and pinyin initials.
  const candidates: { key: string; title: string; keywords: string[]; option: Option }[] = []
  if (menu?.char === '/') {
    if (canCompact) {
      const option: Option = { id: 'compact', kind: 'compact' }
      candidates.push({
        key: option.id,
        title: m.assistant_compact(),
        keywords: ['compact'],
        option,
      })
    }
    for (const s of skills) {
      if (!s.command) continue
      const option: Option = { id: `skill-${s.name}`, kind: 'skill', skill: s }
      candidates.push({
        key: option.id,
        title: skillTitle(s.title, s.name),
        keywords: [s.command.slice(1)],
        option,
      })
    }
  } else if (menu) {
    for (const course of courses) {
      const option: Option = { id: `course-${course.id}`, kind: 'course', course }
      candidates.push({
        key: option.id,
        title: courseLabel(course),
        keywords: [course.code ?? '', course.title, course.alias ?? ''],
        option,
      })
    }
    for (const term of terms) {
      const option: Option = { id: `term-${term.id}`, kind: 'term', term }
      candidates.push({ key: option.id, title: term.name, keywords: [], option })
    }
  }
  const shown = menu
    ? rank(candidates, menu.query)
        .slice(0, 8)
        .map((c) => c.option)
    : []
  const current = shown[Math.min(active, shown.length - 1)]

  // Tiptap keeps the editable state it was created with.
  useEffect(() => {
    if (!editor) return
    if (editor.isEditable === disabled) editor.setEditable(!disabled, false)
    if (disabled) editor.view.dom.setAttribute('aria-disabled', 'true')
    else editor.view.dom.removeAttribute('aria-disabled')
  }, [editor, disabled])

  // The menu and its highlighted choice are announced from the input while it is open.
  const currentId = current?.id
  useEffect(() => {
    const dom = editor?.view.dom
    if (!dom) return
    const item =
      currentId === undefined
        ? null
        : document
            .getElementById(`${id}-menu`)
            ?.querySelector(`[cmdk-item][data-value="${currentId}"]`)
    if (currentId !== undefined) dom.setAttribute('aria-controls', `${id}-menu`)
    else dom.removeAttribute('aria-controls')
    if (item?.id) dom.setAttribute('aria-activedescendant', item.id)
    else dom.removeAttribute('aria-activedescendant')
  }, [editor, id, currentId])

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus('end'),
    setContent: (doc) => editor?.commands.setContent(doc ?? '', { emitUpdate: true }),
    read: () => (editor ? readPrompt(editor.getJSON()) : null),
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
      {/* Over the page, along the input box: a message being edited sits in a list that cuts off
          what overflows it. Focus stays in the input. */}
      <Popover.Root open={shown.length > 0}>
        <Popover.Portal>
          <Popover.Positioner
            anchor={() => editor?.view.dom.closest('[data-slot="input-group"]') ?? null}
            side={menuSide}
            sideOffset={8}
            className="isolate z-50"
          >
            <Popover.Popup initialFocus={false} finalFocus={false} className="outline-none">
              <Command
                shouldFilter={false}
                value={current?.id ?? ''}
                className="h-auto w-(--anchor-width) rounded-2xl border shadow-md"
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
                    <MenuGroup
                      heading={m.assistant_references_menu()}
                      options={shown}
                      onPick={pick}
                    />
                  )}
                </CommandList>
              </Command>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <EditorContent
        editor={editor}
        className={className}
        onKeyDownCapture={onKeyDownCapture}
        onPasteCapture={onPasteCapture}
      />
    </ChipCourses>
  )
}
