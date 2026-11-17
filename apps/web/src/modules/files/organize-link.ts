/** The status bar's link to a finished organizing job (M07 §8): its course's files, with the
 * review open (`useOrganizeOpen`). */
export function organizeLink(result: Record<string, unknown> | null | undefined) {
  if (typeof result?.program_id !== 'string' || typeof result.course_id !== 'string') return
  return `/p/${result.program_id}/c/${result.course_id}/files?organize=1`
}
