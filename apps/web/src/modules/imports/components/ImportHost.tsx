import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { setImportQueryClient } from '../entries'
import { finishImport, useOpenImport } from '../launcher'
import { ImportDialog } from './ImportDialog'

/** Renders the import dialog an import source opened (an app-wide overlay, see `launcher.ts`). */
export function ImportHost() {
  const queryClient = useQueryClient()
  const open = useOpenImport()
  useEffect(() => {
    setImportQueryClient(queryClient)
    return () => setImportQueryClient(null)
  }, [queryClient])
  if (!open) return null
  return <ImportDialog key={open.id} request={open.request} onClose={finishImport} />
}
