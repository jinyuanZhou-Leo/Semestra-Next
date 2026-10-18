import { useState } from 'react'
import { m } from '@/paraglide/messages'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Kbd } from '@/ui/kbd'
import { scopePath } from '../extensions'
import { formatHotkey, useHotkey, useListedHotkeys } from '../hotkeys'
import { useModules, usePages } from '../registry'
import { openCommandPalette, setPalette, usePaletteState, useHostAction } from './bus'
import { CommandPalette } from './CommandPalette'
import { useCommandContext } from './context'

function HotkeysHelp({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const hotkeys = useListedHotkeys()
  const seen = new Set<string>()
  const rows = hotkeys.filter((hotkey) => {
    const id = `${hotkey.keys}|${hotkey.description()}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={m.common_close()}>
        <DialogHeader>
          <DialogTitle>{m.hotkeys_title()}</DialogTitle>
        </DialogHeader>
        <dl className="divide-y divide-border">
          {rows.map((hotkey) => (
            <div key={hotkey.id} className="flex items-center justify-between gap-4 py-2 text-sm">
              <dt>{hotkey.description()}</dt>
              <dd>
                <Kbd>{formatHotkey(hotkey.keys)}</Kbd>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The global shortcuts and what they open (M10 §5.5): the command palette, the assistant (when a
 * module provides one), "go to today", and this list (`?`). Mounted in the signed-in layout.
 */
export function CommandCenter() {
  const ctx = useCommandContext()
  const palette = usePaletteState()
  const [helpOpen, setHelpOpen] = useState(false)
  const assistant = useModules().find((module) => module.assistant)?.assistant
  const program = { kind: 'program', programId: ctx.programId ?? '' } as const
  const hasToday = usePages(program).some((page) => page.id === 'today') && !!ctx.programId

  useHotkey(
    'mod+k',
    () => (palette.open ? setPalette({ open: false, query: '' }) : openCommandPalette()),
    {
      description: m.hotkeys_palette,
      order: 10,
      allowInInputs: true,
    },
  )
  useHotkey('mod+j', () => assistant?.open(ctx), {
    enabled: assistant !== undefined,
    description: m.hotkeys_assistant,
    order: 20,
    allowInInputs: true,
  })
  useHotkey('g>t', () => ctx.navigate(scopePath(program, 'today')), {
    enabled: hasToday,
    description: m.hotkeys_today,
    order: 40,
  })
  useHotkey('?', () => setHelpOpen(true), { description: m.hotkeys_help, order: 90, useKey: true })
  useHostAction('hotkeys.help', () => setHelpOpen(true))

  return (
    <>
      <CommandPalette />
      <HotkeysHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  )
}
