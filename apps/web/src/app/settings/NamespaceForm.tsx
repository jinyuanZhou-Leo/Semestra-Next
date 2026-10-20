import {
  settingsSchemaListOptions,
  settingsValueGetOptions,
  settingsValueGetQueryKey,
  settingsValueResetMutation,
  settingsValueUpdateMutation,
} from '@semestra/api-client/react-query'
import type { ResolvedSettings } from '@semestra/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { toApiError } from '@/app/api'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { toastError } from '@/lib/errors'
import { omitKey } from '@/lib/omit'
import { m } from '@/paraglide/messages'
import type { FieldOverrides, Scope, SettingsLevel } from '../extensions'
import { useAutosave } from './autosave'
import { FieldControlView, type Inheritance, valueText } from './fields'
import { SettingRow, SettingsGroup } from './rows'
import { type FieldDescriptor, type JsonSchema, describeFields } from './schema'
import { fieldDescription, fieldLabel } from './texts'

type ScopeParams = { scope_type: SettingsLevel; scope_id?: string }

/** Which id of the page's scope belongs to the level being edited. */
export function scopeParamsFor(level: SettingsLevel, scope?: Scope): ScopeParams | null {
  if (level === 'account') return { scope_type: 'account' }
  const id =
    level === 'program'
      ? scope?.programId
      : level === 'term'
        ? scope?.kind === 'term'
          ? scope.termId
          : undefined
        : scope?.kind === 'course'
          ? scope.courseId
          : undefined
  return id ? { scope_type: level, scope_id: id } : null
}

export const LEVEL_ORDER: readonly SettingsLevel[] = ['account', 'program', 'term', 'course']

const LEVEL_NAMES: Record<SettingsLevel, () => string> = {
  account: m.settings_level_account,
  program: m.settings_level_program,
  term: m.settings_level_term,
  course: m.settings_level_course,
}

type Props = {
  namespace: string
  level: SettingsLevel
  scope?: Scope
  fields?: FieldOverrides
}

/**
 * A settings form generated from the JSON Schema of a backend namespace (M11 §5.1): one control
 * per field, saved automatically. On a level below another that can set the namespace, each
 * control starts with "follow …" (M11 §5.2).
 */
export function NamespaceForm({ namespace, level, scope, fields }: Props) {
  const params = scopeParamsFor(level, scope)
  const schemas = useQuery({ ...settingsSchemaListOptions(), staleTime: Infinity })
  const values = useQuery({
    ...settingsValueGetOptions({
      path: { namespace },
      query: params ?? { scope_type: 'account' },
    }),
    enabled: params !== null,
  })
  if (params === null) return null

  return (
    <AsyncBoundary query={schemas}>
      {(list) => {
        const definition = list.items.find((item) => item.namespace === namespace)
        if (!definition) return null
        return (
          <AsyncBoundary query={values}>
            {(data) => (
              <Form
                namespace={namespace}
                level={level}
                above={LEVEL_ORDER.slice(0, LEVEL_ORDER.indexOf(level)).filter((l) =>
                  (definition.levels as string[]).includes(l),
                )}
                params={params}
                data={data}
                fields={describeFields(definition.json_schema as JsonSchema, fields)}
              />
            )}
          </AsyncBoundary>
        )
      }}
    </AsyncBoundary>
  )
}

/** Marks a field in the draft whose own value is being removed, so it shows as following. */
const FOLLOWING = Symbol('following')

function Form({
  namespace,
  level,
  above,
  params,
  data,
  fields,
}: {
  namespace: string
  level: SettingsLevel
  /** The levels above this one where the namespace can be set, highest first. */
  above: SettingsLevel[]
  params: ScopeParams
  data: ResolvedSettings
  fields: FieldDescriptor[]
}) {
  const queryClient = useQueryClient()
  const idBase = useId()
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const valuesKey = settingsValueGetQueryKey({ path: { namespace }, query: params })
  const update = useMutation(settingsValueUpdateMutation())
  const reset = useMutation(settingsValueResetMutation())

  const forget = (patch: Record<string, unknown>) =>
    setDraft((current) => {
      const next = { ...current }
      for (const [key, value] of Object.entries(patch)) {
        if (Object.is(next[key], value)) delete next[key]
      }
      return next
    })

  const { queue, flush, discard } = useAutosave<Record<string, unknown>>({
    save: async (patch) => {
      try {
        const result = await update.mutateAsync({
          path: { namespace },
          body: { ...params, values: patch },
        })
        queryClient.setQueryData(valuesKey, result)
        forget(patch)
      } catch (err) {
        if (toApiError(err).code !== 'settings.invalid_value') throw err
        // The server will not take this value, and sending it again would not help.
        forget(patch)
        toastError(err)
      }
    },
  })

  const change = (key: string, value: unknown) => {
    setDraft((current) => ({ ...current, [key]: value }))
    queue({ [key]: value })
  }

  const follow = async (key: string) => {
    const unsaved = key in draft
    const previous = draft[key]
    const undo = () =>
      setDraft((current) => (unsaved ? { ...current, [key]: previous } : omitKey(current, key)))
    setDraft((current) => ({ ...current, [key]: FOLLOWING }))
    // An unsent value of this field must not be sent after the reset and undo "follow".
    discard([key])
    // A save that failed stays pending behind "Retry"; resetting now could be overwritten by it.
    if (!(await flush())) {
      undo()
      return
    }
    try {
      const result = await reset.mutateAsync({ path: { namespace, key }, query: params })
      queryClient.setQueryData(valuesKey, result)
      setDraft((current) => omitKey(current, key))
    } catch (err) {
      setDraft((current) => omitKey(current, key))
      toastError(err)
    }
  }

  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">{m.settings_no_options()}</p>
  }

  return (
    <SettingsGroup>
      {fields.map((field) => {
        const id = `${idBase}-${field.key}`
        const labelId = `${id}-label`
        const drafted = field.key in draft
        const following = drafted
          ? draft[field.key] === FOLLOWING
          : data.sources[field.key] !== level
        const inherited = data.inherited[field.key]
        const value = drafted
          ? following
            ? inherited?.value
            : draft[field.key]
          : data.values[field.key]
        // A value nobody set comes from the nearest level above, which itself follows the default.
        const from = inherited && inherited.source !== 'default' ? inherited.source : above.at(-1)
        const inherit: Inheritance | undefined =
          from && inherited
            ? {
                following,
                from: LEVEL_NAMES[from](),
                valueText: valueText(namespace, field, inherited.value),
                follow: () => void follow(field.key),
              }
            : undefined
        return (
          <SettingRow
            key={field.key}
            data-field={field.key}
            label={fieldLabel(namespace, field.key)}
            labelId={labelId}
            htmlFor={id}
            description={fieldDescription(namespace, field.key)}
          >
            <FieldControlView
              namespace={namespace}
              field={field}
              id={id}
              labelId={labelId}
              value={value}
              onChange={(next) => change(field.key, next)}
              inherit={inherit}
            />
          </SettingRow>
        )
      })}
    </SettingsGroup>
  )
}
