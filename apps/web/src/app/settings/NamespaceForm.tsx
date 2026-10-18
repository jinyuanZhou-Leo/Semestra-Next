import {
  settingsSchemasListOptions,
  settingsValuesGetOptions,
  settingsValuesGetQueryKey,
  settingsValuesResetMutation,
  settingsValuesUpdateMutation,
} from '@semestra/api-client/react-query'
import type { ResolvedSettings } from '@semestra/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { toApiError } from '@/app/api'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { SettingList, SettingRow } from '@/components/SettingRow'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import type { FieldOverrides, Scope, SettingsLevel } from '../extensions'
import { useAutosave } from './autosave'
import { FieldControlView } from './fields'
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
 * per field, saved automatically, with "inherited from …" and "restore" on scoped levels.
 */
export function NamespaceForm({ namespace, level, scope, fields }: Props) {
  const params = scopeParamsFor(level, scope)
  const schemas = useQuery({ ...settingsSchemasListOptions(), staleTime: Infinity })
  const values = useQuery({
    ...settingsValuesGetOptions({
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

function Form({
  namespace,
  level,
  params,
  data,
  fields,
}: {
  namespace: string
  level: SettingsLevel
  params: ScopeParams
  data: ResolvedSettings
  fields: FieldDescriptor[]
}) {
  const queryClient = useQueryClient()
  const idBase = useId()
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const valuesKey = settingsValuesGetQueryKey({ path: { namespace }, query: params })
  const update = useMutation(settingsValuesUpdateMutation())
  const reset = useMutation(settingsValuesResetMutation())

  const forget = (patch: Record<string, unknown>) =>
    setDraft((current) => {
      const next = { ...current }
      for (const [key, value] of Object.entries(patch)) {
        if (Object.is(next[key], value)) delete next[key]
      }
      return next
    })

  const { queue, flush } = useAutosave<Record<string, unknown>>({
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

  const restore = async (key: string) => {
    await flush()
    try {
      const result = await reset.mutateAsync({ path: { namespace, key }, query: params })
      queryClient.setQueryData(valuesKey, result)
      setDraft(({ [key]: _dropped, ...rest }) => rest)
    } catch (err) {
      toastError(err)
    }
  }

  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">{m.settings_no_options()}</p>
  }

  return (
    <SettingList>
      {fields.map((field) => {
        const id = `${idBase}-${field.key}`
        const labelId = `${id}-label`
        const value = field.key in draft ? draft[field.key] : data.values[field.key]
        const source = field.key in draft ? level : data.sources[field.key]
        return (
          <SettingRow
            key={field.key}
            data-field={field.key}
            label={fieldLabel(namespace, field.key)}
            labelId={labelId}
            htmlFor={id}
            description={fieldDescription(namespace, field.key)}
            extra={
              level !== 'account' ? (
                <div className="mt-1.5 flex items-center gap-1.5">
                  {source === level ? (
                    <>
                      <Badge variant="outline">{m.settings_inherit_set_here()}</Badge>
                      <Button
                        variant="link"
                        size="xs"
                        className="h-auto px-1"
                        onClick={() => void restore(field.key)}
                      >
                        {m.settings_inherit_restore()}
                      </Button>
                    </>
                  ) : (
                    <Badge variant="secondary">
                      {source && source !== 'default'
                        ? m.settings_inherit_from({ level: LEVEL_NAMES[source]() })
                        : m.settings_inherit_default()}
                    </Badge>
                  )}
                </div>
              ) : null
            }
          >
            <FieldControlView
              namespace={namespace}
              field={field}
              id={id}
              labelId={labelId}
              value={value}
              onChange={(next) => change(field.key, next)}
            />
          </SettingRow>
        )
      })}
    </SettingList>
  )
}
