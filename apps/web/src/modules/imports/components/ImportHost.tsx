import { useLocation, useParams, useRouter } from '@tanstack/react-router'
import { type ComponentProps, Suspense, useEffect } from 'react'
import { preloadable } from '@/app/extensions'
import { finishImport, openImport, useOpenImport } from '../launcher'
import type { ImportDialog as Dialog } from './ImportDialog'

// The dialog (pickers, review, editors) loads the first time an import opens.
const ImportDialog = preloadable<ComponentProps<typeof Dialog>>(() =>
  import('./ImportDialog').then((mod) => ({ default: mod.ImportDialog })),
)

/** `?import=<session>` (a notification's link) opens that import where it stands. */
const PARAM = 'import'

/** Renders the import dialog an import source opened (an app-wide overlay, see `launcher.ts`). */
export function ImportHost() {
  const open = useOpenImport()
  const router = useRouter()
  const { pathname, searchStr, hash } = useLocation()
  const { programId } = useParams({ strict: false }) as { programId?: string }
  const wanted = new URLSearchParams(searchStr).get(PARAM)
  useEffect(() => {
    if (!wanted || !programId) return
    const params = new URLSearchParams(searchStr)
    params.delete(PARAM)
    const query = params.toString()
    router.history.replace(`${pathname}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`)
    void openImport({ programId, mode: 'direct', source: 'session', sessionId: wanted })
  }, [wanted, programId, pathname, searchStr, hash, router])
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <ImportDialog key={open.id} request={open.request} onClose={finishImport} />
    </Suspense>
  )
}
