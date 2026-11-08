import { type ComponentProps, Suspense } from 'react'
import { preloadable } from '@/app/extensions'
import { finishImport, useOpenImport } from '../launcher'
import type { ImportDialog as Dialog } from './ImportDialog'

// The dialog (pickers, review, editors) loads the first time an import opens.
const ImportDialog = preloadable<ComponentProps<typeof Dialog>>(() =>
  import('./ImportDialog').then((mod) => ({ default: mod.ImportDialog })),
)

/** Renders the import dialog an import source opened (an app-wide overlay, see `launcher.ts`). */
export function ImportHost() {
  const open = useOpenImport()
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <ImportDialog key={open.id} request={open.request} onClose={finishImport} />
    </Suspense>
  )
}
