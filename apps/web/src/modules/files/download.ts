import { client, filesPrepareDownload } from '@semestra/api-client'
import { saveFile } from '@/lib/api-extras'

/**
 * Downloads a zip of course files (M07 §5). The chosen ids are posted first: the server opens files
 * until it finds one it can read and answers with a short-lived id (none readable:
 * `files.download_unavailable`, thrown for the caller to show). The browser then downloads the
 * archive at that id's address itself, with its progress, cancelling and no copy in the page's
 * memory; the server goes on from the file it already opened, so none is read twice. A download
 * that breaks off halfway is marked failed by the browser (the archive is cut short, so it does
 * not open as a whole one).
 */
export async function downloadArchive({
  courseId,
  itemIds,
  folderIds,
}: {
  courseId: string
  itemIds: string[]
  folderIds: string[]
}): Promise<void> {
  const { data } = await filesPrepareDownload({
    path: { course_id: courseId },
    body: { item_ids: itemIds, folder_ids: folderIds },
    throwOnError: true,
  })
  const url = client.buildUrl({
    url: '/file-downloads/{download_id}',
    path: { download_id: data.download_id },
  })
  // No name of its own: the browser takes the server's (the course code).
  saveFile(url, '')
}
