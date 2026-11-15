import {
  TaskCreateInputBodySchema,
  TaskListCreateInputBodySchema,
} from '@semestra/api-client/schemas'

// The API's own limits (its OpenAPI schema), so a field never takes more than a save accepts.
export const TITLE_MAX = TaskCreateInputBodySchema.properties.title.maxLength
export const NOTES_MAX = TaskCreateInputBodySchema.properties.notes.maxLength
export const LIST_NAME_MAX = TaskListCreateInputBodySchema.properties.name.maxLength
