/**
 * Copies text to the clipboard. The Clipboard API exists only in a secure context (https or
 * localhost); a self-hosted instance opened at `http://<LAN address>` falls back to a hidden
 * textarea and `execCommand('copy')`, which still works there during a click. Rejects when
 * neither does, so callers can say the copy failed.
 */
export async function copyText(text: string): Promise<void> {
  // oxlint-disable-next-line no-restricted-properties -- the one place with the fallback
  const clipboard = navigator.clipboard as Clipboard | undefined
  if (clipboard) return clipboard.writeText(text)
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  if (!copied) throw new Error('clipboard')
}
