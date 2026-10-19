import { useLocation } from '@tanstack/react-router'
import { lazy, type ReactNode, Suspense, useState } from 'react'
import { useUiPref } from '@/app/ui-pref'
import { useIsMobile } from '@/hooks/use-mobile'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/ui/resizable'
import { Spinner } from '@/ui/spinner'
import { usePanel } from '../store'

// The conversation UI (Markdown, highlighting) loads the first time the panel opens.
const AssistantPanel = lazy(() =>
  import('./AssistantPanel').then((mod) => ({ default: mod.AssistantPanel })),
)

export const PANEL_MIN = 360
export const PANEL_MAX = 720
const PANEL_DEFAULT = 420

/** Pages where the panel would repeat what is on screen. */
const ASSISTANT_PAGE = /\/assistant(\/|$)/

/**
 * The app shell's content with the assistant docked on the right (M12 §6.1): 360–720 px wide,
 * dragged by its edge, and the width is remembered. Not on phones or on the assistant page.
 */
export function AssistantDock({ children }: { children: ReactNode }) {
  const { open } = usePanel()
  const isMobile = useIsMobile()
  const pathname = useLocation({ select: (l) => l.pathname })
  const shown = open && !isMobile && !ASSISTANT_PAGE.test(pathname)

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
      <ResizablePanel id="content" minSize={320} className="flex min-w-0">
        {children}
      </ResizablePanel>
      {shown ? <DockedPanel /> : null}
    </ResizablePanelGroup>
  )
}

/**
 * The panel itself, mounted while it is shown. Its default size is read once: a changing
 * `defaultSize` makes react-resizable-panels register the panel again, which ended every drag
 * after its first pixel step (the remembered width was fed back on each resize).
 */
function DockedPanel() {
  const [width, setWidth] = useUiPref('layout.assistant_width', PANEL_DEFAULT)
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
          if (previous) setWidth(Math.round(size.inPixels))
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
