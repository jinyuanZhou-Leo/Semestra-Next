import type { LucideIcon } from 'lucide-react'
import {
  Children,
  type ComponentProps,
  isValidElement,
  type ReactNode,
  useId,
  useState,
} from 'react'
import { FieldError } from '@/ui/field'
import { Input } from '@/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/ui/item'
import { Label } from '@/ui/label'
import { cn } from '@/lib/utils'
import { Textarea } from '@/ui/textarea'

// The building blocks of every settings section (M11 §5.1). A section is a heading, then one or
// more `SettingsGroup`s: a single rounded list whose rows put the name on the left and the
// control on the right, like System Settings. Sections use these instead of cards or ad-hoc
// item lists, so every kind of setting looks the same.

/** A titled part of a section: a small heading, an optional hint, then its list or editor. */
export function SettingsBlock({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  /** A control for the whole block, at the end of the heading (e.g. "Add"). */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="font-heading text-sm font-medium">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/**
 * The rounded list that holds rows, with a hairline between them. `ItemGroup` widens its gap when
 * any row holds a small control (`has-data-[size=sm]`, e.g. a switch); the rows here sit flush
 * against their hairlines, so every gap is zeroed, or that space shows up under the row.
 */
export function SettingsGroup({ children, className, ...props }: ComponentProps<typeof ItemGroup>) {
  const rows = Children.toArray(children)
  return (
    <ItemGroup
      className={cn(
        'gap-0 has-data-[size=sm]:gap-0 has-data-[size=xs]:gap-0',
        className ?? 'rounded-2xl border',
      )}
      {...props}
    >
      {rows.map((row, index) => (
        // `toArray` keys every element, so the separator can share its row's key.
        <SeparatedRow key={isValidElement(row) ? row.key : index} first={index === 0}>
          {row}
        </SeparatedRow>
      ))}
    </ItemGroup>
  )
}

function SeparatedRow({ first, children }: { first: boolean; children: ReactNode }) {
  return (
    <>
      {first ? null : <ItemSeparator className="my-0" />}
      {children}
    </>
  )
}

/** A small note under a group: a limit, an estimate, what happens when nothing is chosen. */
export function SettingsNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}

type RowProps = Omit<ComponentProps<typeof Item>, 'children' | 'title'> & {
  label: string
  description?: ReactNode
  /** Extra line under the description, e.g. where an inherited value comes from. */
  note?: ReactNode
  /** The control points `aria-labelledby` at this id; generated when left out. */
  labelId?: string
  /** The id of the control, when the label should focus it on click. */
  htmlFor?: string
  children: ReactNode | ((labelId: string) => ReactNode)
}

/** One setting: its name and a line of help on the left, the control on the right. */
export function SettingRow({
  label,
  description,
  note,
  labelId,
  htmlFor,
  children,
  ...props
}: RowProps) {
  const generated = useId()
  const id = labelId ?? `${generated}-label`
  return (
    <Item {...props}>
      <ItemContent className="min-w-0 basis-40">
        <ItemTitle>
          <Label id={id} htmlFor={htmlFor}>
            {label}
          </Label>
        </ItemTitle>
        {description ? <ItemDescription>{description}</ItemDescription> : null}
        {note}
      </ItemContent>
      <ItemActions>{typeof children === 'function' ? children(id) : children}</ItemActions>
    </Item>
  )
}

/**
 * A row that is just an action: adds an entry (a provider, a token) or runs something
 * (sign out). Its text is the whole row; `destructive` turns it red.
 */
export function ActionRow({
  icon: Icon,
  destructive,
  muted,
  children,
  ...props
}: ComponentProps<'button'> & {
  icon?: LucideIcon
  destructive?: boolean
  /** A secondary add row inside a list (e.g. "Add a time" under a section). */
  muted?: boolean
}) {
  return (
    <Item
      render={<button type="button" {...props} />}
      // The hover tint is inset from the group's border, with its own corners.
      className={cn(
        'isolate cursor-pointer font-medium before:absolute before:inset-1 before:-z-10 before:rounded-xl before:transition-colors hover:before:bg-muted relative',
        destructive
          ? 'text-destructive'
          : muted
            ? 'text-muted-foreground hover:text-foreground'
            : 'text-primary',
      )}
    >
      {Icon ? <Icon aria-hidden className="size-4" /> : null}
      {children}
    </Item>
  )
}

/** A text setting saved as typed; `required` keeps an empty value from being sent. */
export function TextRow({
  label,
  description,
  value,
  onChange,
  required,
  multiline,
  type = 'text',
  placeholder,
  invalid,
}: {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  multiline?: boolean
  type?: 'text' | 'url'
  placeholder?: string
  /** Shown under the field, e.g. the server's validation message. */
  invalid?: string | null
}) {
  const id = useId()
  const [text, setText] = useState(value)
  const error = invalid ?? (required && text.trim() === '' ? '' : null)
  const props = {
    id: `${id}-input`,
    'aria-labelledby': `${id}-label`,
    'aria-invalid': error !== null ? true : undefined,
    placeholder,
    value: text,
    onChange: (event: { target: { value: string } }) => {
      setText(event.target.value)
      if (!(required && event.target.value.trim() === '')) onChange(event.target.value)
    },
  }
  return (
    <SettingRow
      label={label}
      description={description}
      labelId={`${id}-label`}
      htmlFor={`${id}-input`}
    >
      <div className="flex flex-col items-end gap-1">
        {multiline ? (
          <Textarea {...props} className="w-80" rows={3} />
        ) : (
          <Input {...props} type={type} className="w-64" />
        )}
        <FieldError className="text-xs">{error}</FieldError>
      </div>
    </SettingRow>
  )
}

/** A number setting; values outside `min`..`max` are not sent. Empty means null when `nullable`. */
export function NumberRow({
  label,
  description,
  value,
  onChange,
  min = 0,
  max = 1000,
  nullable,
}: {
  label: string
  description?: string
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  nullable?: boolean
}) {
  const id = useId()
  const [text, setText] = useState(value == null ? '' : String(value))
  const valid = (t: string) =>
    t.trim() === '' ? Boolean(nullable) : Number(t) >= min && Number(t) <= max
  return (
    <SettingRow
      label={label}
      description={description}
      labelId={`${id}-label`}
      htmlFor={`${id}-input`}
    >
      <Input
        id={`${id}-input`}
        type="number"
        inputMode="decimal"
        step="any"
        min={min}
        max={max}
        className="w-28"
        aria-labelledby={`${id}-label`}
        aria-invalid={valid(text) ? undefined : true}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          if (valid(event.target.value)) {
            onChange(event.target.value.trim() === '' ? null : Number(event.target.value))
          }
        }}
      />
    </SettingRow>
  )
}
