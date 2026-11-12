import type { ComponentType } from 'react'
import { useExtensions } from '@/app/registry'

/** The fields another source (the LMS) keeps a value of, in the forms the API gives them. */
export type OriginField = 'title' | 'due_at' | 'weight' | 'score'

/**
 * `title` a string, `due_at` `{ date, time }` (time `HH:MM:SS` or null), `weight` a number,
 * `score` `{ points_earned, points_possible }` or `{ score_percentage }`.
 */
export type OriginValue =
  | string
  | number
  | { date: string; time: string | null }
  | { points_earned?: number; points_possible?: number; score_percentage?: number }

export type FieldOriginProps = {
  /** The assessment or task being edited. */
  targetId: string
  field: OriginField
  /** Puts the source's value into the form; saving it is the user's confirmation. */
  onApply: (value: OriginValue) => void
}

/**
 * Extension point `fieldOrigins`: a module that keeps its own value of an assessment's or a
 * task's field (M09's sync) contributes a button the edit forms show beside the field while the
 * saved value differs from the module's.
 */
export const FIELD_ORIGINS = 'fieldOrigins'

export type FieldOrigin = { id: string; Button: ComponentType<FieldOriginProps> }

/** The contributed buttons for one field of the assessment or task being edited. */
export function FieldOrigins(props: FieldOriginProps) {
  const origins = useExtensions<FieldOrigin>(FIELD_ORIGINS)
  return origins.map((origin) => (
    <origin.Button key={`${origin.id}:${props.targetId}:${props.field}`} {...props} />
  ))
}
