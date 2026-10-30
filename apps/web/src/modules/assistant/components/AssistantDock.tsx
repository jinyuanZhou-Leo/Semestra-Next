import { useLocation } from '@tanstack/react-router'
import { type ReactNode, Suspense, useEffect, useState } from 'react'
import { preload, preloadable } from '@/app/extensions'
import { useUiPref } from '@/app/ui-pref'
import { whenSettled } from '@/lib/when-settled'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/ui/resizable'
import { Spinner } from '@/ui/spinner'
import { panel, usePanel } from '../store'

// The conversation UI (the editor, Markdown) is not part of the first load: it loads once the page
// has settled, or when the panel opens before that.
const AssistantPanel = preloadable<object>(() =>
  import('./AssistantPanel').then((mod) => ({ default: mod.AssistantPanel })),
)

export const PANEL_MIN = 360
export const PANEL_MAX = 720
const PANEL_DEFAULT = 420

/** Pages where the panel would repeat what is on screen. */
const ASSISTANT_PAGE = /\/assistant(\/|$)/

/**
 * The app shell's content with the assistant docked on the right (M12 §6.1): 360–720 px wide,
 * dragged by its edge, and the width is remembered. Not on the assistant page.
 */
export function AssistantDock({ children }: { children: ReactNode }) {
  const { open } = usePanel()
  const pathname = useLocation({ select: (l) => l.pathname })
  const href = useLocation({ select: (l) => l.href })
  // The full page's hand-over to the panel goes back to the page before it.
  useEffect(() => {
    if (!ASSISTANT_PAGE.test(href)) panel.setReturnTo(href)
  }, [href])
  useEffect(() => whenSettled(() => void preload(AssistantPanel)), [])
  const shown = open && !ASSISTANT_PAGE.test(pathname)
  // Read here, where it is always mounted, so the remembered width stays in the cache.
  const [width, setWidth] = useUiPref('layout.assistant_width', PANEL_DEFAULT)

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
      <ResizablePanel id="content" minSize={320} className="flex min-w-0">
        {children}
      </ResizablePanel>
      {shown ? <DockedPanel width={width} onWidth={setWidth} /> : null}
    </ResizablePanelGroup>
  )
}

/**
 * The panel itself, mounted while it is shown. Its default size is read once: a changing
 * `defaultSize` makes react-resizable-panels register the panel again, which ended every drag
 * after its first pixel step (the remembered width was fed back on each resize).
 */
function DockedPanel({ width, onWidth }: { width: number; onWidth: (width: number) => void }) {
  const [defaultSize] = useState(() => Math.min(PANEL_MAX, Math.max(PANEL_MIN, width)))
  return (
    <>
      <ResizableHandle />
      <ResizablePanel
        id="assistant"
        defaultSize={defaultSize}
        minSize={PANEL_MIN}
        maxSize={PANEL_MAX}
        groupResizeBehavior="preserve-pixel-size"
        onResize={(size, _id, previous) => {
          // Only a drag changes the remembered width, not the first layout.
          if (previous) onWidth(Math.round(size.inPixels))
        }}
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Spinner aria-hidden />
            </div>
          }
        >
          <AssistantPanel />
        </Suspense>
      </ResizablePanel>
    </>
  )
}
