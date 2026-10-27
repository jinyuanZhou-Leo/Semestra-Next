/**
 * The boot screen in index.html (drawn by public/theme-init.js before the app loads) shows the
 * shell's frame when this browser has shown the shell before, collapsed or not as it was. The
 * value mirrors the UI preference `layout.sidebar_collapsed`; signing out removes it.
 */
const KEY = 'semestra.sidebar-collapsed'

export function readCollapsedMirror(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true'
  } catch {
    return false
  }
}

export function writeCollapsedMirror(collapsed: boolean) {
  try {
    localStorage.setItem(KEY, String(collapsed))
  } catch {
    // Storage unavailable: the boot screen shows the brand mark.
  }
}

export function clearCollapsedMirror() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing stored then.
  }
}
