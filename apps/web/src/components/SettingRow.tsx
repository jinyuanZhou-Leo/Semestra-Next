import type { ReactNode } from 'react'

/** The bordered, divided list that holds a section's rows. */
export function SettingList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border rounded-2xl border border-border">{children}</div>
}

/** One setting: label and help text on the left, the control on the right (wraps when narrow). */
export function SettingRow({
  label,
  labelId,
  htmlFor,
  description,
  extra,
  children,
  ...rest
}: {
  label: string
  labelId: string
  htmlFor?: string
  description?: string
  /** Under the description, e.g. the "inherited from" badge. */
  extra?: ReactNode
  children: ReactNode
  'data-field'?: string
}) {
  return (
    <div {...rest} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 p-4">
      <div className="min-w-0 flex-1 basis-64">
        <label id={labelId} htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        {extra}
      </div>
      {children}
    </div>
  )
}
