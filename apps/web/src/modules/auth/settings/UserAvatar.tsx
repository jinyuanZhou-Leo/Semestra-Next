import { client } from '@semestra/api-client'
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar'

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return Array.from(parts[0] ?? '')[0]?.toUpperCase() ?? '?'
  return `${Array.from(parts[0] ?? '')[0] ?? ''}${Array.from(parts.at(-1) ?? '')[0] ?? ''}`.toUpperCase()
}

/** Uploaded avatars are served by the API under a relative path; Google ones are absolute. */
function avatarSrc(src: string): string {
  return src.startsWith('/') ? `${client.getConfig().baseUrl ?? ''}${src}` : src
}

export function UserAvatar({
  name,
  src,
  size = 'default',
  className,
}: {
  name: string
  src?: string | null
  size?: 'default' | 'sm' | 'lg'
  className?: string
}) {
  return (
    <Avatar size={size} className={className}>
      {src ? <AvatarImage src={avatarSrc(src)} alt="" referrerPolicy="no-referrer" /> : null}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  )
}
