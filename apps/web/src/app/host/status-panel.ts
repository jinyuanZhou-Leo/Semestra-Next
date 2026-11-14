/**
 * Asking the status bar to open a line's panel from elsewhere (a command, say). Apart from
 * `StatusBar.tsx` so a module manifest can ask without loading the bar itself.
 */
const requests = new EventTarget()

/** Opens the panel of a status line, if the line is there. */
export function openStatusPanel(id: string) {
  requests.dispatchEvent(new CustomEvent<string>('open', { detail: id }))
}

/** Calls `listener` with the id of each line asked to open; returns how to stop listening. */
export function onStatusPanelRequest(listener: (id: string) => void): () => void {
  const onRequest = (event: Event) => listener((event as CustomEvent<string>).detail)
  requests.addEventListener('open', onRequest)
  return () => requests.removeEventListener('open', onRequest)
}
