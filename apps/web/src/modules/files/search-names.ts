import type { FolderOut, ItemOut } from '@semestra/api-client'

/** A folder or file whose name matches a search, with where it is (folders from the top down). */
export type NameMatch<T> = { entry: T; trail: string[]; courseId: string }

function trailOf(byId: Map<string, FolderOut>, id: string | null): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  let step = id ? byId.get(id) : undefined
  while (step && !seen.has(step.id)) {
    seen.add(step.id)
    names.unshift(step.name)
    step = step.parent_id ? byId.get(step.parent_id) : undefined
  }
  return names
}

/** Folders and files of the given courses whose name contains `needle` (case-insensitive). */
export function matchNames(
  needle: string,
  lists: readonly { folders: readonly FolderOut[]; items: readonly ItemOut[] }[],
): { folders: NameMatch<FolderOut>[]; items: NameMatch<ItemOut>[] } {
  const wanted = needle.trim().toLowerCase()
  const out = { folders: [] as NameMatch<FolderOut>[], items: [] as NameMatch<ItemOut>[] }
  if (!wanted) return out
  for (const list of lists) {
    const byId = new Map(list.folders.map((f) => [f.id, f]))
    for (const folder of list.folders) {
      if (folder.name.toLowerCase().includes(wanted))
        out.folders.push({
          entry: folder,
          trail: trailOf(byId, folder.parent_id),
          courseId: folder.course_id,
        })
    }
    for (const item of list.items) {
      if (item.display_name.toLowerCase().includes(wanted))
        out.items.push({
          entry: item,
          trail: trailOf(byId, item.folder_id),
          courseId: item.course_id,
        })
    }
  }
  return out
}
