import { Link } from '@tanstack/react-router'
import { Check, GraduationCap, LogOut, Settings } from 'lucide-react'
import { useState } from 'react'
import { useSettingsDialog } from '@/app/settings/use-settings-dialog'
import { usePrograms } from '@/modules/academics/queries'
import { SignOutDialog } from '@/modules/auth/components/SignOutDialog'
import { UserAvatar } from '@/modules/auth/settings/UserAvatar'
import { useAuth } from '@/modules/auth/useAuth'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/ui/drawer'
import { MobileList } from './MobilePage'

const ROW = 'flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left text-sm'

/**
 * The phone's "More" (M17): who is signed in, the Programs to switch between, settings and
 * signing out. Everything else is on a computer.
 */
export function MoreDrawer({
  programId,
  open,
  onOpenChange,
}: {
  programId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = useAuth()
  const programs = usePrograms().data?.items ?? []
  const settings = useSettingsDialog()
  const [signingOut, setSigningOut] = useState(false)
  const close = () => onOpenChange(false)
  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
        <DrawerContent>
          <DrawerHeader className="flex-row items-center gap-3 group-data-[swipe-axis=y]/drawer-popup:text-left">
            {user ? <UserAvatar name={user.display_name} src={user.avatar_url} /> : null}
            <div className="grid min-w-0 flex-1">
              <DrawerTitle className="truncate">{user?.display_name}</DrawerTitle>
              <DrawerDescription className="truncate">{user?.email}</DrawerDescription>
            </div>
          </DrawerHeader>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            {programs.length > 1 ? (
              <MobileList label={m.academics_programs()}>
                {programs.map((program) => (
                  <li key={program.id}>
                    <Link
                      to="/p/$programId"
                      params={{ programId: program.id }}
                      className={ROW}
                      aria-current={program.id === programId ? 'true' : undefined}
                      onClick={close}
                    >
                      <GraduationCap aria-hidden className="size-5 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{program.name}</span>
                      {program.id === programId ? (
                        <Check aria-hidden className="size-4 text-primary" />
                      ) : null}
                    </Link>
                  </li>
                ))}
              </MobileList>
            ) : null}
            <MobileList>
              <li>
                <button
                  type="button"
                  className={ROW}
                  onClick={() => {
                    close()
                    settings.open({ level: 'account' })
                  }}
                >
                  <Settings aria-hidden className="size-5 text-muted-foreground" />
                  {m.settings_title()}
                </button>
              </li>
            </MobileList>
            <Button variant="destructive" className="h-11" onClick={() => setSigningOut(true)}>
              <LogOut aria-hidden />
              {m.home_sign_out()}
            </Button>
            <p className="px-1 text-center text-xs text-muted-foreground">
              {m.mobile_more_desktop_note()}
            </p>
          </div>
        </DrawerContent>
      </Drawer>
      <SignOutDialog open={signingOut} onOpenChange={setSigningOut} />
    </>
  )
}
