import type { AnnouncementAttachment } from '@semestra/api-client'
import { Link } from '@tanstack/react-router'
import { formatBytes } from '@/lib/format'
import { FileIcon } from '@/modules/files/components/FileIcon'
import { filePath } from '@/modules/files/location'
import { m } from '@/paraglide/messages'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item'
import { fileContentUrl } from './file-url'

/**
 * The files attached to an announcement: the course's own copy opens in the file preview; one
 * the course's files do not have opens from the platform through Semestra, in a new tab.
 */
export function Attachments({
  files,
  programId,
  courseId,
}: {
  files: readonly AnnouncementAttachment[]
  programId: string
  courseId: string
}) {
  if (files.length === 0) return null
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 className="text-xs text-muted-foreground">
        {m.lms_announcements_attachments({ count: files.length })}
      </h3>
      <ItemGroup className="grid gap-2 @page-lg/main:grid-cols-2">
        {files.map((file) => (
          <Item
            key={file.external_id}
            variant="outline"
            size="sm"
            render={
              file.file ? (
                <Link
                  to={filePath(programId, {
                    ...file.file,
                    folder_id: file.file.folder_id ?? null,
                  })}
                  className="hover:bg-muted/50"
                />
              ) : (
                // oxlint-disable-next-line jsx-a11y/anchor-has-content, jsx-a11y/control-has-associated-label -- the children label it
                <a
                  href={fileContentUrl(courseId, file.external_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:bg-muted/50"
                />
              )
            }
          >
            <ItemMedia>
              <FileIcon
                item={{ kind: 'file', mime_type: file.mime_type ?? null }}
                aria-hidden
                className="size-4 text-muted-foreground"
              />
            </ItemMedia>
            <ItemContent className="min-w-0 gap-0">
              <ItemTitle className="w-full">
                <span className="truncate">{file.name}</span>
              </ItemTitle>
              {file.size_bytes != null ? (
                <ItemDescription className="text-xs">
                  {formatBytes(file.size_bytes)}
                </ItemDescription>
              ) : null}
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </section>
  )
}
