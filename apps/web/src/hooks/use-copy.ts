import { useEffect, useState } from 'react'
import { copyText } from '@/lib/clipboard'
import { toastError } from '@/lib/errors'

/**
 * A copy button's state: `copy(text)` copies through `copyText` (which also works on a LAN address
 * over http), `copied` is true for two seconds after it succeeds, and a failure shows a toast.
 * Use this instead of shadcn's `CodeBlockCopyButton`, which calls the Clipboard API directly.
 */
export function useCopy(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timeout = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timeout)
  }, [copied])
  const copy = (text: string) =>
    void copyText(text).then(
      () => setCopied(true),
      () => toastError(new Error('clipboard')),
    )
  return { copied, copy }
}
