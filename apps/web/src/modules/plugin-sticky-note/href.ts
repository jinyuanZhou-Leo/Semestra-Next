/**
 * Which link addresses a note keeps (M14 §4): web, mail, phone and chat links, or an address
 * without a scheme. Anything else (`javascript:`, `data:`, `vbscript:`…) keeps its text but loses
 * its address, in the editor (Tiptap's `Link.isAllowedUri`) and in the read-only view alike. The
 * schemes are Tiptap's default list.
 */
const SCHEMES = new Set([
  'http',
  'https',
  'ftp',
  'ftps',
  'mailto',
  'tel',
  'callto',
  'sms',
  'cid',
  'xmpp',
])

// Browsers ignore whitespace and control characters inside a scheme (`java\tscript:`).
// oxlint-disable-next-line no-control-regex -- control characters are exactly what it removes
const IGNORED = /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g

export function isAllowedHref(href: string | undefined): boolean {
  if (!href) return true
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href.replace(IGNORED, ''))?.[1]
  return scheme === undefined || SCHEMES.has(scheme.toLowerCase())
}
