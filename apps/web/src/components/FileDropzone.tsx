import { FileUp } from 'lucide-react'
import { type Accept, useDropzone } from 'react-dropzone'
import { toast } from 'sonner'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Spinner } from '@/ui/spinner'

/**
 * A box to drop files on or select to choose them (imports, backup restore). Files of the wrong
 * type or over `maxSize` are refused with a toast; with `multiple` off, extra files are dropped
 * silently. `pending` (e.g. while uploading) shows a spinner and that text, and takes no files.
 * Files dragged onto existing content use `FileDropOverlay` instead.
 */
export function FileDropzone({
  title,
  hint,
  accept,
  multiple = false,
  maxSize,
  disabled = false,
  pending,
  onFiles,
  className,
}: {
  title: string
  hint?: string
  accept?: Accept
  multiple?: boolean
  maxSize?: number
  disabled?: boolean
  pending?: string
  onFiles: (files: File[]) => void
  className?: string
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
    multiple,
    maxSize,
    disabled: disabled || pending !== undefined,
    onDropAccepted: onFiles,
    onDropRejected: (rejected) => {
      for (const { file, errors } of rejected) {
        const code = errors[0]?.code
        if (code === 'too-many-files') continue
        toast.error(
          code === 'file-too-large' && maxSize
            ? m.common_file_too_large({ name: file.name, max: formatBytes(maxSize) })
            : m.common_file_type_unsupported({ name: file.name }),
        )
      }
    },
  })
  return (
    <div
      {...getRootProps({
        className: cn(
          'flex h-40 shrink-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 text-center text-sm text-muted-foreground transition-colors outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          isDragActive && 'border-primary bg-primary/5',
          disabled && 'pointer-events-none opacity-50',
          pending !== undefined && 'pointer-events-none',
          className,
        ),
      })}
    >
      <input {...getInputProps()} aria-label={title} />
      <span
        className={cn(
          'flex size-10 items-center justify-center rounded-full bg-muted text-foreground transition-colors',
          isDragActive && 'bg-primary text-primary-foreground',
        )}
      >
        {pending !== undefined ? <Spinner /> : <FileUp aria-hidden className="size-5" />}
      </span>
      <span className="text-foreground">
        {pending ?? (isDragActive ? m.common_drop_to_add() : title)}
      </span>
      {hint ? <span className="text-xs">{hint}</span> : null}
    </div>
  )
}
