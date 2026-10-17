/** Only follow same-origin paths after login; anything else falls back to the home page. */
export function safeRedirect(target: string | undefined | null): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) {
    return '/'
  }
  return target
}
