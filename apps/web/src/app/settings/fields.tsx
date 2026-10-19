import { useState } from 'react'
import { m } from '@/paraglide/messages'
import { FieldError } from '@/ui/field'
import { Input } from '@/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Switch } from '@/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import type { FieldDescriptor } from './schema'
import { optionLabel } from './texts'

/** The choice that stands for "follow the level above" next to a field's own values. */
const FOLLOW = '__follow__'
/** The choice that lets a typed field (number, time, text) take a value of this level. */
const OWN = '__own__'

/**
 * How a field on a scoped level relates to the levels above (M11 §5.2). Following is a state of
 * its own, the first choice of the control, not "the same value as above": a value set here stays
 * when the level above changes later, a followed one does not.
 */
export type Inheritance = {
  following: boolean
  /** Where the followed value comes from, e.g. "Program". */
  from: string
  /** The followed value in words. */
  valueText: string
  follow: () => void
}

/** A value in the words the control shows for it. */
export function valueText(namespace: string, field: FieldDescriptor, value: unknown): string {
  if (field.control === 'switch')
    return value === true ? m.settings_switch_on() : m.settings_switch_off()
  if (field.options.length > 0) return optionLabel(namespace, field.key, value)
  if (value == null || value === '') return m.settings_value_empty()
  if (field.control === 'time' && typeof value === 'string') return value.slice(0, 5)
  return String(value)
}

export type ControlProps = {
  namespace: string
  field: FieldDescriptor
  id: string
  labelId: string
  value: unknown
  onChange: (value: unknown) => void
  /** Only on scoped levels whose fields can follow a level above. */
  inherit?: Inheritance
}

function numberProblem(field: FieldDescriptor, text: string): string | null {
  if (text.trim() === '') return field.nullable ? null : m.settings_number_invalid()
  const n = Number(text)
  if (!Number.isFinite(n) || (field.integer && !Number.isInteger(n))) {
    return m.settings_number_invalid()
  }
  const { min, max } = field
  if (min !== undefined && max !== undefined && (n < min || n > max)) {
    return m.settings_number_range({ min, max })
  }
  if (min !== undefined && n < min) return m.settings_number_min({ min })
  if (max !== undefined && n > max) return m.settings_number_max({ max })
  return null
}

function NumberControl({ field, id, labelId, value, onChange }: ControlProps) {
  const [text, setText] = useState(value == null ? '' : String(value))
  // Follow outside changes (a reset, a refetch) but never overwrite what is being typed.
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    const typed = text.trim() === '' ? null : Number(text)
    if (typed !== (value ?? null)) setText(value == null ? '' : String(value))
  }
  const problem = numberProblem(field, text)
  return (
    <div className="flex flex-col items-end gap-1">
      <Input
        id={id}
        type="number"
        inputMode={field.integer ? 'numeric' : 'decimal'}
        aria-labelledby={labelId}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-error` : undefined}
        min={field.min}
        max={field.max}
        step={field.integer ? 1 : 'any'}
        className="w-28"
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          if (numberProblem(field, event.target.value) === null) {
            onChange(event.target.value.trim() === '' ? null : Number(event.target.value))
          }
        }}
      />
      <FieldError id={`${id}-error`} className="text-xs">
        {problem}
      </FieldError>
    </div>
  )
}

/** The "follow" segment, with where the value comes from and what it is in its tooltip. */
function FollowItem({ inherit }: { inherit: Inheritance }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<ToggleGroupItem value={FOLLOW} />}>
        {m.settings_follow()}
      </TooltipTrigger>
      <TooltipContent>
        {m.settings_follow_option({ level: inherit.from, value: inherit.valueText })}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * A typed field that can follow: a choice between following and a value of this level, and the
 * input once it has one. Taking a value starts from the followed one.
 */
function FollowOrOwn(props: ControlProps & { inherit: Inheritance }) {
  const { inherit, labelId, value, onChange } = props
  const followLabel = m.settings_follow_option({ level: inherit.from, value: inherit.valueText })
  return (
    <div className="flex items-start justify-end gap-2">
      <Select
        value={inherit.following ? FOLLOW : OWN}
        items={[
          { value: FOLLOW, label: followLabel },
          { value: OWN, label: m.settings_own_value() },
        ]}
        onValueChange={(next) => {
          if (next === FOLLOW) inherit.follow()
          else if (inherit.following) onChange(value)
        }}
      >
        <SelectTrigger id={inherit.following ? props.id : undefined} aria-labelledby={labelId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={FOLLOW}>{followLabel}</SelectItem>
            <SelectItem value={OWN}>{m.settings_own_value()}</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {inherit.following ? null : <PlainControl {...props} />}
    </div>
  )
}

export function FieldControlView(props: ControlProps) {
  const { namespace, field, id, labelId, value, onChange, inherit } = props
  if (!inherit) return <PlainControl {...props} />
  const followLabel = m.settings_follow_option({ level: inherit.from, value: inherit.valueText })
  switch (field.control) {
    case 'switch':
      return (
        <ToggleGroup
          aria-labelledby={labelId}
          value={[inherit.following ? FOLLOW : String(value === true)]}
          onValueChange={(next) => {
            if (next[0] === FOLLOW) inherit.follow()
            else if (next[0]) onChange(next[0] === 'true')
          }}
          variant="outline"
          size="sm"
        >
          <FollowItem inherit={inherit} />
          <ToggleGroupItem value="true">{m.settings_switch_on()}</ToggleGroupItem>
          <ToggleGroupItem value="false">{m.settings_switch_off()}</ToggleGroupItem>
        </ToggleGroup>
      )
    case 'segmented':
      return (
        <ToggleGroup
          aria-labelledby={labelId}
          value={[inherit.following ? FOLLOW : String(value)]}
          onValueChange={(next) => {
            if (next[0] === FOLLOW) inherit.follow()
            else if (next[0]) onChange(field.options.find((o) => String(o) === next[0]))
          }}
          variant="outline"
          size="sm"
        >
          <FollowItem inherit={inherit} />
          {field.options.map((o) => (
            <ToggleGroupItem key={String(o)} value={String(o)}>
              {optionLabel(namespace, field.key, o)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )
    case 'select':
      return (
        <Select
          value={inherit.following ? FOLLOW : String(value)}
          items={[
            { value: FOLLOW, label: followLabel },
            ...field.options.map((o) => ({
              value: String(o),
              label: optionLabel(namespace, field.key, o),
            })),
          ]}
          onValueChange={(next) => {
            if (next === FOLLOW) inherit.follow()
            else onChange(field.options.find((o) => String(o) === next))
          }}
        >
          <SelectTrigger id={id} aria-labelledby={labelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={FOLLOW}>{followLabel}</SelectItem>
              {field.options.map((o) => (
                <SelectItem key={String(o)} value={String(o)}>
                  {optionLabel(namespace, field.key, o)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )
    default:
      return <FollowOrOwn {...props} inherit={inherit} />
  }
}

function PlainControl(props: ControlProps) {
  const { namespace, field, id, labelId, value, onChange } = props
  switch (field.control) {
    case 'switch':
      return (
        <Switch
          id={id}
          aria-labelledby={labelId}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
        />
      )
    case 'segmented':
      return (
        <ToggleGroup
          aria-labelledby={labelId}
          value={[String(value)]}
          onValueChange={(next) => {
            if (next[0]) onChange(field.options.find((o) => String(o) === next[0]))
          }}
          variant="outline"
          size="sm"
        >
          {field.options.map((o) => (
            <ToggleGroupItem key={String(o)} value={String(o)}>
              {optionLabel(namespace, field.key, o)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )
    case 'select':
      return (
        <Select
          value={String(value)}
          items={field.options.map((o) => ({
            value: String(o),
            label: optionLabel(namespace, field.key, o),
          }))}
          onValueChange={(next) => onChange(field.options.find((o) => String(o) === next))}
        >
          <SelectTrigger id={id} aria-labelledby={labelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {field.options.map((o) => (
                <SelectItem key={String(o)} value={String(o)}>
                  {optionLabel(namespace, field.key, o)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )
    case 'number':
      return <NumberControl {...props} />
    case 'time':
      return (
        <Input
          id={id}
          type="time"
          aria-labelledby={labelId}
          className="w-32"
          value={typeof value === 'string' ? value.slice(0, 5) : ''}
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value)
          }}
        />
      )
    case 'text':
      return (
        <Input
          id={id}
          aria-labelledby={labelId}
          className="w-64"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }
}
