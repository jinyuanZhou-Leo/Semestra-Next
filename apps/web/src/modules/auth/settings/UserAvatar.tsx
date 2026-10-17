import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar'

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return Array.from(parts[0] ?? '')[0]?.toUpperCase() ?? '?'
  return `${Array.from(parts[0] ?? '')[0] ?? ''}${Array.from(parts.at(-1) ?? '')[0] ?? ''}`.toUpperCase()
}

export function UserAvatar({
  name,
  src,
  size = 'default',
}: {
  name: string
  src?: string | null
  size?: 'default' | 'sm' | 'lg'
}) {
  return (
    <Avatar size={size}>
      {src ? <AvatarImage src={src} alt="" referrerPolicy="no-referrer" /> : null}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  )
}
