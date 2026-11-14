import { CircleAlert } from 'lucide-react'

/**
 * Why an import step failed, on the free left side of the dialog footer, so the action beside it
 * keeps its size and the dialog its height.
 */
export function FooterError({ text }: { text: string }) {
  return (
    <p role="alert" className="mr-auto flex min-w-0 items-center gap-1.5 text-sm text-destructive">
      <CircleAlert aria-hidden className="size-4 shrink-0" />
      <span className="truncate" title={text}>
        {text}
      </span>
    </p>
  )
}
