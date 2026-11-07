import { Link } from '@tanstack/react-router'
import { Compass } from 'lucide-react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'

/** Any address no route matches. Standalone: no app shell, so it also works when signed out. */
export function NotFoundPage() {
  return (
    <main className="flex min-h-svh flex-col">
      <Empty className="animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Compass aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.not_found_title()}</EmptyTitle>
          <EmptyDescription>{m.not_found_description()}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button nativeButton={false} render={<Link to="/" />}>
            {m.not_found_home()}
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  )
}
