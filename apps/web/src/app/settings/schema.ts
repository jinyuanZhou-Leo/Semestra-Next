import type { FieldControl, FieldOverrides } from '../extensions'

/** The subset of JSON Schema that Pydantic emits for settings models. */
export type JsonSchema = {
  type?: string
  enum?: unknown[]
  const?: unknown
  default?: unknown
  format?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  multipleOf?: number
  anyOf?: JsonSchema[]
  allOf?: JsonSchema[]
  $ref?: string
  $defs?: Record<string, JsonSchema>
  properties?: Record<string, JsonSchema>
}

export type FieldDescriptor = {
  key: string
  control: FieldControl
  /** For select and segmented controls, in schema order. */
  options: unknown[]
  integer: boolean
  min?: number
  max?: number
  nullable: boolean
  defaultValue: unknown
}

function resolve(root: JsonSchema, schema: JsonSchema): JsonSchema {
  let current = schema
  for (let depth = 0; current.$ref && depth < 8; depth++) {
    const name = current.$ref.replace('#/$defs/', '')
    current = { ...root.$defs?.[name], default: current.default ?? root.$defs?.[name]?.default }
  }
  return current
}

/** Unwrap `anyOf: [X, null]` / `allOf: [X]` and follow `$ref`s down to the real type. */
function unwrap(root: JsonSchema, schema: JsonSchema): { schema: JsonSchema; nullable: boolean } {
  let current = resolve(root, schema)
  let nullable = false
  const variants = current.anyOf ?? current.allOf
  if (variants) {
    const real = variants.filter((v) => v.type !== 'null')
    nullable = real.length < variants.length
    if (real.length === 1) {
      current = { ...resolve(root, real[0]!), default: current.default }
    }
  }
  return { schema: current, nullable }
}

/** `undefined` for shapes a generated form cannot edit (lists, objects): such fields need a custom section. */
function controlFor(schema: JsonSchema, options: unknown[]): FieldControl | undefined {
  if (options.length > 0) return options.length <= 3 ? 'segmented' : 'select'
  if (schema.type === 'boolean') return 'switch'
  if (schema.type === 'integer' || schema.type === 'number') return 'number'
  if (schema.type === 'string') return schema.format === 'time' ? 'time' : 'text'
  return undefined
}

export function describeFields(
  root: JsonSchema,
  overrides: FieldOverrides = {},
): FieldDescriptor[] {
  const properties = root.properties ?? {}
  const hidden = new Set(overrides.hidden)
  const keys = Object.keys(properties).filter((key) => !hidden.has(key))
  const order = (overrides.order ?? []).filter((key) => keys.includes(key))
  const ordered = [...order, ...keys.filter((key) => !order.includes(key))]
  const fields: FieldDescriptor[] = []
  for (const key of ordered) {
    const { schema, nullable } = unwrap(root, properties[key]!)
    const options = schema.enum ?? (schema.const !== undefined ? [schema.const] : [])
    const control = overrides.controls?.[key] ?? controlFor(schema, options)
    if (!control) continue
    fields.push({
      key,
      control,
      options,
      integer: schema.type === 'integer',
      min: schema.minimum ?? schema.exclusiveMinimum,
      max: schema.maximum ?? schema.exclusiveMaximum,
      nullable,
      defaultValue: schema.default,
    })
  }
  return fields
}
