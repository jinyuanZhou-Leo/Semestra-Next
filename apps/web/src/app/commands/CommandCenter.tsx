import { Fragment, lazy, Suspense, useEffect, useState } from 'react'
import { m } from '@/paraglide/messages'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from '@/ui/item'
import { Kbd } from '@/ui/kbd'
import { scopePath } from '../extensions'
import { formatHotkey, useHotkey, useListedHotkeys } from '../hotkeys'
import { useModules, usePages } from '../registry'
import { openCommandPalette, setPalette, usePaletteState, useHostAction } from './bus'
import { useCommandContext } from './context'

// The palette and its pinyin dictionary (~300 KB) stay out of the first bundle: they load the
// first time the palette opens, or once the page has settled, whichever comes first.
const CommandPalette = lazy(() =>
  import('./CommandPalette').then((mod) => ({ default: mod.CommandPalette })),
)
const PALETTE_LOAD_DELAY_MS = 2000

function useSettled(): boolean {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), PALETTE_LOAD_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  return settled
}

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.hotkeys_title()}</DialogTitle>
        </DialogHeader>
        <ItemGroup className="gap-0">
          {rows.map((hotkey, index) => (
            <Fragment key={hotkey.id}>
              {index > 0 ? <ItemSeparator className="my-0" /> : null}
              <Item render={<li />} size="xs" className="px-0">
                <ItemContent>
                  <ItemTitle className="font-normal">{hotkey.description()}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Kbd>{formatHotkey(hotkey.keys)}</Kbd>
                </ItemActions>
              </Item>
            </Fragment>
          ))}
        </ItemGroup>
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
  const settled = useSettled()

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
      {palette.open || settled ? (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      ) : null}
      <HotkeysHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  )
}
