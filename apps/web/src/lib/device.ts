/** "Chrome on macOS" from a User-Agent string; good enough for a device list. */
export function deviceLabel(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null
  const ua = userAgent
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null
  if (browser && os) return `${browser} · ${os}`
  return browser ?? os ?? ua.slice(0, 40)
}
