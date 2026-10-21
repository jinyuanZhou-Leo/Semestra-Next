import { useState } from 'react'
import { m } from '@/paraglide/messages'
import { FieldError } from '@/ui/field'
import { Input } from '@/ui/input'
import { Clock2 } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { TIME_INPUT } from '@/lib/time-input'
import { Switch } from '@/ui/switch'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { ChoiceControl, type FollowChoice } from './choice'
import type { FieldDescriptor } from './schema'
import { optionHint, optionLabel } from './texts'

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
      {inherit.following ? null : <PlainControl {...props} inherit={undefined} />}
    </div>
  )
}

export function FieldControlView(props: ControlProps) {
  const { field, inherit } = props
  if (!inherit) return <PlainControl {...props} />
  if (field.control === 'number' || field.control === 'time' || field.control === 'text') {
    return <FollowOrOwn {...props} inherit={inherit} />
  }
  return (
    <PlainControl
      {...props}
      follow={{
        selected: inherit.following,
        short: m.settings_follow(),
        full: m.settings_follow_option({ level: inherit.from, value: inherit.valueText }),
        onSelect: inherit.follow,
      }}
    />
  )
}

/** A field's own control; `follow` adds the "follow the level above" choice to choice controls. */
function PlainControl(props: ControlProps & { follow?: FollowChoice }) {
  const { namespace, field, id, labelId, value, onChange, follow } = props
  switch (field.control) {
    case 'switch':
      // A switch cannot show a third state, so a following one becomes Follow / On / Off.
      if (follow) {
        return (
          <ChoiceControl
            id={id}
            labelId={labelId}
            options={[
              { value: 'true', label: m.settings_switch_on() },
              { value: 'false', label: m.settings_switch_off() },
            ]}
            value={String(value === true)}
            onChange={(next) => onChange(next === 'true')}
            follow={follow}
          />
        )
      }
      return (
        <Switch
          id={id}
          aria-labelledby={labelId}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
        />
      )
    case 'segmented':
    case 'select': {
      const options = field.options.map((o) => ({
        value: String(o),
        label: optionLabel(namespace, field.key, o),
        hint: optionHint(namespace, field.key, o),
      }))
      return (
        <ChoiceControl
          id={id}
          labelId={labelId}
          options={options}
          value={String(value)}
          onChange={(next) => onChange(field.options.find((o) => String(o) === next))}
          follow={follow}
        />
      )
    }
    case 'number':
      return <NumberControl {...props} />
    case 'time':
      return (
        <InputGroup className="w-32">
          <InputGroupInput
            id={id}
            type="time"
            aria-labelledby={labelId}
            className={TIME_INPUT}
            value={typeof value === 'string' ? value.slice(0, 5) : ''}
            onChange={(event) => {
              if (event.target.value) onChange(event.target.value)
            }}
          />
          <InputGroupAddon>
            <Clock2 aria-hidden />
          </InputGroupAddon>
        </InputGroup>
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
