import { createContext, type ReactNode, useContext } from 'react'
import { createPortal } from 'react-dom'

/**
 * Where a page can put a few controls in the app shell's top row, next to the sidebar button,
 * instead of a header of its own (the assistant page). `undefined`: no shell around the page.
 */
export const ShellToolbarSlot = createContext<HTMLElement | null | undefined>(undefined)

/**
 * Whether the app sidebar is open wide (not the icon rail, not a phone), so a page's
 * `sidebarNav` is on screen and the page can leave out its own switcher. False without a shell.
 */
export const ShellSidebarOpen = createContext(false)

export function useShellSidebarOpen(): boolean {
  return useContext(ShellSidebarOpen)
}

/** Renders `children` in the shell's top row; without a shell (tests) it renders them in place. */
export function ShellToolbar({ children }: { children: ReactNode }) {
  const slot = useContext(ShellToolbarSlot)
  if (slot === undefined) return <div className="flex items-center gap-1">{children}</div>
  return slot ? createPortal(children, slot) : null
}
