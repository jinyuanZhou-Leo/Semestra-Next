import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { Bold, Italic, List, ListChecks, type LucideIcon, Sheet } from 'lucide-react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Toggle } from '@/ui/toggle'
import { LinkButton } from './LinkButton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

// Toolbar buttons must not take focus from the editor, or the toolbar would hide.
const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault()

function Mark({
  icon: Icon,
  label,
  pressed,
  onToggle,
}: {
  icon: LucideIcon
  label: string
  pressed: boolean
  onToggle: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            size="sm"
            aria-label={label}
            pressed={pressed}
            onMouseDown={keepFocus}
            onPressedChange={onToggle}
            className="h-7 min-w-7 px-1.5"
          />
        }
      >
        <Icon aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** The note's formatting bar (M14 §4), shown while the note is being edited. */
export function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      bullet: e.isActive('bulletList'),
      task: e.isActive('taskList'),
      link: e.isActive('link'),
      table: e.isActive('table'),
    }),
  })
  const chain = () => editor.chain().focus()
  return (
    <div className="flex items-center gap-0.5 rounded-full border bg-popover p-0.5 text-popover-foreground shadow-md">
      <Mark
        icon={Bold}
        label={m.sticky_format_bold()}
        pressed={state.bold}
        onToggle={() => chain().toggleBold().run()}
      />
      <Mark
        icon={Italic}
        label={m.sticky_format_italic()}
        pressed={state.italic}
        onToggle={() => chain().toggleItalic().run()}
      />
      <Mark
        icon={List}
        label={m.sticky_format_list()}
        pressed={state.bullet}
        onToggle={() => chain().toggleBulletList().run()}
      />
      <Mark
        icon={ListChecks}
        label={m.sticky_format_task()}
        pressed={state.task}
        onToggle={() => chain().toggleTaskList().run()}
      />
      <LinkButton editor={editor} active={state.link} />
      {state.table ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={m.sticky_table()}
                      className="size-7 rounded-full bg-muted"
                    />
                  }
                />
              }
            >
              <Sheet aria-hidden />
            </TooltipTrigger>
            <TooltipContent>{m.sticky_table()}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="top" finalFocus={false} className="min-w-40">
            <DropdownMenuItem onClick={() => chain().addRowBefore().run()}>
              {m.sticky_table_row_above()}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => chain().addRowAfter().run()}>
              {m.sticky_table_row_below()}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => chain().addColumnBefore().run()}>
              {m.sticky_table_column_left()}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => chain().addColumnAfter().run()}>
              {m.sticky_table_column_right()}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => chain().deleteRow().run()}>
              {m.sticky_table_delete_row()}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => chain().deleteColumn().run()}>
              {m.sticky_table_delete_column()}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => chain().deleteTable().run()}>
              {m.sticky_table_delete()}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Mark
          icon={Sheet}
          label={m.sticky_table_insert()}
          pressed={false}
          onToggle={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        />
      )}
    </div>
  )
}
